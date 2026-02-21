/**
 * Phase 3: Single WebSocket client for chat. Cookie auth (same-origin).
 * Phase 6E: disconnect() disables reconnect; connect() re-enables (login again).
 * HELLO first; auto-reconnect with backoff.
 * Incoming: HELLO_ACK, MESSAGE_ACK, MESSAGE_RECEIVE, MESSAGE_ERROR, ERROR, RATE_LIMIT_WARNING, MESSAGE_REPLAY_COMPLETE, PONG, RESYNC_START, RESYNC_COMPLETE, STATE_SYNC_RESPONSE.
 * Outgoing: HELLO, MESSAGE_SEND, CLIENT_ACK, PING (keepalive), RESUME, MESSAGE_REPLAY, STATE_SYNC.
 */

import { MAX_CONTENT_LENGTH } from "@/config/wsContract";
import { getWsUrl } from "@/config/ws";
import { onAuthChanged } from "@/lib/authEvents";

const PROTOCOL_VERSION = 1;
const HELLO = { type: "HELLO", version: PROTOCOL_VERSION };
const PING_MSG = { type: "PING" };

/** B1: must match backend WS path (default /ws). */
const DEFAULT_WS_PATH = "/ws";
const PING_INTERVAL_MS = 30000;
const PRESENCE_PING_INTERVAL_MS = 60000;

/** Monotonic counter: incremented on each connect and on close. Used for timer diagnostics and self-stop. */
let connectionGeneration = 0;

let ws = null;
let reconnectTimer = null;
let pingTimer = null;
/** WebSocket instance that owns the current ping timer; only clear in onclose when closedWs === pingTimerOwner. */
let pingTimerOwner = null;
let presenceTimer = null;
let presenceTimerOwner = null;
let backoffMs = 1000;
const maxBackoffMs = 30000;
/** Slower backoff for 1011 "Session not ready": 500ms → 1s → 2s, max 5s (avoids reconnect spam). */
let sessionNotReadyBackoffMs = 500;
const SESSION_NOT_READY_MAX_MS = 5000;
const listeners = new Set();
let ready = false;
let connectionStatus = "disconnected"; // disconnected | connecting | connected
/** Phase 6E: When true, onclose does not schedule reconnect (auth expiry / logout). */
let reconnectDisabled = false;
/** Phase C: Debounce timer for auth change reconnects (multiple changes within 500ms -> single reconnect). */
let authReconnectTimer = null;
const AUTH_RECONNECT_DEBOUNCE_MS = 750;

/** Phase 5: When true, connect() is no-op; reconnect never scheduled; WS_AUTH_FAILED not emitted on close. Cleared by clearShutdown() on login. */
let _shutdown = false;

/** Phase 4: Rate-limit cooldown. send() returns false while now < rateLimitUntil. Exponential backoff when no retryAfterMs. */
const RATE_LIMIT_DEFAULT_MS = 2000;
const RATE_LIMIT_MAX_BACKOFF_MS = 30000;
let rateLimitUntil = 0;
let rateLimitBackoffMs = RATE_LIMIT_DEFAULT_MS;

/**
 * Decode inbound WS_RATE_LIMIT / ERROR payload for cooldown and UI.
 * @returns {{ retryAfterMs?: number, reason?: string, code?: string }}
 */
function decodeRateLimitPayload(msg) {
  if (!msg || typeof msg !== "object") return {};
  const reason = msg.error ?? msg.warning ?? msg.message ?? "";
  const code = msg.code ?? null;
  const resetAt = msg.resetAt != null ? Number(msg.resetAt) : NaN;
  const retryAfterMs =
    Number.isFinite(resetAt) && resetAt > 0
      ? Math.max(0, resetAt - Date.now())
      : undefined;
  return { retryAfterMs, reason, code };
}

function applyRateLimitCooldown(payload) {
  const { retryAfterMs } = decodeRateLimitPayload(payload);
  const cooldownMs = retryAfterMs ?? rateLimitBackoffMs;
  rateLimitUntil = Date.now() + cooldownMs;
  rateLimitBackoffMs = Math.min(
    (rateLimitBackoffMs || RATE_LIMIT_DEFAULT_MS) * 2,
    RATE_LIMIT_MAX_BACKOFF_MS
  );
}

