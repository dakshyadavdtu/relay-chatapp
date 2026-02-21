/**
 * Admin dashboard series adapter - fetches from GET /api/admin/dashboard/series.
 * State machine: idle -> loading -> success | error.
 * Stops retrying on 401/403; allows manual retry only for 500+.
 * Used for traffic chart. Returns empty points on error so chart does not crash.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminDashboardSeries } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";

const DEFAULT_SERIES = { windowSeconds: 3600, intervalSeconds: 60, points: [] };

export function useAdminDashboardSeries(params = {}) {
  const { windowSeconds, intervalSeconds } = params;
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(DEFAULT_SERIES);
  const [errorKey, setErrorKey] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const blockRefetchRef = useRef(false);

  const refetch = useCallback(async () => {
    const authenticated = getAuthState().isAuthenticated;
    if (!authenticated) {
      setStatus("error");
      setErrorKey("UNAUTHORIZED");
      setErrorMessage("Login required");
      blockRefetchRef.current = true;
      return;
    }
    if (blockRefetchRef.current) return;
    setStatus("loading");
    setErrorKey(null);
    setErrorMessage(null);
    try {
      const d = await fetchAdminDashboardSeries({ windowSeconds, intervalSeconds });
      blockRefetchRef.current = false;
      setData({
        windowSeconds: d?.windowSeconds ?? 3600,
        intervalSeconds: d?.intervalSeconds ?? 60,
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
        setErrorMessage(e?.message ?? "Failed to load series");
      }
      setData(DEFAULT_SERIES);
    }
  }, [windowSeconds, intervalSeconds]);

  useEffect(() => {
    if (blockRefetchRef.current) return;
    refetch();
  }, [refetch]);

  const loading = status === "loading";
  const error = errorMessage;
  const forbidden = errorKey === "FORBIDDEN";
  const unauthorized = errorKey === "UNAUTHORIZED";
  const canRetry = errorKey === "SERVER_ERROR" || errorKey === "NOT_FOUND";

  return {
    series: data,
    points: data.points,
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
  };
}
