# Phase 7B — Global UI Preferences Verification

## Summary

UI preferences (theme, compact mode, text size, etc.) are applied globally via the `ui_prefs` boundary layer. Source of truth: `src/contracts/uiPreferences.contract.json`.

---

## Exact Verification Checks

### 1. Toggle theme → chat + settings + whole app changes

- [ ] Open the app and go to Chat.
- [ ] Open Settings modal (gear icon in chat header) or Preferences page (`/settings/preferences`).
- [ ] Toggle theme: **Light** → **Dark** → **Light** (or **System** if available).
- [ ] **Expected:** Chat background, sidebar, message bubbles, settings modal, and entire app update to match the selected theme.

### 2. Toggle compact → chat list spacing changes

- [ ] Go to Settings modal or Preferences page.
- [ ] Toggle density: **Comfortable** → **Compact**.
- [ ] **Expected:**
  - Chat message list: gap between messages reduces.
  - Message bubbles: padding reduces.
  - Sidebar items (rooms, chats): padding reduces.
  - Chat header: padding reduces.
  - Settings widgets (Preferences page): padding reduces when compact.

### 3. Change text size → message text changes

- [ ] In Settings modal or Preferences, change text size: **Medium** → **Small** → **Large**.
- [ ] **Expected:** Message text, labels, and app typography scale accordingly. Small = smaller text, Large = larger text.

### 4. Refresh → persists

- [ ] Set theme to Dark, density to Compact, text size to Large.
- [ ] Refresh the page (F5 or Cmd+R).
- [ ] **Expected:** Preferences remain (Dark, Compact, Large) after refresh.

---

## Implementation Notes

- **Hydration:** On app bootstrap (`App.jsx`), `bootstrap()` loads from `localStorage` (key: `chat-settings`), validates against the contract, fills missing values with defaults, applies to DOM.
- **Apply:** Only `uiPrefs.apply.js` may touch `document.documentElement` for pref-driven classes (theme, text-size, density, reduced-motion).
- **API:** `getUiPrefs()`, `setUiPref(key, value)`, `resetUiPrefs()`, `bootstrap()`, `subscribe()`, `useUiPrefs()`.
- **Chat:** Reads prefs via `useSettingsStore()` (adapter → `useUiPrefs`). No direct DOM manipulation from Chat or Settings.

---

## Optional: Dev Debug Panel

If `VITE_UI_PREFS_DEBUG=true` is set, a small "UI Prefs Debug" toggle can be rendered to verify changes apply instantly. (Minimal implementation.)