function isRateLimited() {
  return Date.now() < rateLimitUntil;
}

function getRateLimitUntil() {
  return rateLimitUntil;
}

function setStatus(status) {
  if (connectionStatus === status) return;
  connectionStatus = status;
  listeners.forEach((handler) => {
    try {
      if (handler.onStatus) handler.onStatus(status);
    } catch (_) {}
  });
}

function emit(msg) {
  listeners.forEach((handler) => {
    try {
      if (handler.handleMessage) handler.handleMessage(msg);
    } catch (_) {}
  });
}

/**
 * Clear PING timer. If onlyIfOwner is provided, clear only when the current timer owner is that socket (avoids clearing new connection's timer when old onclose runs).
 */
function clearPingTimer(onlyIfOwner = null) {
  if (pingTimer == null) return;
  if (onlyIfOwner != null && pingTimerOwner !== onlyIfOwner) return;
  clearInterval(pingTimer);
  pingTimer = null;
  pingTimerOwner = null;
}

function clearPresenceTimer(onlyIfOwner = null) {
  if (presenceTimer == null) return;
  if (onlyIfOwner != null && presenceTimerOwner !== onlyIfOwner) return;
  clearInterval(presenceTimer);
  presenceTimer = null;
  presenceTimerOwner = null;
}

/** Start exactly one PING interval for this connection. Clears any previous; only cleared when this connection closes or on disconnect/shutdown. */
function startPingKeepalive() {
  clearPingTimer();
  if (pingTimer != null) return;
  const owner = ws;
  if (!owner) return;
  pingTimerOwner = owner;
  const gen = connectionGeneration;
  pingTimer = setInterval(() => {
    if (connectionGeneration !== gen || ws !== pingTimerOwner || !owner || owner.readyState !== WebSocket.OPEN || !ready) {
      clearPingTimer(owner);
      return;
    }
    try {
      owner.send(JSON.stringify(PING_MSG));
    } catch {
      // ignore
    }
  }, PING_INTERVAL_MS);
}

/** Start exactly one PRESENCE_PING interval for this connection. Same lifecycle as PING. */
function startPresenceKeepalive() {
  clearPresenceTimer();
  if (presenceTimer != null) return;
  const owner = ws;
  if (!owner) return;
  presenceTimerOwner = owner;
  const gen = connectionGeneration;
  presenceTimer = setInterval(() => {
    if (connectionGeneration !== gen || ws !== presenceTimerOwner || !owner || owner.readyState !== WebSocket.OPEN || !ready) {
      clearPresenceTimer(owner);
      return;
    }
    try {
      owner.send(JSON.stringify({ type: "PRESENCE_PING", status: "online" }));
    } catch {
      // ignore
    }
  }, PRESENCE_PING_INTERVAL_MS);
}

