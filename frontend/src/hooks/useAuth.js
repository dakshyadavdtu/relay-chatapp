/**
 * Phase 6C: Frontend trusts ONLY /api/me for auth state.
 * - Login/register: POST credentials, then GET /api/me; set auth ONLY if /api/me succeeds.
 * - Startup: GET /api/me resolves initial auth state (isLoading until complete).
 */
import { useState, useEffect, useCallback } from "react";
import { getAuthState, setAuthState, subscribeAuth } from "@/state/auth.state";
import { getCurrentUser, loginUser as loginUserApi, registerUser as registerUserApi, logoutUser as logoutUserApi } from "@/http/auth.api";
import { wsClient } from "@/transport/wsClient";
import { emitAuthChanged } from "@/lib/authEvents";
import { clearRefreshDisabledUntilLogin } from "@/lib/http";

let authInitPromise = null;

function runAuthInitOnce() {
  if (authInitPromise) return authInitPromise;
  authInitPromise = (async function init() {
    setAuthState({ isLoading: true, error: null });
    try {
      const user = await getCurrentUser();
      setAuthState({ user: user ?? null, isAuthenticated: !!user, error: null });
    } catch (err) {
      if (err?.status === 429) {
        // rate limited
      }
      setAuthState({ user: null, isAuthenticated: false, error: null });
    } finally {
      setAuthState({ isLoading: false });
    }
  })();
  return authInitPromise;
}

export function useAuth() {
  const [state, setState] = useState(getAuthState);

  useEffect(() => {
    return subscribeAuth(() => setState(getAuthState()));
  }, []);

  useEffect(() => {
    runAuthInitOnce();
  }, []);

  const login = useCallback(async (data) => {
    setAuthState({ isLoading: true, error: null });
    try {
      await loginUserApi(data);
      const user = await getCurrentUser();
      if (!user) {
        setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: "Session could not be verified. Please try again." });
        throw new Error("Session could not be verified");
      }
      setAuthState({ user, isAuthenticated: true, isLoading: false, error: null });
      clearRefreshDisabledUntilLogin();
      emitAuthChanged('login', { userId: user?.id });
      return user;
    } catch (e) {
      setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: e.message || "Login failed" });
      throw e;
    }
  }, []);

  const register = useCallback(async (data) => {
    setAuthState({ isLoading: true, error: null });
    try {
      await registerUserApi(data);
      const user = await getCurrentUser();
      if (!user) {
        setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: "Session could not be verified. Please try again." });
        throw new Error("Session could not be verified");
      }
      setAuthState({ user, isAuthenticated: true, isLoading: false, error: null });
      clearRefreshDisabledUntilLogin();
      emitAuthChanged('login', { userId: user?.id });
      return user;
    } catch (e) {
      setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: e.message || "Registration failed" });
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthState({ isLoading: true });
    try {
      wsClient.shutdown('logout'); // Phase 5: close WS cleanly and disable reconnect before clearing auth
      await logoutUserApi();
    } finally {
      setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: null });
      emitAuthChanged('logout');
    }
  }, []);

  return {
    user: state.user,
    isLoading: state.isLoading,
    isAuthenticated: state.isAuthenticated,
    error: state.error,
    login,
    register,
    logout,
    isLoggingIn: state.isLoading,
    isRegistering: state.isLoading,
    isLoggingOut: state.isLoading,
    loginError: state.error,
    registerError: state.error,
  };
}
