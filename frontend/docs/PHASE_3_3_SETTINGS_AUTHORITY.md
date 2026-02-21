# Phase 3.3 — Settings Authority Lock

**Date:** 2026-02-11  
**Scope:** Module ownership lock for settings. No UI/interactivity change.

---

## Canonical Rule

**Settings module owns settings logic.** All real settings implementation (modal UI, state consumption, export handlers, etc.) lives under:
- `src/components/settings/SettingsModal.jsx`
- `src/pages/settings/SettingsPage.jsx`

**Chat settings popup is a UI parity shell.** The Chat module renders `SettingsModal` from `@/components/settings/SettingsModal` but does not implement settings logic. It must not become the canonical logic owner.

---

## Files Made Canonical in This Phase

| File | Role |
|------|------|
| `src/components/settings/SettingsModal.jsx` | Canonical SettingsModal implementation (theme, density, notifications, export, etc.) |
| `src/pages/settings/SettingsPage.jsx` | Canonical settings page implementation |

## Compatibility Re-exports (Thin Wrappers)

| File | Role |
|------|------|
| `src/components/layout/SettingsModal.jsx` | Re-exports `SettingsModal` from `../settings/SettingsModal` |
| `src/pages/Settings.jsx` | Re-exports default from `./settings/SettingsPage` |

---

## Consumer Updates

- `src/components/chat/ChatWindow.jsx` imports from `@/components/settings/SettingsModal`
- `src/pages/settings/SettingsPage.jsx` imports from `@/components/settings/SettingsModal`

---

## Deferred to Later Phases

- **Full myset page migration:** Multi-page settings layout (Profile, Security, Devices, Users, Reports, Preferences, Connection, Danger Zone) not migrated.
- **Settings sub-routes:** `/settings/profile`, `/settings/security`, etc. not implemented.
- **SettingsLayout with sidebar nav:** myset-style layout not migrated.

---

## Validation Summary

- Build: **PASS**
- Canonical settings files: `components/settings/SettingsModal.jsx`, `pages/settings/SettingsPage.jsx`
- Compatibility re-exports: layout/SettingsModal.jsx, pages/Settings.jsx
- Chat and Settings UI/behavior: **unchanged**
- Phase 3.2 navigation contract: **intact**

---

**Phase:** 3.3 (Settings Authority Lock)