function connect(wsPath = DEFAULT_WS_PATH) {
  if (_shutdown) return; // Phase 5: no /ws attempts after logout until clearShutdown() (e.g. on login)
  reconnectDisabled = false; // Allow reconnect on future close (login again)
  // Idempotent: already connected or connecting => return without creating a new socket (avoids duplicate connections on effect reruns/remounts).
  if (ws != null && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) return;

  const url = getWsUrl(wsPath);
  if (!url) return;
  connectionGeneration++;
  setStatus("connecting");
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus("disconnected");
    scheduleReconnect(wsPath);
    return;
  }
  ws.onopen = () => {
    backoffMs = 1000;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(HELLO));
      } catch (e) {
        // ignore
      }
    }
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "error") msg.type = "ERROR";
      if (msg.type === "HELLO_ACK") {
        ready = true;
        sessionNotReadyBackoffMs = 500; // reset so next 1011 starts at 500 again
        setStatus("connected");
        startPingKeepalive();
        startPresenceKeepalive();
        emit(msg);
        return;
      }
      if (msg.type === "ERROR" || msg.type === "MESSAGE_ERROR") {
        const code = (msg.code || "").toUpperCase();
        const isRateLimit = code === "RATE_LIMIT_EXCEEDED" || code === "RATE_LIMITED" || (msg.message || "").toLowerCase().includes("rate limit");
        if (isRateLimit) applyRateLimitCooldown(msg);
        emit({ type: "ERROR", ...msg });
        return;
      }
      if (msg.type === "RATE_LIMIT_WARNING") {
        applyRateLimitCooldown(msg);
        emit(msg);
        return;
      }
      if (msg.type === "MESSAGE_REPLAY_COMPLETE") {
        emit(msg);
        return;
      }
      if (msg.type === "PONG") {
        emit(msg);
        return;
      }
      if (msg.type === "MESSAGE_ACK" || msg.type === "MESSAGE_RECEIVE" || msg.type === "MESSAGE_READ" || msg.type === "MESSAGE_STATE_UPDATE" || msg.type === "ACK_RESPONSE" || msg.type === "MESSAGE_MUTATION" || msg.type === "MESSAGE_MUTATION_ACK") {
        emit(msg);
        return;
      }
      if (msg.type === "RESYNC_START" || msg.type === "RESYNC_COMPLETE" || msg.type === "STATE_SYNC_RESPONSE") {
        emit(msg);
        return;
      }
      if (msg.type === "TYPING_START" || msg.type === "TYPING_STOP") {
        emit(msg);
        return;
      }
      if (msg.type === "PRESENCE_UPDATE" || msg.type === "PRESENCE_PONG" || msg.type === "PRESENCE_SNAPSHOT") {
        emit(msg);
        return;
      }
      if (msg.type === "ROOMS_SNAPSHOT" || msg.type === "ROOM_CREATED" || msg.type === "ROOM_UPDATED" || msg.type === "ROOM_MEMBERS_UPDATED" || msg.type === "ROOM_DELETED" || msg.type === "ROOM_LIST_RESPONSE" || msg.type === "ROOM_INFO_RESPONSE" || msg.type === "ROOM_MEMBERS_RESPONSE" || msg.type === "ROOM_CREATE_RESPONSE" || msg.type === "ROOM_JOIN_RESPONSE" || msg.type === "ROOM_LEAVE_RESPONSE" || msg.type === "ROOM_MESSAGE_RESPONSE" || msg.type === "ROOM_MESSAGE" || msg.type === "ROOM_MEMBER_JOINED" || msg.type === "ROOM_MEMBER_LEFT") {
        emit(msg);
        return;
      }
      if (msg.type === "SYSTEM_CAPABILITIES" || msg.type === "CONNECTION_ESTABLISHED") {
        emit(msg);
        return;
      }
      emit(msg);
    } catch {
      // ignore non-JSON
    }
  };
  ws.onclose = (ev) => {
    const code = ev?.code;
    const reasonStr = ev?.reason != null && typeof ev.reason === "string" ? ev.reason : (ev?.reason != null ? String(ev.reason) : "");
    const reason = ev?.reason != null && typeof ev.reason === 'string' ? ev.reason : (ev?.reason != null ? String(ev.reason) : '');
    const reasonLower = (reason || '').toLowerCase();
    // Auth close: do NOT reconnect; route to login. Codes 1008/4001/4005/4401/4403, or reason suggests auth.
    // Backwards compat: code 1000 with reason session_expired or logout still treated as auth (no reconnect loop).
    const reasonSuggestsAuth = /unauth|forbidden|401|403/.test(reasonLower);
    const isSessionExpiredReason = reasonLower.includes('session_expired');
    const isLogoutReason = reasonLower.includes('logout');
    const isAuthClose =
      code === 1008 || // POLICY_VIOLATION (backend: "Not authenticated", etc.)
      code === 4001 || // UNAUTHORIZED (client shutdown(session_expired|logout) or server auth failure)
      code === 4005 || // SESSION_INVALID / context rehydration failed
      code === 4401 || code === 4403 || // custom auth close
      reasonSuggestsAuth ||
      (code === 1000 && (isSessionExpiredReason || isLogoutReason)); // backwards compat
    const isSessionNotReady = code === 1011 && reasonLower.includes('session not ready');
    const isLogoutClose = code === 1000 && reasonLower.includes('logout'); // client shutdown('logout') with legacy 1000
    const closedWs = ws;
    connectionGeneration++;
    ready = false;
    ws = null;
    clearPingTimer(closedWs);
    clearPresenceTimer(closedWs);
    if (_shutdown || isLogoutClose) {
      reconnectDisabled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("disconnected");
      return; // Phase 5: no reconnect, no WS_AUTH_FAILED on logout (user-initiated)
    }
    // Phase 6: Account suspended/ban — one message, no reconnect
    if (code === 4003) {
      _shutdown = true;
      reconnectDisabled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("disconnected");
      emit({ type: "WS_ACCOUNT_SUSPENDED" });
      return;
    }
    if (isSessionNotReady) {
      // Keep status "connecting" to avoid rapid UI flip; use slower reconnect (1500 → 2500 → cap 8000)
      if (!reconnectDisabled) scheduleReconnect(wsPath, code, true);
      return;
    }
    setStatus("disconnected");
    // Emit WS_AUTH_FAILED only for explicit auth close (1008, 4001, 4005, or reason unauth|forbidden|401|403). Never for 1000/1001/1005/1006.
    if (isAuthClose) {
      reconnectDisabled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      emit({ type: "WS_AUTH_FAILED" });
    } else {
      // Normal/abnormal close (1000, 1001, 1005, 1006): will reconnect; allow optional "Disconnected. Reconnecting..." in UI.
      const isNormalOrAbnormalClose = code === 1000 || code === 1001 || code === 1005 || code === 1006;
      if (isNormalOrAbnormalClose && !reconnectDisabled) {
        emit({ type: "WS_DISCONNECTED_RECONNECTING", code, reason });
      }
    }
    if (!reconnectDisabled) scheduleReconnect(wsPath, code);
  };
  ws.onerror = () => {
    // close will fire after
  };
}

