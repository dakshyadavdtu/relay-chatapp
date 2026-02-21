/**
 * Admin reports adapter - fetches from GET /api/admin/reports.
 * State machine: idle -> loading -> success | error.
 * Backend may return { notAvailable: true, reason } or reports data.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminReports } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";

export function useAdminReports() {
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);
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
      const d = await fetchAdminReports();
      blockRefetchRef.current = false;
      setData(d);
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
      } else {
        setErrorKey("SERVER_ERROR");
        setErrorMessage(msg ?? "Failed to load reports");
      }
    }
  }, []);

  useEffect(() => {
    if (blockRefetchRef.current) return;
    refetch();
  }, [refetch]);

  const loading = status === "loading";
  const error = errorMessage;
  const forbidden = errorKey === "FORBIDDEN";
  const unauthorized = errorKey === "UNAUTHORIZED";
  const canRetry = errorKey === "SERVER_ERROR" || errorKey === "NOT_FOUND";
  const notAvailable = data && data.notAvailable === true;
  const reason = data?.reason ?? null;

  return {
    data,
    notAvailable,
    reason,
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
  };
}
