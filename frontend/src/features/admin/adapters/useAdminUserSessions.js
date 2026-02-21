/**
 * Admin user sessions adapter - fetches from GET /api/admin/users/:id/sessions.
 * State machine: idle -> loading -> success | error.
 * Fetches when userId changes. Returns empty sessions when userId is null or on error.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAdminUserSessions } from "../api/admin.api";
import { getAuthState } from "@/state/auth.state";

const DEFAULT_SESSIONS = [];

export function useAdminUserSessions(userId) {
  const [status, setStatus] = useState("idle");
  const [sessions, setSessions] = useState(DEFAULT_SESSIONS);
  const [errorKey, setErrorKey] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const blockRefetchRef = useRef(false);

  const refetch = useCallback(async () => {
    if (!userId) {
      setSessions(DEFAULT_SESSIONS);
      setStatus("idle");
      return;
    }
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
      const d = await fetchAdminUserSessions(userId, { liveOnly: true, limit: 10 });
      blockRefetchRef.current = false;
      setSessions(Array.isArray(d?.sessions) ? d.sessions : DEFAULT_SESSIONS);
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
        setErrorMessage(e?.message ?? "Failed to load sessions");
      }
      setSessions(DEFAULT_SESSIONS);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setSessions(DEFAULT_SESSIONS);
      setStatus("idle");
      return;
    }
    if (blockRefetchRef.current) return;
    refetch();
  }, [userId, refetch]);

  const loading = status === "loading";
  const error = errorMessage;
  const forbidden = errorKey === "FORBIDDEN";
  const unauthorized = errorKey === "UNAUTHORIZED";
  const canRetry = errorKey === "SERVER_ERROR" || errorKey === "NOT_FOUND";

  return {
    sessions: sessions ?? DEFAULT_SESSIONS,
    loading,
    error,
    errorKey,
    forbidden,
    unauthorized,
    canRetry,
    refetch,
  };
}
