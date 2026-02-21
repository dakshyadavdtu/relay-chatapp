/**
 * Admin dashboard adapter - fetches from GET /api/admin/dashboard (cards only).
 * State machine: idle -> loading -> success | error.
 * Stops retrying on 401/403; allows manual retry only for 500+.
 * Polls every 2s when page is visible so Online Users and other cards update in real time; pauses when tab is hidden.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminDashboard } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const DEFAULT_STATS = {
  onlineUsers: 0,
  messagesPerSecond: 0,
  latencyAvg: 0,
  suspiciousFlags: 0,
  adminsCount: 0,
  regularUsersCount: 0,
};

export function useAdminDashboard() {
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [stats, setStats] = useState(null);
  const [errorKey, setErrorKey] = useState(null); // UNAUTHORIZED | FORBIDDEN | NOT_FOUND | SERVER_ERROR
  const [errorMessage, setErrorMessage] = useState(null);
  const blockRefetchRef = useRef(false);
  const inFlightRef = useRef(false);
  const isPageVisible = usePageVisibility();

  const POLL_INTERVAL_MS = 2000; // 2s so Online Users and other cards update in real time

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
      const data = await fetchAdminDashboard();
      blockRefetchRef.current = false;
      setStats(data ?? DEFAULT_STATS);
      setStatus("success");
    } catch (e) {
      const statusCode = e?.status;
      const code = e?.code;
      const msg = e?.message;
      setStatus("error");
      if (statusCode === 401) {
        setErrorKey("UNAUTHORIZED");
        setErrorMessage("Login required");
        blockRefetchRef.current = true;
      } else if (statusCode === 403 || code === "FORBIDDEN" || code === "NOT_AUTHORIZED") {
        setErrorKey("FORBIDDEN");
        setErrorMessage("Admin role required");
        blockRefetchRef.current = true;
      } else if (statusCode === 404) {
        setErrorKey("NOT_FOUND");
        setErrorMessage("Not found");
      } else if (statusCode >= 500) {
        setErrorKey("SERVER_ERROR");
        setErrorMessage(msg ?? "Server error");
      } else {
        setErrorKey("SERVER_ERROR");
        setErrorMessage(msg ?? "Failed to load dashboard");
      }
      // Do not clear stats on transient error; keep last good data
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (blockRefetchRef.current) return;
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (blockRefetchRef.current || status !== "success" || !isPageVisible) return;
    const id = setInterval(() => refetch({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, refetch, isPageVisible]);

  const loading = status === "loading";
  const error = errorMessage;
  const forbidden = errorKey === "FORBIDDEN";
  const unauthorized = errorKey === "UNAUTHORIZED";
  const canRetry = errorKey === "SERVER_ERROR" || errorKey === "NOT_FOUND";
  const hasHadSuccess = status === "success" || (stats !== null && stats !== undefined);

  return {
    stats: stats ?? DEFAULT_STATS,
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
    hasHadSuccess,
  };
}
