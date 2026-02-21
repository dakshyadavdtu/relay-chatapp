/**
 * Auth API - login, logout, getCurrentUser. Uses lib/http apiFetch (Vite proxy /api).
 * Phase 3: Mock auth removed; always calls real backend endpoints.
 * When VITE_DEV_TOKEN_MODE=true, login returns tokens and stores in sessionStorage; logout uses /logout/current.
 */
import { apiFetch, UnauthorizedError } from "@/lib/http";
import { isDevTokenMode, setTokens, clearTokens } from "@/features/auth/tokenTransport";
import { isCookieMode, setLastSeenUserId } from "@/features/auth/sessionSwitch";
import { emitAuthChanged } from "@/lib/authEvents";

export async function getCurrentUser() {
  try {
    const json = await apiFetch("/api/me");
    const user = json?.data?.user ?? null;
    if (isCookieMode() && user?.id) setLastSeenUserId(user.id);
    return user;
  } catch (e) {
    if (e instanceof UnauthorizedError || e?.code === "UNAUTHORIZED") return null;
    throw e;
  }
}

export async function loginUser(data) {
  const headers = isDevTokenMode() ? { "x-dev-token-mode": "1" } : undefined;
  const json = await apiFetch("/api/login", {
    method: "POST",
    body: data,
    ...(headers && { headers: { ...headers } }),
  });
  if (isDevTokenMode() && json?.data?.accessToken != null) {
    setTokens({
      accessToken: json.data.accessToken,
      refreshToken: json.data.refreshToken ?? null,
    });
    emitAuthChanged('token_rotated', { hasRefreshToken: !!json.data.refreshToken });
  }
  return json;
}

export async function registerUser(data) {
  const json = await apiFetch("/api/register", { method: "POST", body: data });
  return json;
}

export async function logoutUser() {
  if (isDevTokenMode()) {
    await apiFetch("/api/logout/current", { method: "POST", body: {} });
    clearTokens();
  } else {
    await apiFetch("/api/logout", { method: "POST", body: {} });
  }
  return { success: true };
}

/**
 * Update current user profile (displayName, avatarUrl only). Email cannot be updated.
 * @param {{ displayName?: string, avatarUrl?: string | null }} payload
 * @returns {{ user, capabilities }}
 */
export async function patchMe(payload) {
  const json = await apiFetch("/api/me", { method: "PATCH", body: payload });
  return json?.data ?? {};
}

/**
 * Change password for authenticated user.
 * @param {{ currentPassword: string, newPassword: string }} payload
 * @returns {{ success: boolean }}
 */
export async function changePassword(payload) {
  const json = await apiFetch("/api/me/password", { method: "PATCH", body: payload });
  return json?.data ?? {};
}
