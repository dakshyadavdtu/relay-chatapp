/**
 * Phase 7B: React hook for UI preferences.
 */

import { useState, useEffect, useCallback } from "react";
import { getUiPrefs, setUiPref, subscribe } from "./store/uiPrefs.store";

export function useUiPrefs() {
  const [prefs, setPrefs] = useState(getUiPrefs);

  useEffect(() => {
    return subscribe(setPrefs);
  }, []);

  const setTheme = useCallback((v) => setUiPref("theme", v), []);
  const setTextSize = useCallback((v) => setUiPref("textSize", v), []);
  const setDensity = useCallback((v) => setUiPref("density", v), []);
  const setReducedMotion = useCallback((v) => setUiPref("reducedMotion", v), []);
  const setEnterToSend = useCallback((v) => setUiPref("enterToSend", v), []);
  const setMessageGrouping = useCallback((v) => setUiPref("messageGrouping", v), []);
  const setSoundNotifications = useCallback((v) => setUiPref("soundNotifications", v), []);
  const setDesktopNotifications = useCallback((v) => setUiPref("desktopNotifications", v), []);
  const setDesktopNotificationMode = useCallback((v) => setUiPref("desktopNotificationMode", v), []);

  return {
    ...prefs,
    setTheme,
    setTextSize,
    setDensity,
    setReducedMotion,
    setEnterToSend,
    setMessageGrouping,
    setSoundNotifications,
    setDesktopNotifications,
    setDesktopNotificationMode,
  };
}
