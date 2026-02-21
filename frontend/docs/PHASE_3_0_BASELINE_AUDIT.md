# Phase 3.0 Baseline Audit

**Date:** 2026-02-11  
**Scope:** Analysis and documentation only. No migrations, refactors, or fixes.

---

## Section A: Integration Contract

### Constraints (must obey)
- **Tech baseline to preserve:** Vite + React + Redux + JavaScript only.
- **No TypeScript.**
- **Do not change target directory contract.**
- **Do not redesign UI.**
- **Do not alter user flows** unless just documenting.
- **Module parity mindset:** Auth + Chat + Settings + Admin always considered together.
- **If unclear:** Mark as `UNKNOWN` rather than assuming.

### Non-goals for this phase
- No file migrations.
- No refactoring.
- No fixes or patches.
- No UI/interactivity changes.
- No API or socket integration.
- No state architecture changes.

---

## Section B: Module Source Map

| Module | Source Root | Key Files Read |
|--------|-------------|----------------|
| **Auth** | `updated-relay-auth-main/frontend` | `src/App.js`, `src/pages/Login.js`, `src/pages/Signup.js`, `src/pages/ForgotPassword.js`, `src/pages/ResetPassword.js`, `src/pages/VerifyOTP.js`, `src/components/auth/*`, `src/contexts/AuthContext.js` |
| **Chat** | `mychat original copy 6/frontend` | `src/app/App.jsx`, `src/main.jsx`, `src/pages/Home.jsx`, `src/features/chat/*`, `src/features/settings/SettingsModal.jsx`, `src/store/*` |
| **Settings** | `myset copy` | `src/App.jsx`, `src/lib/routes.js`, `src/components/SettingsLayout.jsx`, `src/pages/*Page.jsx` |
| **Admin** | `our admin copy` | `src/App.jsx`, `src/components/layout.jsx`, `src/components/AdminRouteGuard.jsx`, `src/pages/*` |

---

## Section C: Current Target Reality

**Target root:** `myfrontend/frontend`

### Auth
- **Integrated:** Yes (partial). Pages at `src/pages/auth/` (Login, Register, Forgot, Reset). Components at `src/components/auth/` (AuthLayout, AuthCard). Routes: `/login`, `/register`, `/forgot`, `/reset`.
- **State:** Custom `auth.state.js` + `useAuth` hook. No AuthContext.
- **Placeholders:** Auth pages are UI-only; handlers use `console.log`. No OTP flow. No ProtectedRoute redirect logic wired from auth.

### Chat
- **Integrated:** Yes (partial). Chat UI lives in `src/components/chat/` (ChatWindow, Sidebar, NewGroupPopup, GroupInfoPanel, etc.). Main chat entry is `ChatPlaceholder.jsx` at `src/pages/ChatPlaceholder.jsx` (not under `pages/chat/`).
- **State:** Custom `chat.state.js` + `useChat` hook. No Redux. Uses mock groups, mock messages.
- **Placeholders:** Group creation works locally. Messages use mock data. No WebSocket integration for real-time.

### Settings
- **Integrated:** Yes (partial). `Settings.jsx` at `src/pages/Settings.jsx` (not under `pages/settings/`). `SettingsModal.jsx` at `src/components/layout/SettingsModal.jsx` (not under `components/settings/`).
- **State:** Custom `settings.state.js` + `useSettings` hook.
- **Placeholders:** Settings modal has full UI (theme, text size, density, notifications, export). No multi-page Settings layout (Profile, Security, Devices, etc.) like myset source.

### Admin
- **Integrated:** Minimal. `AdminPlaceholder.jsx` at `src/pages/AdminPlaceholder.jsx` (not under `pages/admin/`). No dedicated admin layout or route guard. Admin Panel in Chat Sidebar opens a modal with metrics placeholders (Reconnect Count, Message Rate).
- **State:** None dedicated. No admin slices or admin-specific state.
- **Placeholders:** Admin is a simple placeholder page and an in-chat modal. No Dashboard, Users, Reports pages like our admin source.

