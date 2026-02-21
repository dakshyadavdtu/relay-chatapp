/**
 * LEGACY WebSocket stack — HARD-DISABLED (all modes).
 * Chat route uses src/transport/wsClient.js only. Do not import this module.
 */
throw new Error("Legacy websocket stack disabled. Use src/transport/wsClient.js.");

/**
 * WebSocket connection core. Handles connect, disconnect, heartbeat, reconnect, event dispatch.
 * No React, no Redux. Uses auth.state and connection.state.
 */

import { getWsUrl } from "@/utils/api";
import { isTestMode } from "@/utils/testMode";
import { EVENTS } from "@/config/constants";
import { getAuthState, setAuthState } from "@/state/auth.state";
import { getConnectionState, setConnectionState } from "@/websocket/state/connection.state";

let socket = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;
const reconnectDelay = 1000;
const maxReconnectDelay = 30000;
let isManualDisconnect = false;
let heartbeatInterval = null;
const heartbeatIntervalMs = 30000;
let isConnectingRef = false;

const subscribers = new Map();

export function getStatus() {
  return getConnectionState().status;
}

export function resetAuthFailure() {
  setAuthState({ authFailureFlag: false });
}

export function subscribe(type, handler) {
  if (!subscribers.has(type)) {
    subscribers.set(type, new Set());
  }
  subscribers.get(type).add(handler);
  return () => {
    const handlers = subscribers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) subscribers.delete(type);
    }
  };
}

function dispatchEvent(type, payload) {
  const typeHandlers = subscribers.get(type);
  if (typeHandlers) {
    typeHandlers.forEach((h) => {
      try {
        h({ type, payload });
      } catch (e) {
        console.error(`[WS] Subscriber error for ${type}:`, e);
      }
    });
  }
  const wildcardHandlers = subscribers.get("*");
  if (wildcardHandlers) {
    wildcardHandlers.forEach((h) => {
      try {
        h({ type, payload });
      } catch (e) {
        console.error(`[WS] Wildcard subscriber error:`, e);
      }
    });
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "PING", payload: {} }));
      } catch (e) {
        console.error("[WS] Heartbeat failed:", e);
      }
    }
  }, heartbeatIntervalMs);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function getReconnectDelay() {
  return Math.min(reconnectDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay);
}

function attemptReconnect() {
  if (isManualDisconnect) return;
  if (getAuthState().authFailureFlag) {
    if (import.meta.env.DEV) console.log("[WS] Reconnect blocked due to auth failure");
    return;
  }
  reconnectAttempts++;
  const delay = getReconnectDelay();
  if (import.meta.env.DEV) console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  setConnectionState({ status: "reconnecting" });
  dispatchEvent(EVENTS.CONNECTION_STATUS, { status: "reconnecting", attempt: reconnectAttempts });
  reconnectTimeout = setTimeout(() => connect(), delay);
}

function isAuthFailureCloseCode(code) {
  if (code === 1008 || code === 1002) return true;
  if (code >= 4001 && code <= 4003) return true;
  return false;
}

async function handleAuthFailure() {
  setAuthState({ authFailureFlag: true, user: null, isAuthenticated: false });
  if (import.meta.env.DEV) console.log("[WS] Auth failure detected");
  try {
    const { logoutUser } = await import("@/http/auth.api");
    await logoutUser();
  } catch {
    // ignore
  }
  dispatchEvent(EVENTS.AUTH_ERROR, { message: "Session expired. Please log in again.", reason: "authentication_failed" });
}

function handleOpen() {
  if (import.meta.env.DEV) console.log("[WS] Connected");
  reconnectAttempts = 0;
  isConnectingRef = false;
  setAuthState({ authFailureFlag: false });
  setConnectionState({ status: "connected" });
  dispatchEvent(EVENTS.CONNECTION_STATUS, { status: "connected" });
  startHeartbeat();
}

