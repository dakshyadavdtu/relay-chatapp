/**
 * WebSocket URL. Production (split deploy): set VITE_BACKEND_WS_URL (e.g. wss://api.example.com/ws).
 * Else VITE_WS_URL, or getApiBase(), or same-origin (dev + Vite proxy). Path from VITE_WS_PATH or /ws.
 */
import { isDevTokenMode, getAccessToken } from "@/features/auth/tokenTransport";
import { getApiBase } from "@/utils/api";

const DEFAULT_WS_PATH = "/ws";

function getWsPath() {
  const p = import.meta.env.VITE_WS_PATH;
  return typeof p === "string" && p.trim() ? p.replace(/^\//, "/") : DEFAULT_WS_PATH;
}

function ensurePath(urlBase, pathPart) {
  if (!pathPart || pathPart === "/") return urlBase;
  const slashPath = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  return urlBase.endsWith(slashPath) ? urlBase : `${urlBase.replace(/\/+$/, "")}${slashPath}`;
}

export function getWsUrl(path = getWsPath()) {
  if (typeof window === "undefined") return null;
  const pathPart = path.startsWith("/") ? path : `/${path}`;
  let url;
  const backendWs = import.meta.env.VITE_BACKEND_WS_URL;
  if (typeof backendWs === "string" && backendWs.trim()) {
    const base = backendWs.trim().replace(/\/+$/, "");
    url = ensurePath(base, pathPart);
  } else {
    const wsEnv = import.meta.env.VITE_WS_URL;
    if (typeof wsEnv === "string" && wsEnv.trim()) {
      url = wsEnv.trim().replace(/\/$/, "");
    } else {
      const apiBase = getApiBase();
      if (apiBase) {
        const u = new URL(apiBase);
        const protocol = u.protocol === "https:" ? "wss:" : "ws:";
        url = `${protocol}//${u.host}${pathPart}`;
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        url = `${protocol}//${window.location.host}${pathPart}`;
      }
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
