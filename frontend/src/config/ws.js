/**
 * WebSocket URL. Same-origin when VITE_WS_URL / VITE_API_BASE_URL unset (cookie auth).
 * For split deploy (e.g. Render Static + Web Service): set VITE_WS_URL to e.g. wss://api.example.com/ws
 * or set VITE_API_BASE_URL and we derive wss(s)://backendHost/ws. Path from VITE_WS_PATH or /ws.
 */
import { isDevTokenMode, getAccessToken } from "@/features/auth/tokenTransport";
import { getApiBase } from "@/utils/api";

const DEFAULT_WS_PATH = "/ws";

function getWsPath() {
  const p = import.meta.env.VITE_WS_PATH;
  return typeof p === "string" && p.trim() ? p.replace(/^\//, "/") : DEFAULT_WS_PATH;
}

export function getWsUrl(path = getWsPath()) {
  if (typeof window === "undefined") return null;
  let url;
  const wsEnv = import.meta.env.VITE_WS_URL;
  if (typeof wsEnv === "string" && wsEnv.trim()) {
    url = wsEnv.trim().replace(/\/$/, "");
  } else {
    const apiBase = getApiBase();
    if (apiBase) {
      const u = new URL(apiBase);
      const protocol = u.protocol === "https:" ? "wss:" : "ws:";
      const pathPart = path.startsWith("/") ? path : `/${path}`;
      url = `${protocol}//${u.host}${pathPart}`;
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const pathPart = path.startsWith("/") ? path : `/${path}`;
      url = `${protocol}//${window.location.host}${pathPart}`;
    }
  }
  if (isDevTokenMode()) {
    const accessToken = getAccessToken();
    if (accessToken) {
      url = `${url}?accessToken=${encodeURIComponent(accessToken)}`;
    }
  }
  return url;
}
export const WS_URL = typeof window !== "undefined" ? getWsUrl() : null;
