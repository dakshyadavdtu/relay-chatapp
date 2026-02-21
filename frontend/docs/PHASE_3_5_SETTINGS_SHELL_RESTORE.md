# Phase 3.5 — Settings Shell Restore

**Date:** 2026-02-11  
**Scope:** Replace placeholder settings routing with real Settings module shell (layout + nested routes). UI-only.

---

## Objective

Replace the current placeholder settings routing (all routes exporting SettingsPage with SettingsModal) with a real Settings module shell: a SettingsLayout with sidebar + main content area, nested settings routes rendering inside the layout. Chat settings popup (SettingsModal) remains intact as dummy parity entry, not the canonical settings owner.

---

## What Changed

- **SettingsLayout:** New two-column layout: left sidebar with nav links, right content area. Sidebar links to all settings sub-routes. Header with "Back to Chat" to `/chat`.
- **SettingsPage:** No longer renders SettingsModal. Now renders SettingsLayout with Redirect to `/settings/profile`.
- **Settings sub-pages:** Converted from re-export wrappers to actual shell pages with minimal placeholder content ("… migrated in 3.6").
- **Route nesting:** `/settings` sub-routes wrap their page components in SettingsLayout via `withSettingsLayout()`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/settings/SettingsLayout.jsx` | **Created** — Two-column layout with sidebar nav |
| `src/pages/settings/SettingsPage.jsx` | Replaced modal-based UI with SettingsLayout + Redirect |
| `src/pages/settings/ProfilePage.jsx` | Real placeholder page |
| `src/pages/settings/SecurityPage.jsx` | Real placeholder page |
| `src/pages/settings/DevicesPage.jsx` | Real placeholder page |
| `src/pages/settings/PreferencesPage.jsx` | Real placeholder page |
| `src/pages/settings/ConnectionPage.jsx` | Real placeholder page |
| `src/pages/settings/UsersPage.jsx` | Real placeholder page |
| `src/pages/settings/ReportsPage.jsx` | Real placeholder page |
| `src/pages/settings/DangerPage.jsx` | Real placeholder page |
| `src/routes.jsx` | Added `withSettingsLayout`, wrapped sub-routes |
| `docs/PHASE_3_5_SETTINGS_SHELL_RESTORE.md` | **Created** — This phase doc |

**Unchanged:** `SettingsModal.jsx` kept as-is (Chat popup dummy parity entry).

---

## Validation Commands + Results

1. **npm run build** — PASS  
2. **rg routes** — All required paths present  
3. **rg API/socket** — No fetch/axios/socket in settings pages or components  
4. **rg Sidebar** — href="/settings", href="/admin" present  
5. **git status** — Phase files modified/created  

---

## Deferred to 3.6

- Real UI migration for Profile, Security, Devices, Users, Reports, Preferences, Connection, Danger Zone
- Full myset copy page logic and content
- Any settings-specific API integration

---

**Phase:** 3.5 (Settings Shell Restore)
