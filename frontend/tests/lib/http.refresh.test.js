/**
 * Tests for proactive refresh and 401/refresh flow in http.js.
 * - Dedupe: two concurrent requests that get 401 trigger only one refresh call.
 * - 401 -> refresh 200 -> retry 200 => no handleSessionExpired (shutdown not called).
 * - 401 -> refresh 401 => handleSessionExpired (shutdown called exactly once).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockShutdown = vi.fn();
const mockSubscribe = vi.fn();
vi.mock("@/transport/wsClient", () => ({
  wsClient: {
    shutdown: (...args) => mockShutdown(...args),
    subscribe: (handler) => mockSubscribe(handler),
  },
}));

vi.mock("@/state/auth.state", () => ({
  setAuthState: vi.fn(),
  getAuthState: vi.fn(() => ({ user: null, isAuthenticated: true })),
}));

vi.mock("@/features/auth/tokenTransport", () => ({
  isDevTokenMode: () => false,
  getAccessToken: () => null,
  clearTokens: vi.fn(),
}));

vi.mock("@/features/auth/sessionSwitch", () => ({
  isCookieMode: () => true,
  getLastSeenUserId: () => null,
}));

vi.mock("@/lib/authEvents", () => ({
  emitAuthChanged: vi.fn(),
}));

vi.mock("@/lib/errorMap", () => ({
  normalizeBackendError: (x) => ({ message: x?.message || "Error", code: x?.code }),
  toUserMessage: (code) => code || "Error",
}));

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof window !== "undefined") {
    window.location = { ...window.location, origin: "http://localhost:5173", pathname: "/chat", host: "localhost:5173", assign: vi.fn() };
  }
});

afterEach(() => {
  vi.restoreAllMocks?.();
});

describe("http refresh dedupe and session expiry", () => {
  it("two concurrent requests that get 401 trigger only one refresh call", async () => {
    let refreshCallCount = 0;
    let statsCallCount = 0;
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";

    globalThis.fetch = vi.fn((url) => {
      const u = typeof url === "string" ? url : url?.url ?? "";
      if (u.includes("/api/auth/refresh")) {
        refreshCallCount += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { ok: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (u.includes("/api/admin/")) {
        statsCallCount += 1;
        const is401 = statsCallCount <= 2;
        return Promise.resolve(
          new Response(JSON.stringify(is401 ? { error: "Unauthorized" } : { success: true }), {
            status: is401 ? 401 : 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const { apiFetch } = await import("@/lib/http");

    const [r1, r2] = await Promise.all([
      apiFetch("/api/admin/stats").catch((e) => e),
      apiFetch("/api/admin/stats").catch((e) => e),
    ]);

    const results = [r1, r2].filter((r) => r && typeof r === "object" && "success" in r);
    expect(results.length).toBe(2);
    expect(refreshCallCount).toBe(1);
    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it("401 -> refresh 200 -> retry 200 => shutdown not called", async () => {
    let step = 0;
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";

    globalThis.fetch = vi.fn((url) => {
      const u = typeof url === "string" ? url : url?.url ?? "";
      if (u.includes("/api/auth/refresh")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { ok: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (u.includes("/api/admin/")) {
        step += 1;
        const is401 = step === 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(is401 ? { error: "Unauthorized" } : { success: true, data: {} }),
            {
              status: is401 ? 401 : 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const { apiFetch } = await import("@/lib/http");

    const result = await apiFetch("/api/admin/stats");

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it("401 -> refresh 401 => shutdown called exactly once", async () => {
    globalThis.fetch = vi.fn((url) => {
      const u = typeof url === "string" ? url : url?.url ?? "";
      if (u.includes("/api/auth/refresh")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: false, error: "Refresh token required or invalid" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (u.includes("/api/admin/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const { apiFetch, UnauthorizedError } = await import("@/lib/http");

    await expect(apiFetch("/api/admin/stats")).rejects.toThrow(UnauthorizedError);

    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledWith("session_expired");
  });
});