/**
 * Phase C: Schedule reconnect due to auth change (refresh/login/logout).
 * Debounced: multiple auth changes within debounce window -> single reconnect.
 * If WS is OPEN/CONNECTING, closes gracefully first; if CLOSED, connects immediately.
 */
function scheduleWsReauthReconnect(reason) {
  if (_shutdown) return; // Never reconnect if shutdown
  if (reconnectTimer) return; // Already scheduled a reconnect
  
  // Debounce: clear existing timer and set new one
  if (authReconnectTimer) {
    clearTimeout(authReconnectTimer);
    authReconnectTimer = null;
  }
  
  authReconnectTimer = setTimeout(() => {
    authReconnectTimer = null;
    
    const currentState = ws?.readyState;
    const isOpen = currentState === WebSocket.OPEN;
    const isConnecting = currentState === WebSocket.CONNECTING;

    if (isOpen || isConnecting) {
      // Gracefully close, then reconnect immediately (reset backoff for auth changes)
      if (ws) {
        const wasOpen = isOpen;
        try {
          ws.close(1000, `auth_changed:${reason}`);
        } catch (_) {
          // If close fails, force cleanup
        }
        // Cleanup immediately and reconnect (don't wait for onclose)
        ws = null;
        ready = false;
        clearPingTimer();
        clearPresenceTimer();
        setStatus("disconnected");
        backoffMs = 1000; // Reset backoff for auth-initiated reconnect
        connect();
      }
    } else {
      // WS is CLOSED or null -> connect immediately
      backoffMs = 1000; // Reset backoff for auth-initiated reconnect
      connect();
    }
  }, AUTH_RECONNECT_DEBOUNCE_MS);
}