---

## Section D: Route & Navigation Matrix

| Flow | Source | Target | Status |
|------|--------|--------|--------|
| **Login → Chat** | Auth: `/login` → redirect to `/home` or `/chat` when authenticated | Target: `/login` exists; no auth redirect to `/chat`. User can navigate manually. | **PARTIAL** |
| **Chat → Settings** | Chat Sidebar links to settings; myset: `/settings/*` | Target: Sidebar links to `/settings`. Settings page renders SettingsModal. | **DONE** |
| **Chat → Admin** | Admin: `/`, `/users`, `/reports` with AdminRouteGuard | Target: Sidebar "Admin Panel" opens modal; `/admin` route exists but shows placeholder page. | **PARTIAL** |
| **Auth routes** | Auth: `/login`, `/signup`, `/verify-otp`, `/forgot-password`, `/reset-password` | Target: `/login`, `/register`, `/forgot`, `/reset`. No `/verify-otp`, no `/signup` (uses `/register`). | **PARTIAL** |
| **Chat routes** | Chat: Single `Home` with embedded Sidebar + ChatWindow (no explicit /chat in mychat) | Target: `/chat` → ChatPlaceholder. Root `/` redirects to `/chat`. | **DONE** |
| **Settings routes** | myset: `/settings/profile`, `/settings/security`, etc. | Target: Single `/settings` page. No nested settings sub-routes. | **PARTIAL** |
| **Admin routes** | Admin: `/`, `/users`, `/reports` | Target: `/admin` → AdminPlaceholder. No sub-routes. | **PARTIAL** |

---

## Section E: UI/Interactivity Parity Matrix

| Module | Feature/Screen | Source Status | Target Status | Evidence |
|--------|----------------|---------------|---------------|----------|
| **Auth** | Login form | Full (Login.js) | DONE | `pages/auth/Login.jsx` |
| **Auth** | Register/Signup form | Full (Signup.js) | DONE | `pages/auth/Register.jsx` |
| **Auth** | Forgot password | Full (ForgotPassword.js) | DONE | `pages/auth/Forgot.jsx` |
| **Auth** | Reset password | Full (ResetPassword.js) | DONE | `pages/auth/Reset.jsx` |
| **Auth** | OTP verification | Full (VerifyOTP.js) | MISSING | — |
| **Auth** | AuthLoadingScreen | Full | PARTIAL | AuthLoadingGate in target |
| **Auth** | ProtectedRoute redirect | Full | PARTIAL | No redirect from auth to chat on login |
| **Chat** | Sidebar | Full | DONE | `components/chat/Sidebar.jsx` |
| **Chat** | ChatWindow | Full | DONE | `components/chat/ChatWindow.jsx` |
| **Chat** | NewGroupPopup | Full | DONE | `components/chat/NewGroupPopup.jsx` |
| **Chat** | GroupInfoPanel | Full | DONE | `components/chat/GroupInfoPanel.jsx` |
| **Chat** | Settings modal | Full | DONE | `components/layout/SettingsModal.jsx` |
| **Chat** | Report modals | Full | DONE | In ChatWindow |
| **Settings** | Modal (theme, density, etc.) | Full | DONE | SettingsModal |
| **Settings** | Multi-page layout (Profile, Security, etc.) | Full (myset) | MISSING | — |
| **Settings** | SettingsLayout with sidebar nav | Full (myset) | MISSING | — |
| **Admin** | Dashboard | Full | MISSING | — |
| **Admin** | Users page | Full | MISSING | — |
| **Admin** | Reports page | Full | MISSING | — |
| **Admin** | Admin layout with sidebar | Full | MISSING | — |
| **Admin** | AdminRouteGuard | Full | MISSING | — |
| **Admin** | In-chat metrics modal | N/A | PARTIAL | Sidebar Admin Panel modal |

