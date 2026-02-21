/**
 * Phase 7B: Dev-only debug panel for UI preferences.
 * Rendered only when VITE_ENABLE_DEV_TOOLS=true (default OFF).
 */

import { useUiPrefs } from "./useUiPrefs";
import { resetUiPrefs, runSoundLocalWinsAssertion } from "./store/uiPrefs.store";

const ENABLE_DEV_TOOLS = import.meta.env.VITE_ENABLE_DEV_TOOLS === "true";

export function UiPrefsDebug() {
  if (!ENABLE_DEV_TOOLS) return null;

  const { theme, textSize, density, setTheme, setTextSize, setDensity } = useUiPrefs();

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] rounded-lg border border-border bg-card p-3 shadow-lg text-xs space-y-2"
      data-testid="ui-prefs-debug"
    >
      <div className="font-bold text-[10px] uppercase text-muted-foreground">UI Prefs Debug</div>
      <div className="flex flex-wrap gap-2">
        <select value={theme} onChange={(e) => setTheme(e.target.value)} className="rounded border px-1 py-0.5">
          {["light", "dark", "system"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={textSize} onChange={(e) => setTextSize(e.target.value)} className="rounded border px-1 py-0.5">
          {["small", "medium", "large"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={density} onChange={(e) => setDensity(e.target.value)} className="rounded border px-1 py-0.5">
          {["comfortable", "compact"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={resetUiPrefs}
          className="rounded border px-2 py-0.5 hover:bg-muted"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            const r = runSoundLocalWinsAssertion();
            if (!r.ok) console.error("[uiPrefs] assertion failed:", r.message);
          }}
          className="rounded border px-2 py-0.5 hover:bg-muted"
          title="Assert: local sound toggle wins over server"
        >
          Assert sound local wins
        </button>
      </div>
    </div>
  );
}
