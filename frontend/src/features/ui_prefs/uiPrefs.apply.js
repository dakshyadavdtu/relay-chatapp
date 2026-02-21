/**
 * Phase 7B: Apply UI preferences to DOM.
 * ONLY this module may touch document.documentElement for pref-driven classes.
 * Contract: uiPreferences.contract.json uiBindings
 */

/**
 * Apply preference values to the DOM.
 * @param {Record<string, any>} prefs - Validated preference object
 */
export function apply(prefs) {
  if (typeof document === "undefined" || !document.documentElement) return;

  const root = document.documentElement;

  // Theme
  root.classList.remove("light", "dark");
  const theme = prefs.theme ?? "light";
  if (theme === "system") {
    const systemDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    root.classList.add(systemDark ? "dark" : "light");
  } else {
    root.classList.add(theme === "dark" ? "dark" : "light");
  }

  // Text size
  root.classList.remove("text-small", "text-medium", "text-large");
  const textSize = prefs.textSize ?? "medium";
  root.classList.add(`text-${textSize}`);

  // Density
  root.classList.remove("density-comfortable", "density-compact");
  const density = prefs.density ?? "comfortable";
  root.classList.add(`density-${density}`);

  // Reduced motion
  if (prefs.reducedMotion) {
    root.classList.add("reduced-motion");
  } else {
    root.classList.remove("reduced-motion");
  }
}