function scheduleReconnect(wsPath, closeCode, useSessionNotReadyBackoff = false) {
  if (_shutdown) return; // Phase 5: never reconnect after shutdown
  if (reconnectTimer) return;
  if (useSessionNotReadyBackoff) {
    const delay = sessionNotReadyBackoffMs;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Optional: app may set window.__refreshAuthBeforeReconnect to refresh token once before retry
      if (typeof window !== "undefined" && typeof window.__refreshAuthBeforeReconnect === "function") {
        try {
          window.__refreshAuthBeforeReconnect();
        } catch (_) {}
      }
      connect(wsPath);
      // 500 → 1000 → 2000 → cap 5000
      if (sessionNotReadyBackoffMs >= SESSION_NOT_READY_MAX_MS) {
        sessionNotReadyBackoffMs = SESSION_NOT_READY_MAX_MS;
      } else if (sessionNotReadyBackoffMs === 500) {
        sessionNotReadyBackoffMs = 1000;
      } else if (sessionNotReadyBackoffMs === 1000) {
        sessionNotReadyBackoffMs = 2000;
      } else {
        sessionNotReadyBackoffMs = SESSION_NOT_READY_MAX_MS;
      }
    }, delay);
    return;
  }
  // WS-5: auth/session close (4001, 4005, 4401, 4403) → increase backoff faster; 1008 excluded (policy/rate-limit)
  const isAuthClose = closeCode === 4001 || closeCode === 4005 || closeCode === 4401 || closeCode === 4403;
  const multiplier = isAuthClose ? 3 : 2;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(wsPath);
    backoffMs = Math.min(maxBackoffMs, backoffMs * multiplier);
  }, backoffMs);
}

function disconnect() {
  reconnectDisabled = true; // Prevent onclose from scheduling reconnect
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (authReconnectTimer) {
    clearTimeout(authReconnectTimer);
    authReconnectTimer = null;
  }
  clearPingTimer();
  clearPresenceTimer();
  backoffMs = 1000;
  if (ws) {
    ws.close();
    ws = null;
  }
  ready = false;
  setStatus("disconnected");
}

/** WebSocket close reason max length (bytes, RFC 6455). */
const MAX_CLOSE_REASON_BYTES = 123;

/** Truncate reason string to ≤123 bytes UTF-8 so close() does not break. */
function truncateCloseReason(s) {
  if (s == null || typeof s !== "string") return "";
  try {
    const enc = new TextEncoder().encode(s);
    if (enc.length <= MAX_CLOSE_REASON_BYTES) return s;
    return new TextDecoder().decode(enc.slice(0, MAX_CLOSE_REASON_BYTES));
  } catch {
    return s.slice(0, 123);
  }
}

/**
 * Close codes: 4001 = UNAUTHORIZED (auth; no reconnect). 1000 = NORMAL (clean close).
 * 4401/4403 = custom auth (server may use); we treat same as 4001 in onclose.
 * Reason string must be ≤123 bytes (RFC 6455); truncateCloseReason enforces that.
 */
const WS_CLOSE_AUTH = 4001;   // UNAUTHORIZED — session_expired, logout
const WS_CLOSE_NORMAL = 1000; // NORMAL

/**
 * Phase 5: Clean shutdown. For session_expired/logout use auth close code 4001 so server and client
 * treat as auth failure (no reconnect loop). Otherwise use 1000 (normal close). Reason ≤123 bytes.
 */
function shutdown(reason) {
  _shutdown = true;
  reconnectDisabled = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (authReconnectTimer) {
    clearTimeout(authReconnectTimer);
    authReconnectTimer = null;
  }
  clearPingTimer();
  clearPresenceTimer();
  const rawReason = (reason && String(reason).trim()) || "logout";
  const isAuthShutdown = rawReason === "session_expired" || rawReason === "logout";
  const closeCode = isAuthShutdown ? WS_CLOSE_AUTH : WS_CLOSE_NORMAL;
  const closeReason = truncateCloseReason(rawReason);
  if (ws) {
    try {
      ws.close(closeCode, closeReason);
    } catch (_) {}
    ws = null;
  }
  ready = false;
  setStatus("disconnected");
}

/** Phase 5: Clear shutdown so connect() can run again (call when user logs in). */
function clearShutdown() {
  _shutdown = false;
}

