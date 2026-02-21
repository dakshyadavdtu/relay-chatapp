/**
 * Toggle sends server patch: debounce ensures only last value is sent when toggling quickly.
 * Mock API; toggle sound twice quickly; assert only one call with last value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/features/ui_prefs/uiPrefs.server", () => ({
  updateServerUiPrefs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/state/auth.state", () => ({
  getAuthState: () => ({ isAuthenticated: true }),
}));

import { setUiPref, getUiPrefs, resetUiPrefs } from "@/features/ui_prefs";
import { updateServerUiPrefs } from "@/features/ui_prefs/uiPrefs.server";

describe("sound sync (server patch debounce)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateServerUiPrefs.mockClear();
    resetUiPrefs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toggle twice quickly sends only last value", async () => {
    setUiPref("soundNotifications", true);
    setUiPref("soundNotifications", false);

    expect(updateServerUiPrefs).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);

    expect(updateServerUiPrefs).toHaveBeenCalledTimes(1);
    expect(updateServerUiPrefs).toHaveBeenCalledWith(
      expect.objectContaining({
        soundNotifications: false,
      })
    );
    expect(getUiPrefs().soundNotifications).toBe(false);
  });
});
