/**
 * Phase 7B: UI preferences store (subscribe pattern).
 * Single source of truth for UI prefs; no direct DOM manipulation outside uiPrefs.apply.
 * Safe-apply: local user toggles win over server hydration when changed recently (see applyServerPrefIfNotOverridden).
 * Client->server sync: debounced PATCH on soundNotifications/desktopNotifications so hydration matches user toggles.
 */

import contract from "@/contracts/uiPreferences.contract.json";
import { hydrate } from "../uiPrefs.hydrate";
import { apply } from "../uiPrefs.apply";
import { persist } from "../uiPrefs.persist";
import { updateServerUiPrefs, flushServerUiPrefsOnUnload } from "../uiPrefs.server";
import { getAuthState } from "@/state/auth.state";

/** Default window (ms): if user changed pref locally within this time, server apply is skipped. */
export const RECENT_LOCAL_WINDOW_MS = 60 * 1000;

/** Debounce (ms) before sending patch to server; only last value is sent when toggling quickly. */
const SERVER_SYNC_DEBOUNCE_MS = 300;
/** Retries on transient failure (total attempts = 1 + SERVER_SYNC_MAX_RETRIES). */
const SERVER_SYNC_MAX_RETRIES = 2;
/** Base delay (ms) for exponential backoff: 500, 1000. */
const SERVER_SYNC_BACKOFF_BASE_MS = 500;

let state = { ...contract.defaults };
const listeners = new Set();

/** key -> timestamp (Date.now()) when user last set this pref via setUiPref. */
const lastLocalChangeAt = {};
/** key -> timestamp when server value was last applied (for debugging). */
const lastServerApplyAt = {};

let serverSyncDebounceTimer = null;

function isValid(key, value) {
  const pref = contract.preferences[key];
  if (!pref) return false;
  if (pref.type === "boolean") return typeof value === "boolean";
  if (pref.type === "enum") return Array.isArray(pref.values) && pref.values.includes(value);
  return false;
}

function notify() {
  const snapshot = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (_) {}
  });
}

/**
 * Get current preferences (shallow copy).
 * @returns {Record<string, any>}
 */
export function getUiPrefs() {
  return { ...state };
}

/**
 * Timestamp when the user last changed this pref via setUiPref (for safe-apply).
 * @param {string} key
 * @returns {number | undefined}
 */
export function getLastLocalChangeAt(key) {
  return lastLocalChangeAt[key];
}

/**
 * Timestamp when server value was last applied for this key (debug).
 * @param {string} key
 * @returns {number | undefined}
 */
export function getLastServerApplyAt(key) {
  return lastServerApplyAt[key];
}

/**
 * True if a debounced server sync is scheduled (not yet flushed). Dev/debug only.
 * @returns {boolean}
 */
export function hasPendingServerSync() {
  return serverSyncDebounceTimer != null;
}

/**
 * Fire-and-forget: send current sound/desktop prefs to server with retries. Never blocks; failures do not revert local state.
 */
function flushSyncToServer() {
  serverSyncDebounceTimer = null;
  if (!getAuthState().isAuthenticated) return;
  const prefs = getUiPrefs();
  const patch = {
    soundNotifications: prefs.soundNotifications,
    desktopNotifications: prefs.desktopNotifications,
  };

  const attempt = (attemptIndex) => {
    return updateServerUiPrefs(patch)
      .catch((err) => {
        if (attemptIndex < SERVER_SYNC_MAX_RETRIES) {
          const delay = SERVER_SYNC_BACKOFF_BASE_MS * Math.pow(2, attemptIndex);
          setTimeout(() => attempt(attemptIndex + 1), delay);
        }
      });
  };
  attempt(0);
}

/**
 * Schedule a single debounced sync to server; rapid toggles result in only the last value being sent.
 */
function scheduleSyncToServer() {
  if (serverSyncDebounceTimer != null) {
    clearTimeout(serverSyncDebounceTimer);
  }
  serverSyncDebounceTimer = setTimeout(flushSyncToServer, SERVER_SYNC_DEBOUNCE_MS);
}

/**
 * Flush pending debounced sync on page unload (beforeunload/pagehide).
 * Fix for debounce race: if user toggles desktopNotifications then refreshes within 300ms,
 * the scheduled PATCH may never run. Here we send the current prefs with fetch(keepalive: true)
 * so the server can receive the update best-effort. Only runs when a sync is actually pending
 * (serverSyncDebounceTimer was set) so we don't spam the server on every unload.
 */
