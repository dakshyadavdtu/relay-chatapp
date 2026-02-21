# Phase 3.5 — Redux Foundation Lock for Settings Authority

**Date:** 2026-02-11  
**Scope:** Establish Redux as active state foundation for Settings. No UI change.

---

## 1. Goal

Create Redux-based settings state foundation and wire it into the existing app without any UI or behavior drift. Settings module remains the real logic owner; Chat settings popup consumes canonical settings state.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `package.json` | Added `@reduxjs/toolkit`, `react-redux` |
| `src/state/store.js` | **Created** — Redux store with settings reducer and persistence middleware |
| `src/state/slices/settings.slice.js` | **Created** — Settings slice with actions and initialState |
| `src/main.jsx` | Wrapped app with `<Provider store={store}>` |
| `src/hooks/useSettings.js` | Switched to useSelector + useDispatch; same external API |
| `src/state/settings.state.js` | Added legacy comment (kept, not deleted) |
| `docs/PHASE_3_5_REDUX_SETTINGS_FOUNDATION.md` | **Created** — This phase doc |

---

## 3. Redux Architecture Added

- **Store:** `configureStore` with `settings` reducer and `settingsPersistenceMiddleware`.
- **Slice:** `settings.slice.js` — initial state from localStorage or defaults; reducers for all setters; `hydrateFromStorage` action.
- **Persistence:** Middleware writes to `localStorage` key `chat-settings` on any `settings/*` action.
- **useSettings:** Uses `useSelector((s) => s.settings)` and `useDispatch`; returns same API shape as before.

---

## 4. Settings Key Mapping (Old → New Behavior)

| Key | Old (settings.state.js) | New (Redux slice) |
|-----|-------------------------|-------------------|
| theme | getSettingsState().theme | useSelector(s => s.settings.theme) |
| textSize | getSettingsState().textSize | useSelector(s => s.settings.textSize) |
| density | getSettingsState().density | useSelector(s => s.settings.density) |
| reducedMotion | getSettingsState().reducedMotion | useSelector(s => s.settings.reducedMotion) |
| enterToSend | getSettingsState().enterToSend | useSelector(s => s.settings.enterToSend) |
| messageGrouping | getSettingsState().messageGrouping | useSelector(s => s.settings.messageGrouping) |
| soundNotifications | getSettingsState().soundNotifications | useSelector(s => s.settings.soundNotifications) |
| desktopNotifications | getSettingsState().desktopNotifications | useSelector(s => s.settings.desktopNotifications) |
| Setters | setSettingsState({ key: val }) | dispatch(setTheme(val)), etc. |
| Persistence | save() in setSettingsState | settingsPersistenceMiddleware |
| Hydration | load() on init | loadInitialState() in slice |

---

## 5. Validation Results Summary

- **Build:** PASS
- **Redux wiring:** configureStore, Provider, useSelector, useDispatch, settings.slice present
- **useSettings usage:** SettingsModal, SettingsPage consume hook
- **Route contract:** Redirect to="/login", path="/chat", path="/settings", path="/admin" unchanged
- **Chat navigation:** href="/settings", href="/admin" in Sidebar unchanged
- **Canonical ownership:** ChatWindow and SettingsPage import @/components/settings/SettingsModal

---

## 6. Regression Check

| Check | Result |
|-------|--------|
| Route contract intact | PASS — `/` → `/login`, login → `/chat`, chat → `/settings`, chat → `/admin` |
| No UI changes | PASS — No styling or layout edits |
| No interaction changes | PASS — Same setters, same modal/page behavior |

---

## 7. Deferred to Phase 3.6

- Real myset page logic migration (Profile, Security, Devices, Preferences, Connection, Danger, Users, Reports)
- SettingsLayout sidebar migration
- Additional Redux slices (Auth, Chat, Admin) as needed
