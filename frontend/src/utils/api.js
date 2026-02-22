/**
 * Canonical API base (single source). Re-exported from lib/http so all callers (ws, upload, etc.) use the same value.
 * PROD: VITE_BACKEND_HTTP_URL required (validated at startup in main.jsx). DEV: VITE_BACKEND_HTTP_URL or ''.
 */
import { getApiBase as getApiBaseFromHttp } from "@/lib/http";
export const getApiBase = getApiBaseFromHttp;

/**
 * WebSocket URL. Use config/ws.js getWsUrl() in app code (handles PROD VITE_BACKEND_WS_URL, dev same-origin).
 * This legacy getter is for non-browser or tests only; do NOT use VITE_WS_URL pointing at backend in dev.
 */
export function getWsUrl() {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  const wsEnv = import.meta.env.VITE_WS_URL;
  if (typeof wsEnv === "string" && wsEnv) return wsEnv.replace(/\/$/, "");
  const apiBase = getApiBaseFromHttp();
  if (apiBase) {
    const origin = new URL(apiBase).origin;
    const protocol = origin.startsWith("https") ? "wss:" : "ws:";
    const host = new URL(apiBase).host;
    return `${protocol}//${host}/ws`;
  }
  return "";
}