function isShutdown() {
  return _shutdown;
}

function send(payload) {
  if (isRateLimited()) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN || !ready) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function sendMessage(recipientId, content, clientMessageId) {
  if (typeof content !== "string" || content.length > MAX_CONTENT_LENGTH) return false;
  return send({
    type: "MESSAGE_SEND",
    recipientId,
    content,
    clientMessageId: clientMessageId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
  });
}

function sendClientAck(messageId, ackType) {
  if (!messageId) return false;
  return send({ type: "CLIENT_ACK", messageId, ackType: ackType || "delivered" });
}

/** MESSAGE_DELIVERED_CONFIRM: backend deliveredAck handler. Payload: { messageId }. */
function sendMessageDeliveredConfirm(messageId) {
  if (!messageId) return false;
  return send({ type: "MESSAGE_DELIVERED_CONFIRM", messageId });
}

/** MESSAGE_READ: backend readAck handler. Payload: { messageId }. */
function sendMessageRead(messageId) {
  if (!messageId) return false;
  return send({ type: "MESSAGE_READ", messageId });
}

/** MESSAGE_EDIT: backend messageMutation handler. Payload: { messageId, content }. */
function sendMessageEdit(messageId, content) {
  if (!messageId || typeof content !== "string") return false;
  if (content.length > MAX_CONTENT_LENGTH) return false;
  return send({ type: "MESSAGE_EDIT", messageId, content });
}

/** MESSAGE_DELETE: backend messageMutation handler. Payload: { messageId }. */
function sendMessageDelete(messageId) {
  if (!messageId) return false;
  return send({ type: "MESSAGE_DELETE", messageId });
}

/** RESUME: reconnect resync. Backend expects { lastSeenMessageId?, limit? }. */
function sendResume(lastSeenMessageId, limit) {
  const payload = { type: "RESUME" };
  if (lastSeenMessageId != null) payload.lastSeenMessageId = lastSeenMessageId;
  if (limit != null) payload.limit = limit;
  return send(payload);
}

/** MESSAGE_REPLAY: explicit replay request. Backend expects { lastMessageId?, limit? }. */
function sendMessageReplay(lastMessageId, limit) {
  const payload = { type: "MESSAGE_REPLAY" };
  if (lastMessageId != null) payload.lastMessageId = lastMessageId;
  if (limit != null) payload.limit = limit;
  return send(payload);
}

/** STATE_SYNC: request state. Backend expects { lastMessageId?, lastReadMessageId? }. */
function sendStateSync(lastMessageId, lastReadMessageId) {
  const payload = { type: "STATE_SYNC" };
  if (lastMessageId != null) payload.lastMessageId = lastMessageId;
  if (lastReadMessageId != null) payload.lastReadMessageId = lastReadMessageId;
  return send(payload);
}

/** TYPING_START: backend expects { targetUserId } (DM) or { roomId } (room). No-ops until HELLO_ACK. */
function sendTypingStart(payload) {
  if (!payload?.targetUserId && !payload?.roomId) return false;
  const p = { type: "TYPING_START" };
  if (payload.targetUserId) p.targetUserId = payload.targetUserId;
  if (payload.roomId) p.roomId = payload.roomId;
  return send(p);
}

/** TYPING_STOP: backend expects { targetUserId } (DM) or { roomId } (room). No-ops until HELLO_ACK. */
function sendTypingStop(payload) {
  if (!payload?.targetUserId && !payload?.roomId) return false;
  const p = { type: "TYPING_STOP" };
  if (payload.targetUserId) p.targetUserId = payload.targetUserId;
  if (payload.roomId) p.roomId = payload.roomId;
  return send(p);
}

/** PRESENCE_PING: optional heartbeat. Backend returns PRESENCE_PONG; presence is connection-lifecycle. */
function sendPresencePing(payload) {
  const p = { type: "PRESENCE_PING" };
  if (payload?.status != null) p.status = payload.status;
  return send(p);
}

