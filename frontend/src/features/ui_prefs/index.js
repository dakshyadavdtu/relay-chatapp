/**
 * Phase 7B: Global UI preferences boundary.
 * Contract-driven; only uiPrefs.apply may touch DOM for pref-driven classes.
 */

export {
  getUiPrefs,
  setUiPref,
  resetUiPrefs,
  bootstrap,
  subscribe,
  getLastLocalChangeAt,
  getLastServerApplyAt,
  applyServerPrefIfNotOverridden,
  RECENT_LOCAL_WINDOW_MS,
  runSoundLocalWinsAssertion,
} from "./store/uiPrefs.store";
export { hydrate } from "./uiPrefs.hydrate";
export { apply } from "./uiPrefs.apply";
export { persist } from "./uiPrefs.persist";
export { useUiPrefs } from "./useUiPrefs";
export { UiPrefsDebug } from "./UiPrefsDebug";
