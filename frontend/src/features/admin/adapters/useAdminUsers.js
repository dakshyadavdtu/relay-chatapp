/**
 * Admin users adapter - fetches from GET /api/admin/users.
 * State machine: idle -> loading -> success | error.
 * Stops retrying on 401/403; allows manual retry only for 500+.
 * Normalizes backend shape: { success, data: { users, nextCursor, total, notAvailable } } -> { users, nextCursor, total, notAvailable }.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminUsers } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";

const DEFAULT_DATA = { users: [], nextCursor: null, total: 0, notAvailable: [] };

export function useAdminUsers(params = {}) {
  const { q = "", cursor, limit } = params;
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(DEFAULT_DATA);
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
      const d = await fetchAdminUsers({ q, cursor, limit });
      blockRefetchRef.current = false;
      setData({
        users: d?.users ?? [],
        nextCursor: d?.nextCursor ?? null,
        total: d?.total ?? 0,
        notAvailable: d?.notAvailable ?? [],
      });
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
        setErrorMessage(msg ?? "Failed to load users");
      }
    }
  }, [q, cursor, limit]);

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
    users: data.users,
    nextCursor: data.nextCursor,
    total: data.total,
    notAvailable: data.notAvailable,
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
  };
}
