/**
 * Admin dashboard timeseries adapter - fetches from GET /api/admin/dashboard/timeseries.
 * Returns points for the chart: { time, messages, connections }.
 * Used for System Performance chart (backend-driven, no WS).
 * PHASE 3: Respects page visibility (pauses polling when tab is hidden).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminDashboardTimeseries } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const DEFAULT_TIMESERIES = { windowSeconds: 86400, bucketSeconds: 3600, points: [] };

export function useAdminDashboardTimeseries(params = {}) {
  const { windowSeconds, bucketSeconds } = params;
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(DEFAULT_TIMESERIES);
  const [errorKey, setErrorKey] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const blockRefetchRef = useRef(false);
  const inFlightRef = useRef(false);
  const isPageVisible = usePageVisibility();

  const POLL_INTERVAL_MS = 2000; // 2s for real-time graph (backend samples every 1s)

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
      const d = await fetchAdminDashboardTimeseries({ windowSeconds, bucketSeconds });
      blockRefetchRef.current = false;
      setData({
        windowSeconds: d?.windowSeconds ?? 86400,
        bucketSeconds: d?.bucketSeconds ?? 3600,
        points: Array.isArray(d?.points) ? d.points : [],
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
        setErrorMessage(e?.message ?? "Failed to load timeseries");
      }
      // Do not clear data on transient error; keep last good points
    } finally {
      inFlightRef.current = false;
    }
  }, [windowSeconds, bucketSeconds]);

  useEffect(() => {
    if (blockRefetchRef.current) return;
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (blockRefetchRef.current || status !== "success" || !isPageVisible) return;
    const id = setInterval(() => refetch({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, refetch, isPageVisible]);

  return {
    timeseries: data,
    points: data.points,
    loading: status === "loading",
    error: errorMessage,
    errorKey,
    forbidden: errorKey === "FORBIDDEN",
    unauthorized: errorKey === "UNAUTHORIZED",
    canRetry: errorKey === "SERVER_ERROR" || errorKey === "NOT_FOUND",
    refetch,
  };
}
