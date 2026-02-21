/**
 * Admin dashboard stats adapter - fetches from GET /api/admin/dashboard/stats.
 * State machine: idle -> loading -> success | error.
 * Stops retrying on 401/403; allows manual retry only for 500+.
 * Used for MPS/Latency badges and suspicious flags delta.
 * PHASE 3: Polls every 5s when page is visible (smoother graph updates); pauses when tab is hidden.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminDashboardStats } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const DEFAULT_STATS = {};

export function useAdminDashboardStats() {
  const [status, setStatus] = useState("idle");
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [errorKey, setErrorKey] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const blockRefetchRef = useRef(false);
  const inFlightRef = useRef(false);
  const isPageVisible = usePageVisibility();

  const POLL_INTERVAL_MS = 5000; // 5s for badges

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
      const d = await fetchAdminDashboardStats();
      blockRefetchRef.current = false;
      setStats(typeof d === "object" && d !== null ? d : {});
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
        setErrorMessage(e?.message ?? "Failed to load stats");
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

  return {
    stats: stats ?? {},
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
  };
}
