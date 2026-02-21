/**
 * Phase 4: Server-side UI preferences fetch and update.
 * GET/PATCH /api/me/ui-preferences. Auth via apiFetch (cookies / dev token).
 */

import { apiFetch, getApiOrigin } from "@/lib/http";
import { isDevTokenMode, getAccessToken } from "@/features/auth/tokenTransport";

const UI_PREFS_PATH = "/api/me/ui-preferences";

/**
 * Fetch UI preferences from server.
 * @returns {Promise<{ soundNotifications: boolean, desktopNotifications: boolean } | null>}
 * Returns null on failure (network error, 401, etc.).
 */
export async function fetchServerUiPrefs() {
  try {
    const json = await apiFetch(UI_PREFS_PATH, { method: "GET" });
    const uiPreferences = json?.data?.uiPreferences;
    if (uiPreferences && typeof uiPreferences === "object") {
      return {
        soundNotifications: typeof uiPreferences.soundNotifications === "boolean" ? uiPreferences.soundNotifications : null,
        desktopNotifications: typeof uiPreferences.desktopNotifications === "boolean" ? uiPreferences.desktopNotifications : null,
      };
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Update UI preferences on the server (PATCH /api/me/ui-preferences).
 * Body: { soundNotifications?: boolean, desktopNotifications?: boolean }
 * @param {{ soundNotifications?: boolean, desktopNotifications?: boolean }} patch
 * @returns {Promise<void>} Resolves on success; rejects on non-2xx or network error.
 */
export async function updateServerUiPrefs(patch) {
  if (!patch || typeof patch !== "object") return;
  const body = {};
  if (typeof patch.soundNotifications === "boolean") body.soundNotifications = patch.soundNotifications;
  if (typeof patch.desktopNotifications === "boolean") body.desktopNotifications = patch.desktopNotifications;
  if (Object.keys(body).length === 0) return;
  await apiFetch(UI_PREFS_PATH, { method: "PATCH", body });
}

/**
 * Best-effort flush of UI prefs to server on page unload (beforeunload/pagehide).
 * Used when a debounced sync is still pending so we don't lose the user's toggle on refresh.
 * sendBeacon does not support PATCH, so we use fetch(..., { keepalive: true }) so the
 * browser may complete the request after the page is torn down. Fire-and-forget; no await.
 * Only call when a pending sync exists (store checks serverSyncDebounceTimer) to avoid spamming.
 * @param {{ soundNotifications?: boolean, desktopNotifications?: boolean }} patch
 */
export function flushServerUiPrefsOnUnload(patch) {
  if (typeof window === "undefined" || !patch || typeof patch !== "object") return;
  const body = {};
  if (typeof patch.soundNotifications === "boolean") body.soundNotifications = patch.soundNotifications;
  if (typeof patch.desktopNotifications === "boolean") body.desktopNotifications = patch.desktopNotifications;
  if (Object.keys(body).length === 0) return;

  const base = getApiOrigin() || window.location?.origin;
  if (!base) return;
  const url = `${base}${UI_PREFS_PATH}`;
  const headers = { "Content-Type": "application/json" };
  if (isDevTokenMode()) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["x-dev-token-mode"] = "1";
    }
  }
  fetch(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers,
    credentials: isDevTokenMode() ? "omit" : "include",
    keepalive: true,
  }).catch(() => {});
}
