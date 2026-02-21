# Notification sound root cause (investigation)

## Summary

Sound notifications can appear unpredictable because **ChatAdapter** and **both settings UIs** use the **same store** (uiPrefs), but **server hydration** can overwrite a user’s local toggle after they change it.

**Fix (safe-apply):** Local user toggles win over server hydration when the user changed the pref recently (within `RECENT_LOCAL_WINDOW_MS`, default 60s). AuthLoadingGate uses `applyServerPrefIfNotOverridden("soundNotifications", serverValue)` so a recent local toggle is not overwritten.

## Which store the toggle modifies

- **SettingsModal** (`src/components/settings/SettingsModal.jsx`): uses `useSettings()` → `useUiPrefs()` → `setUiPref("soundNotifications", value)`.
- **PreferencesPage** (`src/features/settings_ui/PreferencesPage.jsx`): uses `useUiPrefs()` → `prefs.setSoundNotifications(value)` → `setUiPref("soundNotifications", value)`.

So both UIs write to the **ui_prefs store** (`src/features/ui_prefs/store/uiPrefs.store.js`). That store persists to **localStorage** under the key **`chat-settings`** via `uiPrefs.persist`.

## Which store ChatAdapter reads

- **ChatAdapterContext** (`src/features/chat/adapters/ChatAdapterContext.jsx`): on DM and ROOM message receive it calls `getUiPrefs()` from `@/features/ui_prefs/store/uiPrefs.store`, then `if (prefs.soundNotifications) playMessageSound()`.

So ChatAdapter reads the **same** ui_prefs in-memory state. There is **no** second store in the active path: `useSettings` is implemented as `useUiPrefs()` (see `src/hooks/useSettings.js`). Legacy `settings.slice.js` and `settings.state.js` exist and both use the same localStorage key `chat-settings`, but they are **not** in the Redux reducer and `getSettingsState`/`setSettingsState` are not used by the current settings UI or ChatAdapter.

## Likely mismatch: server overwrite

The only active source of overwrite found in code is **AuthLoadingGate** (`src/components/system/AuthLoadingGate.jsx`):

- After auth, it calls `fetchServerUiPrefs()` and, if the server returns `soundNotifications !== null`, it calls `setUiPref("soundNotifications", serverPrefs.soundNotifications)`.
- If the user has just turned sound **off** in the modal, and the server still has sound **on** (e.g. not yet patched or cached), the server response can overwrite the local preference and sound will appear to “turn back on” on the next message.

So the mismatch is **time-based**: local toggle writes to uiPrefs (and localStorage), but a later server hydration can overwrite that value.

## Debug logging (repro steps)

Temporary debug logs (if re-added) can be gated by **`VITE_NOTIFICATION_SOUND_DEBUG=true`**. (Other debug instrumentation such as VITE_WS_DEBUG_MODE was removed.)

1. **Enable:** e.g. in `.env`: `VITE_NOTIFICATION_SOUND_DEBUG=true`
2. **Reproduce:**
   - Start app, open **SettingsModal** and toggle sound off (or on).
   - Without refresh, receive a message (e.g. from another user or test tool).
3. **Observe in console:**
   - **`[notify:sound-debug] SettingsModal: user toggled sound`** — confirms which UI and setter ran and the value written.
   - **`[notify:sound-debug] setUiPref(soundNotifications, …) called`** — confirms what was written into the uiPrefs store.
   - **`[notify:sound-debug] DM message receive`** / **`[notify:sound-debug] ROOM message receive`** — shows `getUiPrefs().soundNotifications`, legacy `getSettingsState().soundNotifications` (if present), and raw `localStorage` `chat-settings` at the moment of the message.
   - **`[notify:sound-debug] AuthLoadingGate: applying server prefs (sound)`** — if this appears **after** the user’s toggle, it shows the overwrite (before vs serverValue).

**Mismatch evidence from logs:**

- If after toggling sound off you see `getUiPrefs().soundNotifications === true` when a message arrives, and you see **AuthLoadingGate: applying server prefs (sound)** with `serverValue: true` after the toggle, that indicates server hydration overwrote the local preference.
- If `localStorage` `chat-settings` shows `soundNotifications: false` but `getUiPrefs().soundNotifications` is `true`, something (e.g. server hydration) has updated in-memory state without the user’s latest localStorage being the source of truth at that moment.

## Which settings UI is used

- **SettingsModal**: typically opened from a header/settings button (e.g. gear icon).
- **PreferencesPage**: typically the `/settings` (or similar) route.

The debug logs tag which one fired the toggle: **SettingsModal** vs **PreferencesPage**. Both use the same store; the only difference is which component called the setter.

## Safe-merge rules (fix)

- **Store tracking** (`src/features/ui_prefs/store/uiPrefs.store.js`): `lastLocalChangeAt[key]` set to `Date.now()` when user sets pref via `setUiPref` (for `soundNotifications` on every toggle); `lastServerApplyAt[key]` set when server value is applied via `applyServerPrefIfNotOverridden`.
- **Safe-apply:** `applyServerPrefIfNotOverridden(key, value, { recentLocalWindowMs })`: if user changed key locally within window (default 60s), server value is not applied. Otherwise applied. Returns `{ applied: true }` or `{ applied: false }`.
- **AuthLoadingGate:** Uses `applyServerPrefIfNotOverridden("soundNotifications", serverValue)` so after toggling sound off it stays off if server returns true later (within 60s). After 60s without local change, server can still hydrate.
- **Dev assertion:** `runSoundLocalWinsAssertion()` (from `@/features/ui_prefs`): simulates toggle off then server true; asserts final stays false. Use from console or "Assert sound local wins" button in UI Prefs Debug (when `VITE_UI_PREFS_DEBUG` or `VITE_NOTIFICATION_SOUND_DEBUG`).

## Client→server sync

When the user toggles **soundNotifications** or **desktopNotifications**, the client immediately updates local state and persists to localStorage, then **syncs to the server** so hydration and other devices stay consistent.

- **API:** `updateServerUiPrefs(patch)` in `src/features/ui_prefs/uiPrefs.server.js` sends `PATCH /api/me/ui-preferences` with `{ soundNotifications?: boolean, desktopNotifications?: boolean }`. Uses the same auth as the rest of the app (apiFetch: cookies or dev token).
- **Where it’s wired:** In `setUiPref` (uiPrefs.store.js), when `key` is `soundNotifications` or `desktopNotifications`, we call `scheduleSyncToServer()`.
- **Debounce:** Sync is debounced (300ms). Rapid toggles result in a single PATCH with the **latest** value (we read `getUiPrefs()` at flush time).
- **Retry:** On failure we retry up to 2 times with exponential backoff (500ms, then 1000ms). Sync is fire-and-forget; **failures do not revert local state**.
- **Auth:** If the user is not authenticated, the debounced flush no-ops (no request). After login, AuthLoadingGate’s fetch will load server state; safe-apply still prevents overwriting a recent local toggle.
- **Observability:** With `VITE_NOTIFICATION_SOUND_DEBUG=true`, console logs may include "sending server uiPref patch", "server uiPref patch success", or "server uiPref patch fail" (with retry/backoff as applicable). Other debug flags were removed.

Result: toggle sound on/off → refresh → server returns the same value; no surprise reverts.

- **Next steps:** Remove or reduce debug logs after verification.
