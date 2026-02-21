# Phase 3.4 — Settings Route Surface Lock

**Date:** 2026-02-11  
**Scope:** Expand settings routing surface to match real Settings module shape. No UI break.

---

## Routes Added

| Route | Page Component |
|-------|----------------|
| `/settings` | SettingsPage (unchanged) |
| `/settings/profile` | ProfilePage (scaffold) |
| `/settings/security` | SecurityPage (scaffold) |
| `/settings/devices` | DevicesPage (scaffold) |
| `/settings/preferences` | PreferencesPage (scaffold) |
| `/settings/connection` | ConnectionPage (scaffold) |
| `/settings/danger` | DangerPage (scaffold) |
| `/settings/users` | UsersPage (scaffold) |
| `/settings/reports` | ReportsPage (scaffold) |

---

## Why Wrappers Were Used

Each sub-route page (`ProfilePage`, `SecurityPage`, etc.) is a thin wrapper that re-exports `SettingsPage`. This provides:

- **Non-breaking scaffold:** All sub-routes render the same UX as `/settings` for now.
- **No UI regression:** No new screens or layout changes.
- **Future-ready:** Phase 3.5+ can replace wrappers with real implementations migrated from `myset copy` without changing route paths.

---

## Ownership Confirmation

- **Settings module** remains the canonical owner. Canonical files (`SettingsModal.jsx`, `SettingsPage.jsx`) and route constants (`config/settings.routes.js`) live under the settings module surface.
- **Chat popup** remains a dummy parity entry point. It continues to open `SettingsModal` from the settings module; no logic ownership change.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/config/settings.routes.js` | Exported constants for all settings paths |
| `src/pages/settings/ProfilePage.jsx` | Scaffold wrapper |
| `src/pages/settings/SecurityPage.jsx` | Scaffold wrapper |
| `src/pages/settings/DevicesPage.jsx` | Scaffold wrapper |
| `src/pages/settings/PreferencesPage.jsx` | Scaffold wrapper |
| `src/pages/settings/ConnectionPage.jsx` | Scaffold wrapper |
| `src/pages/settings/DangerPage.jsx` | Scaffold wrapper |
| `src/pages/settings/UsersPage.jsx` | Scaffold wrapper |
| `src/pages/settings/ReportsPage.jsx` | Scaffold wrapper |

## Files Edited

| File | Change |
|------|--------|
| `src/routes.jsx` | Added 8 settings sub-routes; imports for scaffold pages |

---

## Deferred to Phase 3.5

- **Page-by-page UI migration** from `myset copy`: Replace each scaffold wrapper with real Profile, Security, Devices, Preferences, Connection, Danger, Users, Reports implementations.
- **SettingsLayout with sidebar nav:** Migrate myset-style layout and navigation between sub-pages.
- **Wire `settings.routes.js`** into navigation links when building real settings layout.

---

**Phase:** 3.4 (Settings Route Surface Lock)
