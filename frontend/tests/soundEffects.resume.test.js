/**
 * playMessageSound awaits resume before scheduling the beep.
 * Mock AudioContext state "suspended"; resume() resolves; assert oscillator created and start() called after resume.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let mockCtxInstance;
const osc = {
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  frequency: { setValueAtTime: vi.fn() },
};
const gain = {
  connect: vi.fn(),
  gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
};

function MockAudioContext() {
  mockCtxInstance = this;
  this.state = "suspended";
  this.currentTime = 0;
  this.destination = {};
  this.resume = vi.fn().mockImplementation(function () {
    this.state = "running";
    return Promise.resolve();
  });
  this.createOscillator = vi.fn(() => osc);
  this.createGain = vi.fn(() => gain);
}

describe("playMessageSound awaits resume", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCtxInstance = null;
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("webkitAudioContext", undefined);
  });

  it("schedules oscillator after resume", async () => {
    const { playMessageSound } = await import("@/utils/soundEffects");
    playMessageSound();

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCtxInstance).toBeTruthy();
    expect(mockCtxInstance.resume).toHaveBeenCalled();
    expect(mockCtxInstance.createOscillator).toHaveBeenCalled();
    expect(osc.start).toHaveBeenCalled();
  });
});
