/**
 * Phase 7B: useSettings delegates to ui_prefs boundary.
 * All pref reads/writes go through ui_prefs; no direct DOM manipulation.
 */
import { useUiPrefs } from "@/features/ui_prefs";

export function useSettings() {
  return useUiPrefs();
}
