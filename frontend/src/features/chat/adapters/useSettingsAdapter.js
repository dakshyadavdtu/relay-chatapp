/**
 * Phase 7B: Chat settings adapter delegates to ui_prefs boundary.
 */
import { useUiPrefs } from "@/features/ui_prefs";

export function useSettingsStore() {
  return useUiPrefs();
}
