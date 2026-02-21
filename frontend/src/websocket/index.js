/**
 * LEGACY WebSocket module — HARD-DISABLED (all modes). Do not import.
 * Chat route uses src/transport/wsClient.js only.
 */
throw new Error("Legacy websocket stack disabled. Use src/transport/wsClient.js.");

export { connect, disconnect, send, subscribe, getStatus, resetAuthFailure } from "@/websocket/connection/core";
export { EVENTS, WS_EVENTS } from "@/config/constants";
export { subscribe as subscribeWithTracking, unsubscribeAllForComponent } from "@/websocket/subscription";
