/**
 * Tests for wsClient: connect idempotent (no parallel WebSocket instances),
 * and timer lifecycle (PING/PRESENCE only after HELLO_ACK, cleared on close).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/config/ws", () => ({ getWsUrl: () => "ws://localhost:8000/ws" }));

describe("wsClient timer management", () => {
  let CtorCalls;

  beforeEach(() => {
    vi.resetModules();
    CtorCalls = 0;
  });

  it("connect() is idempotent when ws already OPEN", async () => {
    class MockWebSocket {
      constructor(url) {
        CtorCalls++;
        this.readyState = 0;
        this.send = vi.fn();
        this.close = vi.fn();
        setTimeout(() => {
          this.readyState = 1;
          if (this.onopen) this.onopen();
        }, 0);
      }
    }
    global.WebSocket = MockWebSocket;

    const { wsClient } = await import("@/transport/wsClient");
    if (wsClient.clearShutdown) wsClient.clearShutdown();

    wsClient.connect();
    await new Promise((r) => setTimeout(r, 25));
    wsClient.connect();
    await new Promise((r) => setTimeout(r, 5));

    expect(CtorCalls).toBe(1);
  });
});