/** ROOM_LIST: request list of rooms. Backend returns ROOM_LIST_RESPONSE. Optional includeAll=true for all rooms. */
function sendRoomList(includeAll) {
  const payload = { type: "ROOM_LIST" };
  if (includeAll === true) payload.includeAll = true;
  return send(payload);
}

/** ROOM_INFO: request room metadata. Backend returns ROOM_INFO_RESPONSE. */
function sendRoomInfo(roomId) {
  if (!roomId) return false;
  return send({ type: "ROOM_INFO", roomId });
}

/** ROOM_MEMBERS: request room members. Backend returns ROOM_MEMBERS_RESPONSE. */
function sendRoomMembers(roomId) {
  if (!roomId) return false;
  return send({ type: "ROOM_MEMBERS", roomId });
}

/** ROOM_CREATE: create room. roomId optional (server-generated if omitted). name?, thumbnailUrl?, memberIds?, correlationId?. Returns ROOM_CREATED. */
function sendRoomCreate(payload) {
  const p = { type: "ROOM_CREATE" };
  if (payload?.roomId != null) p.roomId = String(payload.roomId).trim();
  if (payload?.name != null) p.name = payload.name;
  if (payload?.thumbnailUrl != null) p.thumbnailUrl = payload.thumbnailUrl;
  if (payload?.memberIds != null && Array.isArray(payload.memberIds)) p.memberIds = payload.memberIds;
  if (payload?.metadata != null && typeof payload.metadata === "object") p.metadata = payload.metadata;
  if (payload?.correlationId != null) p.correlationId = payload.correlationId;
  return send(p);
}

/** ROOM_JOIN: join room. Backend expects { roomId }. Returns ROOM_JOIN_RESPONSE. */
function sendRoomJoin(payload) {
  if (!payload?.roomId) return false;
  return send({ type: "ROOM_JOIN", roomId: String(payload.roomId).trim() });
}

/** ROOM_LEAVE: leave room. Backend expects { roomId }. Returns ROOM_LEAVE_RESPONSE. */
function sendRoomLeave(payload) {
  if (!payload?.roomId) return false;
  return send({ type: "ROOM_LEAVE", roomId: String(payload.roomId).trim() });
}

/** ROOM_MESSAGE: send room message. Backend expects { roomId (required), content (required), clientMessageId?, messageType? }. Returns ROOM_MESSAGE_RESPONSE. */
function sendRoomMessage(payload) {
  if (!payload?.roomId || typeof payload.content !== "string") return false;
  if (payload.content.length > MAX_CONTENT_LENGTH) return false;
  const p = { type: "ROOM_MESSAGE", roomId: String(payload.roomId).trim(), content: payload.content };
  if (payload.clientMessageId != null) p.clientMessageId = String(payload.clientMessageId);
  if (payload.messageType != null) p.messageType = payload.messageType;
  return send(p);
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getStatus() {
  return connectionStatus;
}

function isReady() {
  return ready && ws?.readyState === WebSocket.OPEN;
}

export const wsClient = {
  connect,
  disconnect,
  shutdown,
  clearShutdown,
  isShutdown,
  send,
  sendMessage,
  sendClientAck,
  sendMessageDeliveredConfirm,
  sendMessageRead,
  sendMessageEdit,
  sendMessageDelete,
  sendResume,
  sendMessageReplay,
  sendStateSync,
  sendTypingStart,
  sendTypingStop,
  sendPresencePing,
  sendRoomList,
  sendRoomInfo,
  sendRoomMembers,
  sendRoomCreate,
  sendRoomJoin,
  sendRoomLeave,
  sendRoomMessage,
  subscribe,
  getStatus,
  isReady,
  isRateLimited,
  getRateLimitUntil,
  getWsUrl,
  MAX_CONTENT_LENGTH,
};

// Phase C: Reconnect on token refresh only. React effect owns connect on login; wsClient owns reconnect after transient close.
// Skip 'login' so we don't double-connect (effect already connects). 'refresh' needs one reconnect to use new token.
onAuthChanged((reason) => {
  if (reason === 'login') return; // React effect owns initial connect
  scheduleWsReauthReconnect(reason);
});