---

## Section F: Directory Contract Check

**Required target structure:**
```
src/pages/auth/
src/pages/chat/
src/pages/settings/
src/pages/admin/
src/components/chat/
src/components/layout/
src/components/settings/
src/components/admin/
src/state/
src/services/
src/http/
src/websocket/
```

**Actual target structure:**

| Required | Actual | Status |
|----------|--------|--------|
| `src/pages/auth/` | EXISTS (Login, Register, Forgot, Reset) | OK |
| `src/pages/chat/` | **MISSING** — Chat lives at `pages/ChatPlaceholder.jsx`, `ChatList.jsx`, `ChatRoom.jsx` | **GAP** |
| `src/pages/settings/` | **MISSING** — Settings at `pages/Settings.jsx` | **GAP** |
| `src/pages/admin/` | **MISSING** — Admin at `pages/AdminPlaceholder.jsx` | **GAP** |
| `src/components/chat/` | EXISTS | OK |
| `src/components/layout/` | EXISTS | OK |
| `src/components/settings/` | **MISSING** — SettingsModal in `layout/` | **GAP** |
| `src/components/admin/` | **MISSING** | **GAP** |
| `src/state/` | EXISTS | OK |
| `src/services/` | EXISTS | OK |
| `src/http/` | EXISTS | OK |
| `src/websocket/` | EXISTS | OK |

**Missing by contract:** `pages/chat/`, `pages/settings/`, `pages/admin/`, `components/settings/`, `components/admin/`

---

## Section G: Risk Register

| ID | Severity | Risk | Cause |
|----|----------|------|-------|
| R1 | P0 | **Tech mismatch:** Target uses custom subscribable state (auth.state, chat.state, settings.state), not Redux. Constraint says "Redux" baseline. | Target was built without Redux; chat source uses Redux. |
| R2 | P0 | **Directory contract violation:** `pages/chat/`, `pages/settings/`, `pages/admin/`, `components/settings/`, `components/admin/` missing. | Files placed at `pages/*.jsx` and `layout/SettingsModal` instead. |
| R3 | P1 | **Admin module almost absent:** No Dashboard, Users, Reports. Only placeholder + modal. | Admin migration not done. |
| R4 | P1 | **Settings multi-page layout missing:** myset has Profile, Security, Devices, Preferences, Connection, Danger. Target has single Settings modal. | Settings layout migration not done. |
| R5 | P1 | **Auth OTP flow missing:** Source has VerifyOTP; target has no OTP. | Auth migration partial. |
| R6 | P2 | **Auth source uses react-router-dom; target uses wouter.** | Different routing libs. |
| R7 | P2 | **Chat source uses Redux + React Query; target uses custom state + mock.** | State architecture divergence. |
| R8 | P2 | **Login → Chat redirect not wired:** No post-login navigation to chat. | Auth flow incomplete. |

---

## Section H: Phase 3.0 Exit Verdict

### Can Phase 3.0 be considered complete?
**Yes** — as an analysis and documentation phase. All required deliverables are produced. No code changes were made.

### Blockers for Phase 3.1+

1. **Directory contract:** Decide whether to enforce `pages/chat/`, `pages/settings/`, `pages/admin/`, `components/settings/`, `components/admin/` or to update the contract to match current layout.
2. **Tech baseline:** Resolve Redux vs custom state. Either adopt Redux in target or update constraint.
3. **Admin:** Full admin module (Dashboard, Users, Reports, layout, guard) is not integrated.
4. **Settings:** Multi-page settings layout (Profile, Security, Devices, etc.) is not integrated.
5. **Auth flow:** Login → Chat redirect and OTP flow are not implemented.
6. **Routing library:** Align on wouter vs react-router-dom for final app.

---

**Document version:** 1.0  
**Phase:** 3.0 (Baseline Audit)
