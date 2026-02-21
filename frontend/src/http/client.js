/**
 * LEGACY HTTP client — HARD-DISABLED (all modes). Do not use.
 * Use src/lib/http.js (apiFetch) and /api/* only.
 */
throw new Error("LEGACY_HTTP_CLIENT_DISABLED: use src/lib/http.js apiFetch");

import { getApiBase } from "@/utils/api";
import { setAuthState } from "@/state/auth.state";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;

function buildUrl(path) {
  const base = getApiBase() || "";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(res, attempt, error) {
  if (res && res.status === 401) return false;
  if (res && res.status >= 400 && res.status < 500) return false;
  if (attempt >= MAX_RETRIES) return false;
  if (error && error.name === "AbortError") return false;
  return true;
}

function handle401(res) {
  if (res && res.status === 401) {
    setAuthState({ user: null, isAuthenticated: false, authFailureFlag: true });
  }
}

export const client = {
  baseUrl: getApiBase(),

  async request(path, options = {}, attempt = 0) {
    const url = path.startsWith("http") ? path : buildUrl(path);
    const { method = "GET", body, ...rest } = options;

    let res;
    let error;

    try {
      res = await fetch(url, {
        ...rest,
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...rest.headers,
        },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch (e) {
      error = e;
    }

    if (res) {
      handle401(res);
    }

    if (shouldRetry(res, attempt, error)) {
      const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt);
      await delay(delayMs);
      return this.request(path, options, attempt + 1);
    }

    if (error) {
      throw error;
    }

    return res;
  },

  get(path, options = {}) {
    return this.request(path, { ...options, method: "GET" });
  },

  post(path, data, options = {}) {
    return this.request(path, { ...options, method: "POST", body: data });
  },
};
