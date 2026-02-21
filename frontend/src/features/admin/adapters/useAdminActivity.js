/**
 * Admin activity adapter - fetches from GET /api/admin/activity.
 * State machine: idle -> loading -> success | error.
 * Stops retrying on 401/403; allows manual retry only for 500+.
 * Used for System Activity panel. Returns empty events on error.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminActivity } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";

const DEFAULT_ACTIVITY = { windowSeconds: 3600, maxEvents: 50, events: [] };

export function useAdminActivity(params = {}) {
  const { windowSeconds, maxEvents } = params;
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(DEFAULT_ACTIVITY);
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
      const d = await fetchAdminActivity({ windowSeconds, maxEvents });
      blockRefetchRef.current = false;
      setData({
        windowSeconds: d?.windowSeconds ?? 3600,
        maxEvents: d?.maxEvents ?? 50,
        events: Array.isArray(d?.events) ? d.events : [],
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
      setData(DEFAULT_ACTIVITY);
    }
  }, [windowSeconds, maxEvents]);

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
    activity: data,
    events: data.events,
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
  };
}
