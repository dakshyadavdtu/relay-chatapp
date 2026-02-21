/**
 * Phase 7B: Hydrate UI preferences from localStorage with contract validation.
 * Single source of truth: uiPreferences.contract.json
 */

import contract from "@/contracts/uiPreferences.contract.json";

const STORAGE_KEY = contract.persistence?.client?.key ?? "chat-settings";

function isValid(key, value) {
  const pref = contract.preferences[key];
  if (!pref) return false;
  if (pref.type === "boolean") return typeof value === "boolean";
  if (pref.type === "enum") return Array.isArray(pref.values) && pref.values.includes(value);
  return false;
}

/**
 * Load and validate preferences from localStorage.
 * @returns {Record<string, any>} Validated prefs merged with contract defaults
 */
export function hydrate() {
  const defaults = { ...contract.defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults;
    const result = { ...defaults };
    for (const key of Object.keys(contract.preferences)) {
      const value = parsed[key];
      if (value !== undefined && isValid(key, value)) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return defaults;
  }
}
