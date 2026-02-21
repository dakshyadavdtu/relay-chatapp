# Phase 3.6 — Settings Real UI Migration

**Date:** 2026-02-11  
**Scope:** Migrate real Settings module UI from myset copy to target. UI-only, no API/socket.

---

## 1. Objective

Migrate the real Settings module UI from source (`myset copy/src`) into the target app, replacing placeholder pages from Phase 3.5. Preserve routing, SettingsLayout, and chat SettingsModal as dummy parity entry. No API or WebSocket integration.

---

## 2. Source → Target Migration Map

| Source | Target |
|--------|--------|
| `components/SettingsLayout.jsx` | Merged into existing `components/settings/SettingsLayout.jsx` (kept 3.5 shell) |
| `components/Widget.jsx` | `components/settings/Widget.jsx` |
| `components/ErrorBanner.jsx` | `components/settings/ErrorBanner.jsx` |
| `components/EmptyState.jsx` | `components/settings/EmptyState.jsx` |
| `pages/ProfilePage.jsx` | `pages/settings/ProfilePage.jsx` |
| `pages/SecurityPage.jsx` | `pages/settings/SecurityPage.jsx` |
| `pages/DevicesPage.jsx` | `pages/settings/DevicesPage.jsx` |
| `pages/PreferencesPage.jsx` | `pages/settings/PreferencesPage.jsx` |
| `pages/ConnectionPage.jsx` | `pages/settings/ConnectionPage.jsx` |
| `pages/DangerPage.jsx` | `pages/settings/DangerPage.jsx` |
| `pages/UsersPage.jsx` | `pages/settings/UsersPage.jsx` |
| `pages/ReportsPage.jsx` | `pages/settings/ReportsPage.jsx` |

---

## 3. Data Adaptation Decisions

- **Profile:** Replaced `useProfile`/`useUpdateProfile` with `useMockProfile`/`useMockUpdateProfile` from `useSettingsUIMocks.js`. Mock user data; save/update are local no-ops.
- **Security:** Replaced `useChangePassword` with `useMockChangePassword`. Form UI preserved; submit shows success toast.
- **Devices:** Replaced `useDevices`/`useRevokeDevice` with mock hooks. Mock device list; revoke is local no-op.
- **Preferences:** Uses target `useSettings` (Redux) directly. No `fetchSettings`/`apiUpdateSettings`; save triggers toast.
- **Connection:** Replaced `useConnectionStatus` with `useMockConnectionStatus`. Mock status/latency/uptime.
- **Danger:** No API in source; kept as-is.
- **Users:** Replaced Redux `fetchUsers`/`deleteUser` with local mock list.
- **Reports:** Replaced Redux `fetchReports` with local mock list.

---

## 4. Files Changed

| File | Change |
|------|--------|
| `src/hooks/useSettingsUIMocks.js` | **Created** — Mock data hooks |
| `src/components/settings/Widget.jsx` | **Created** |
| `src/components/settings/ErrorBanner.jsx` | **Created** |
| `src/components/settings/EmptyState.jsx` | **Created** |
| `src/components/settings/SettingsDialog.jsx` | **Created** — Minimal modal |
| `src/components/settings/SettingsProgress.jsx` | **Created** — Progress bar |
| `src/pages/settings/ProfilePage.jsx` | Real UI with mocks |
| `src/pages/settings/SecurityPage.jsx` | Real UI with mocks |
| `src/pages/settings/DevicesPage.jsx` | Real UI with mocks |
| `src/pages/settings/PreferencesPage.jsx` | Real UI, uses useSettings |
| `src/pages/settings/ConnectionPage.jsx` | Real UI with mocks |
| `src/pages/settings/DangerPage.jsx` | Real UI (no API) |
| `src/pages/settings/UsersPage.jsx` | Real UI with mocks |
| `src/pages/settings/ReportsPage.jsx` | Real UI with mocks |
| `docs/PHASE_3_6_SETTINGS_UI_MIGRATION.md` | **Created** |

---

## 5. Validation Results

- **Build:** PASS  
- **Route contract:** All `/settings/*` routes present  
- **No API/socket:** No fetch, axios, socket, api/*, realtime/* in settings pages or components  
- **SettingsModal:** Not used as main settings page; only Chat popup uses it  

---

## 6. Regression Summary (Auth/Chat/Admin)

- Auth, Chat, Admin modules unchanged.
- Navigation contract preserved: `/` → `/login`, login → `/chat`, chat → `/settings`, chat → `/admin`.
- Chat SettingsModal intact as dummy parity entry.

---

## 7. Deferred to Phase 3.7

- API/WebSocket wiring for settings (profile, devices, connection, users, reports)
- Real auth integration for change password, revoke device
- Date range filters for export
- Debounced search for users/reports

---

**Phase:** 3.6 (Settings Real UI Migration)
