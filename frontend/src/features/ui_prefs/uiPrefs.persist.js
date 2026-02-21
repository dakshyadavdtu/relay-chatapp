/**
 * Phase 7B: Persist UI preferences to localStorage.
 */

import contract from "@/contracts/uiPreferences.contract.json";

const STORAGE_KEY = contract.persistence?.client?.key ?? "chat-settings";

/**
 * Save preferences to localStorage.
 * @param {Record<string, any>} prefs - Preference object to persist
 */
export function persist(prefs) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
