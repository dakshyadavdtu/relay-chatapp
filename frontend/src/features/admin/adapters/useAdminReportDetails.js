/**
 * Admin report details adapter - fetches GET /api/admin/reports/:id when reportId is set.
 * Returns stable shape: { report, message, context, window, contextError? }.
 * If no reportId -> { loading: false, data: null }.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminReportDetails } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";

export function useAdminReportDetails(reportId) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const id = reportId != null && String(reportId).trim() ? String(reportId).trim() : null;
    if (!id) {
      setData(null);
      setLoading(false);
      setError(null);
      setForbidden(false);
      setUnauthorized(false);
      return;
    }
    const authenticated = getAuthState().isAuthenticated;
    if (!authenticated) {
      setLoading(false);
      setData(null);
      setError("Login required");
      setUnauthorized(true);
      setForbidden(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setUnauthorized(false);
    try {
      const d = await fetchAdminReportDetails(id);
      if (requestIdRef.current !== reqId) return;
      setData(d);
      setLoading(false);
    } catch (e) {
      if (requestIdRef.current !== reqId) return;
      const statusCode = e?.status;
      const code = e?.code;
      const msg = e?.message;
      setLoading(false);
      setData(null);
      setError(msg ?? "Failed to load report details");
      setUnauthorized(statusCode === 401);
      setForbidden(statusCode === 403 || code === "FORBIDDEN" || code === "NOT_AUTHORIZED");
    }
  }, [reportId]);

  useEffect(() => {
    const id = reportId != null && String(reportId).trim() ? String(reportId).trim() : null;
    if (!id) {
      setData(null);
      setLoading(false);
      setError(null);
      setForbidden(false);
      setUnauthorized(false);
      return;
    }
    refetch();
  }, [reportId, refetch]);

  return {
    loading,
    data,
    error,
    forbidden,
    unauthorized,
    refetch,
  };
}
