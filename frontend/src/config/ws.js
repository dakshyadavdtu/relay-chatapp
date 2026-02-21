/**
 * WebSocket URL. Production: VITE_BACKEND_WS_URL required (e.g. wss://relay-chatapp.onrender.com/ws).
 * Dev: VITE_BACKEND_WS_URL, else VITE_WS_URL, else getApiBase(), else same-origin (Vite proxy). Path from VITE_WS_PATH or /ws.
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
  if (import.meta.env.PROD) {
    const backendWs = import.meta.env.VITE_BACKEND_WS_URL;
    const trimmed = typeof backendWs === "string" ? backendWs.trim().replace(/\/+$/, "") : "";
    if (!trimmed) {
      throw new Error(
        "VITE_BACKEND_WS_URL is required in production. Set it to your backend WebSocket URL (e.g. wss://relay-chatapp.onrender.com/ws)."
      );
    }
    if (/localhost|127\.0\.0\.1/i.test(trimmed)) {
      throw new Error("VITE_BACKEND_WS_URL must not point to localhost in production.");
    }
    url = ensurePath(trimmed, pathPart);
  } else {
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
