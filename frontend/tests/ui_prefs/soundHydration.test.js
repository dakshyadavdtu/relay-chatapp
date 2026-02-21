/**
 * Server hydration must not override a recent local toggle.
 * Arrange: uiPrefs.soundNotifications = false via setUiPref
 * Act: applyServerPrefIfNotOverridden("soundNotifications", true) (simulating AuthLoadingGate)
 * Assert: getUiPrefs().soundNotifications remains false, result.applied === false
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setUiPref,
  getUiPrefs,
  applyServerPrefIfNotOverridden,
  resetUiPrefs,
} from "@/features/ui_prefs";

describe("sound hydration (local wins over server)", () => {
  beforeEach(() => {
    resetUiPrefs();
  });

  it("server hydration does not override recent local toggle", () => {
    setUiPref("soundNotifications", false);
    expect(getUiPrefs().soundNotifications).toBe(false);

    const result = applyServerPrefIfNotOverridden("soundNotifications", true);

    expect(result.applied).toBe(false);
    expect(getUiPrefs().soundNotifications).toBe(false);
  });
});
