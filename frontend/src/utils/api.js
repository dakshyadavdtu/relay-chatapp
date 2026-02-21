/**
 * Base URL for API requests. In dev with proxy: leave unset so same-origin and cookies attach.
 * In production with split deploy (e.g. Render Static Site + Web Service): set VITE_API_BASE_URL
 * to the backend origin so API requests and cookies target the backend.
 */
export function getApiBase() {
  const base = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL;
  const trimmed = typeof base === "string" ? base.replace(/\/$/, "") : "";
  if (typeof window !== "undefined") return trimmed;
  return trimmed;
}

/**
 * WebSocket URL. In browser always same-origin (window.location) so cookie auth works.
 * Do NOT use VITE_WS_URL pointing at backend (e.g. ws://localhost:8000) in dev.
 */
export function getWsUrl() {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  const wsEnv = import.meta.env.VITE_WS_URL;
  if (typeof wsEnv === "string" && wsEnv) return wsEnv.replace(/\/$/, "");
  const apiBase = getApiBase();
  if (apiBase) {
    const origin = new URL(apiBase).origin;
    const protocol = origin.startsWith("https") ? "wss:" : "ws:";
    const host = new URL(apiBase).host;
    return `${protocol}//${host}/ws`;
  }
  return "";
}
