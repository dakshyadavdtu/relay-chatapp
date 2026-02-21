/**
 * Admin dashboard activity adapter - fetches from GET /api/admin/dashboard/activity.
 * Returns events for System Activity panel. Items: { id, type, title, detail, createdAt } -> events with ts.
 * Backend-driven; empty array if no activity (no fake data).
 * Pauses polling when tab is hidden.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminDashboardActivity } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const DEFAULT_ACTIVITY = { windowSeconds: 86400, items: [] };

function mapItemsToEvents(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: item.id,
    type: item.type ?? "failure",
    title: item.title ?? "",
    detail: item.detail ?? null,
    ts: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
  }));
}

export function useAdminDashboardActivity(params = {}) {
  const { limit = 25, windowSeconds } = params;
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(DEFAULT_ACTIVITY);
  const [errorKey, setErrorKey] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const blockRefetchRef = useRef(false);
  const inFlightRef = useRef(false);
  const isPageVisible = usePageVisibility();

  const POLL_INTERVAL_MS = 10000; // 10s

  const refetch = useCallback(async (opts = {}) => {
    const { silent = false } = opts;
    const authenticated = getAuthState().isAuthenticated;
    if (!authenticated) {
      setStatus("error");
      setErrorKey("UNAUTHORIZED");
      setErrorMessage("Login required");
      blockRefetchRef.current = true;
      return;
    }
    if (blockRefetchRef.current) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) {
      setStatus("loading");
      setErrorKey(null);
      setErrorMessage(null);
    }
    try {
      const d = await fetchAdminDashboardActivity({ limit, windowSeconds });
      blockRefetchRef.current = false;
      const items = Array.isArray(d?.items) ? d.items : [];
      setData({
        windowSeconds: d?.windowSeconds ?? 86400,
        items,
        events: mapItemsToEvents(items),
      });
      setStatus("success");
    } catch (e) {
      const statusCode = e?.status;
      const code = e?.code;
      setStatus("error");
      if (statusCode === 401) {
        setErrorKey("UNAUTHORIZED");
        setErrorMessage("Login required");
        blockRefetchRef.current = true;
      } else if (statusCode === 403 || code === "FORBIDDEN" || code === "NOT_AUTHORIZED") {
        setErrorKey("FORBIDDEN");
        setErrorMessage("Admin role required");
        blockRefetchRef.current = true;
      } else {
        setErrorKey("SERVER_ERROR");
        setErrorMessage(e?.message ?? "Failed to load activity");
      }
      // Do not clear data on transient error; keep last good data
    } finally {
      inFlightRef.current = false;
    }
  }, [limit, windowSeconds]);

  useEffect(() => {
    if (blockRefetchRef.current) return;
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (blockRefetchRef.current || status !== "success" || !isPageVisible) return;
    const id = setInterval(() => refetch({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, refetch, isPageVisible]);

  const events = data.events ?? mapItemsToEvents(data.items ?? []);

  return {
    activity: data,
    events,
    loading: status === "loading",
    error: errorMessage,
    errorKey,
    forbidden: errorKey === "FORBIDDEN",
    unauthorized: errorKey === "UNAUTHORIZED",
    canRetry: errorKey === "SERVER_ERROR" || errorKey === "NOT_FOUND",
    refetch,
  };
}