function flushPendingSyncOnUnload() {
  if (serverSyncDebounceTimer == null) return;
  clearTimeout(serverSyncDebounceTimer);
  serverSyncDebounceTimer = null;
  if (!getAuthState().isAuthenticated) return;
  const prefs = getUiPrefs();
  const patch = {
    soundNotifications: prefs.soundNotifications,
    desktopNotifications: prefs.desktopNotifications,
  };
  flushServerUiPrefsOnUnload(patch);
}

/**
 * Set a single preference. Validates against contract, persists, applies, notifies.
 * For soundNotifications/desktopNotifications, schedules a debounced PATCH to server (fire-and-forget).
 * @param {string} key - Preference key
 * @param {any} value - Value (must pass contract validation)
 */
export function setUiPref(key, value) {
  if (!isValid(key, value)) return;
  state = { ...state, [key]: value };
  // Record when user last changed this pref so server hydration won't overwrite recent local toggles (applyServerPrefIfNotOverridden).
  if (key === "soundNotifications" || key === "desktopNotifications") {
    lastLocalChangeAt[key] = Date.now();
  }
  persist(state);
  apply(state);
  notify();
  if (key === "soundNotifications" || key === "desktopNotifications") {
    scheduleSyncToServer();
  }
}

/**
 * Reset all preferences to contract defaults.
 */
export function resetUiPrefs() {
  state = { ...contract.defaults };
  persist(state);
  apply(state);
  notify();
}

/**
 * Bootstrap: load from storage, validate, apply. Call once on app init.
 * Registers beforeunload/pagehide to flush any pending debounced sync so a quick refresh
 * after toggling desktopNotifications still sends the PATCH (best-effort via fetch keepalive).
 * @returns {Record<string, any>} Hydrated prefs
 */
export function bootstrap() {
  const hydrated = hydrate();
  state = { ...hydrated };
  apply(state);

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flushPendingSyncOnUnload);
    window.addEventListener("pagehide", flushPendingSyncOnUnload);
  }
  return state;
}

/**
 * Apply a server-provided preference only if the user has not changed it recently (local wins).
 * Use for post-auth hydration so a recent local toggle is not overwritten.
 * @param {string} key - Preference key (e.g. "soundNotifications")
 * @param {any} value - Value (must pass contract validation)
 * @param {{ recentLocalWindowMs?: number }} [options] - Window in ms; default RECENT_LOCAL_WINDOW_MS
 * @returns {{ applied: boolean }} applied true if value was applied, false if skipped due to recent local change
 */
export function applyServerPrefIfNotOverridden(key, value, options = {}) {
  const windowMs = options.recentLocalWindowMs ?? RECENT_LOCAL_WINDOW_MS;
  const lastLocal = getLastLocalChangeAt(key);
  const now = Date.now();
  const recentLocal = lastLocal != null && now - lastLocal <= windowMs;

  if (recentLocal) {
    return { applied: false };
  }

  if (!isValid(key, value)) return { applied: false };
  state = { ...state, [key]: value };
  lastServerApplyAt[key] = Date.now();
  persist(state);
  apply(state);
  notify();
  return { applied: true };
}

/**
 * Dev assertion: user toggles sound off, then server returns true → final value stays false.
 * Call from browser (e.g. UiPrefsDebug) or test. Restores previous state after assert.
 * @returns {{ ok: boolean, message: string }}
 */
export function runSoundLocalWinsAssertion() {
  const before = getUiPrefs().soundNotifications;
  setUiPref("soundNotifications", false);
  const result = applyServerPrefIfNotOverridden("soundNotifications", true);
  const after = getUiPrefs().soundNotifications;
  setUiPref("soundNotifications", before);
  if (result.applied) {
    return {
      ok: false,
      message: `Expected server apply to be skipped (recent local change). applied=${result.applied}`,
    };
  }
  if (after !== false) {
    return {
      ok: false,
      message: `Expected soundNotifications to stay false after server apply skip. after=${after}`,
    };
  }
  return { ok: true, message: "Local sound toggle wins over server (assertion passed)." };
}

/**
 * Subscribe to preference changes.
 * @param {(prefs: Record<string, any>) => void} fn - Callback with new prefs
 * @returns {() => void} Unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
