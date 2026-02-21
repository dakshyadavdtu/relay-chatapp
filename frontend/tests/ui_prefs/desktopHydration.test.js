/**
 * Server hydration must not override a recent local toggle for desktopNotifications.
 * Arrange: uiPrefs.desktopNotifications = true via setUiPref
 * Act: applyServerPrefIfNotOverridden("desktopNotifications", false) (simulating AuthLoadingGate)
 * Assert: getUiPrefs().desktopNotifications remains true, result.applied === false
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setUiPref,
  getUiPrefs,
  applyServerPrefIfNotOverridden,
  resetUiPrefs,
} from "@/features/ui_prefs";

describe("desktop notifications hydration (local wins over server)", () => {
  beforeEach(() => {
    resetUiPrefs();
  });

  it("server hydration does not override recent local toggle", () => {
    setUiPref("desktopNotifications", true);
    expect(getUiPrefs().desktopNotifications).toBe(true);

    const result = applyServerPrefIfNotOverridden("desktopNotifications", false);

    expect(result.applied).toBe(false);
    expect(getUiPrefs().desktopNotifications).toBe(true);
  });
});
