/**
 * System status for Admin layout: API health + WebSocket readiness.
 * - apiOk: true when GET /api/health succeeds
 * - wsReady: true when wsClient.isReady()
 * - wsStatus: "disconnected" | "connecting" | "connected"
 * Polls /api/health every 10s when page visible; subscribes to wsClient for WS state.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/http";
import { wsClient } from "@/transport/wsClient";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const HEALTH_POLL_MS = 10000;

export function useSystemStatus() {
  const isPageVisible = usePageVisibility();
  const [apiOk, setApiOk] = useState(true);
  const [wsStatus, setWsStatus] = useState(() => wsClient.getStatus?.() ?? "disconnected");
  const [wsReady, setWsReady] = useState(() => wsClient.isReady?.() ?? false);
  const [lastCheckedAt, setLastCheckedAt] = useState(0);
  const intervalRef = useRef(null);
  const abortRef = useRef(null);

  const checkHealth = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await apiFetch("/api/health", { method: "GET", signal: ac.signal });
      if (!ac.signal.aborted) {
        setApiOk(true);
        setLastCheckedAt(Date.now());
      }
    } catch (_) {
      if (!ac.signal.aborted) {
        setApiOk(false);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    const unsub = wsClient.subscribe?.({
      onStatus: (status) => {
        setWsStatus(status ?? "disconnected");
        setWsReady(wsClient.isReady?.() ?? false);
      },
    });
    setWsStatus(wsClient.getStatus?.() ?? "disconnected");
    setWsReady(wsClient.isReady?.() ?? false);
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (!isPageVisible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    checkHealth();
    intervalRef.current = setInterval(checkHealth, HEALTH_POLL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [isPageVisible, checkHealth]);

  return { apiOk, wsStatus, wsReady, lastCheckedAt };
}