function handleClose(event) {
  if (import.meta.env.DEV) console.log("[WS] Disconnected", { code: event.code, reason: event.reason });
  socket = null;
  isConnectingRef = false;
  stopHeartbeat();
  setConnectionState({ status: "disconnected" });
  if (!isManualDisconnect && isAuthFailureCloseCode(event.code)) {
    handleAuthFailure();
    return;
  }
  dispatchEvent(EVENTS.CONNECTION_STATUS, { status: "disconnected", code: event.code, reason: event.reason, manual: isManualDisconnect });
  if (!isManualDisconnect && !getAuthState().authFailureFlag) {
    attemptReconnect();
  }
}

function handleError(error) {
  if (import.meta.env.DEV) console.error("[WS] Error:", error);
  dispatchEvent("ERROR", { message: "WebSocket connection error", error });
  if (socket) socket.close();
}

function handleMessage(event) {
  try {
    const data = JSON.parse(event.data);
    const { type, payload } = data;
    if (type === "PONG") return;
    if (type === EVENTS.AUTH_ERROR || type === "AUTH_ERROR" || type === "auth_error") {
      handleAuthFailure();
      return;
    }
    dispatchEvent(type, payload);
  } catch (e) {
    if (import.meta.env.DEV) console.error("[WS] Failed to parse message:", e);
    dispatchEvent("ERROR", { message: "Failed to parse WebSocket message", error: e });
  }
}

export function connect() {
  if (getAuthState().authFailureFlag) {
    if (import.meta.env.DEV) console.log("[WS] Connection blocked due to auth failure");
    return Promise.resolve();
  }
  if (isConnectingRef) {
    if (import.meta.env.DEV) console.log("[WS] Connection already in progress");
    return Promise.resolve();
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    if (import.meta.env.DEV) console.log("[WS] Already connected");
    return Promise.resolve();
  }
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    if (import.meta.env.DEV) console.log("[WS] Connection in progress");
    return Promise.resolve();
  }
  if (isTestMode()) {
    if (import.meta.env.DEV) console.log("[WS] WebSocket disabled in TEST MODE");
    return Promise.resolve();
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  isConnectingRef = true;
  isManualDisconnect = false;
  setConnectionState({ status: "connecting" });
  dispatchEvent(EVENTS.CONNECTION_STATUS, { status: "connecting" });

  try {
    const wsUrl = getWsUrl();
    if (import.meta.env.DEV) console.log("[WS] Connecting to:", wsUrl);
    socket = new WebSocket(wsUrl);
    socket.onopen = handleOpen;
    socket.onclose = handleClose;
    socket.onerror = handleError;
    socket.onmessage = handleMessage;
    return Promise.resolve();
  } catch (error) {
    if (import.meta.env.DEV) console.error("[WS] Failed to create WebSocket:", error);
    isConnectingRef = false;
    setConnectionState({ status: "disconnected" });
    dispatchEvent(EVENTS.CONNECTION_STATUS, { status: "disconnected", error: error.message });
    dispatchEvent("ERROR", { message: "Failed to create WebSocket connection", error });
    if (!isManualDisconnect) attemptReconnect();
    return Promise.reject(error);
  }
}

export function disconnect() {
  isManualDisconnect = true;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  stopHeartbeat();
  if (socket) {
    socket.close();
    socket = null;
  }
  setAuthState({ authFailureFlag: false });
  setConnectionState({ status: "disconnected" });
  dispatchEvent(EVENTS.CONNECTION_STATUS, { status: "disconnected", manual: true });
  if (import.meta.env.DEV) console.log("[WS] Disconnected manually");
  return Promise.resolve();
}

export function send(eventOrType, payload) {
  const event = typeof eventOrType === "string" ? { type: eventOrType, payload: payload || {} } : eventOrType;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    const err = new Error("WebSocket is not connected");
    if (import.meta.env.DEV) console.warn("[WS] Cannot send, socket not open:", event.type);
    dispatchEvent("ERROR", { message: "Cannot send event, socket not connected", event });
    return Promise.reject(err);
  }
  try {
    socket.send(JSON.stringify(event));
    if (import.meta.env.DEV) console.log("[WS] Sent:", event.type);
    return Promise.resolve();
  } catch (e) {
    if (import.meta.env.DEV) console.error("[WS] Send failed:", e);
    dispatchEvent("ERROR", { message: "Failed to send WebSocket event", error: e, event });
    return Promise.reject(e);
  }
}
