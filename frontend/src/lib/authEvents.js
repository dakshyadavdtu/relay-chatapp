/**
 * Central auth change event system.
 * Allows components (e.g. WebSocket client) to react to auth mutations:
 * - login, logout, refresh, token rotation, session rotation
 * Phase D: Cross-tab broadcast so other tabs reconnect WS when one tab refreshes auth.
 */

import { getTabInstanceId } from '@/lib/tabId';

const listeners = new Set();
const BROADCAST_CHANNEL_NAME = 'auth_events';
const STORAGE_KEY = 'auth_events_broadcast';

/** Phase D: BroadcastChannel if available; otherwise null (use localStorage fallback). */
let broadcastChannel = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  } catch (_) {
    broadcastChannel = null;
  }
}

/**
 * Notify only local listeners (no cross-tab broadcast). Used when we receive from another tab.
 * @param {string} reason
 * @param {any} meta
 */
function emitAuthChangedInternal(reason, meta = {}) {
  listeners.forEach((callback) => {
    try {
      callback(reason, meta);
    } catch (err) {
      console.error('[authEvents] Listener error:', err);
    }
  });
}

/**
 * Phase D: Handle message from another tab (BroadcastChannel or storage event).
 * Guard: ignore if originTabId is this tab (avoid echo).
 */
function handleCrossTabMessage(payload) {
  if (!payload || typeof payload.reason !== 'string') return;
  const originTabId = payload.originTabId;
  const myTabId = getTabInstanceId();
  if (originTabId && originTabId === myTabId) return; // We sent it; don't echo
  emitAuthChangedInternal(payload.reason, payload.meta || {});
}

if (broadcastChannel) {
  broadcastChannel.onmessage = (ev) => {
    try {
      const payload = ev?.data;
      if (payload && typeof payload === 'object') handleCrossTabMessage(payload);
    } catch (_) {
      /* ignore */
    }
  };
} else if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      try {
        const payload = JSON.parse(e.newValue);
        if (payload && typeof payload === 'object') handleCrossTabMessage(payload);
      } catch (_) {
        /* ignore */
      }
    });
  } catch (_) {
    /* no cross-tab */
  }
}

/**
 * Subscribe to auth change events.
 * @param {(reason: string, meta?: any) => void} callback - Called when auth changes
 * @returns {() => void} Unsubscribe function
 */
export function onAuthChanged(callback) {
  if (typeof callback !== 'function') {
    console.warn('[authEvents] onAuthChanged: callback must be a function');
    return () => {};
  }
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Emit auth change event to all subscribers (this tab) and broadcast to other tabs.
 * @param {string} reason - Reason for change: "login", "logout", "refresh", "token_rotated", "session_rotated"
 * @param {any} meta - Optional metadata (e.g. correlationId, userId)
 */
export function emitAuthChanged(reason, meta = {}) {
  if (!reason || typeof reason !== 'string') {
    console.warn('[authEvents] emitAuthChanged: reason must be a non-empty string');
    return;
  }

  const originTabId = getTabInstanceId();
  const payload = { reason, meta: meta && typeof meta === 'object' ? meta : {}, originTabId };

  // 1) Notify local listeners
  emitAuthChangedInternal(reason, meta);

  // 2) Broadcast to other tabs (no re-broadcast loop: they use originTabId guard)
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch (_) {
      /* ignore */
    }
  } else if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, ts: Date.now() }));
    } catch (_) {
      /* ignore */
    }
  }
}
