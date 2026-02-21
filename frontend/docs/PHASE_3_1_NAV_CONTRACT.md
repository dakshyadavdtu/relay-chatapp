# Phase 3.1 — Navigation Contract Lock

**Date:** 2026-02-11  
**Scope:** UI-flow correction only. No API/socket, no UI redesign.

---

## Summary of Exact Behavior Changed

1. **Root path (`/`):** Redirects to `/login` instead of `/chat`.
2. **Login submit:** On form submit (UI-only), navigates to `/chat`.
3. **Admin button:** Sidebar Admin Panel button now navigates to `/admin` instead of opening a local metrics modal. Modal and related state removed.
4. **Settings button:** Unchanged — continues to link to `/settings`.

---

## Files Modified (1-line reason each)

| File | Reason |
|------|--------|
| `src/routes.jsx` | Root redirect changed from `/chat` to `/login`. |
| `src/pages/auth/Login.jsx` | Added `useLocation` and `setLocation("/chat")` on submit. |
| `src/components/chat/Sidebar.jsx` | Replaced Admin modal with `Link href="/admin"`; removed `showAdminPanel` state and modal JSX. |

---

## Validation Command Outputs

### 1. `npm run build`
**Result:** PASS. Build completed in ~2.56s. No errors. (Vite dynamic import note for auth.api.js is pre-existing.)

### 2. `rg -n "Redirect to=\"/login\"|path=\"/admin\"|href=\"/settings\"|href=\"/admin\"" src`
```
src/routes.jsx:36:        <Redirect to="/login" />
src/routes.jsx:33:      <Route path="/admin" component={AdminPlaceholder} />
src/components/chat/Sidebar.jsx:163:        <Link href="/settings">
src/components/chat/Sidebar.jsx:169:        <Link href="/admin">
```
All four patterns present.

### 3. `git status --short`
myfrontend/frontend/ is untracked in workspace; within it, Phase 3.1 touched: routes.jsx, Login.jsx, Sidebar.jsx, docs/PHASE_3_1_NAV_CONTRACT.md.

---

## Navigation Verification Checklist

| Flow | Expected | Evidence |
|------|----------|----------|
| Login submit lands on `/chat` | Yes | `Login.jsx` handleSubmit calls `setLocation("/chat")` |
| Sidebar Settings opens `/settings` | Yes | `Sidebar.jsx` has `Link href="/settings"` |
| Sidebar Admin opens `/admin` | Yes | `Sidebar.jsx` has `Link href="/admin"` |
| Root `/` lands on `/login` | Yes | `routes.jsx` has `Redirect to="/login"` |

---

**Phase:** 3.1 (Navigation Contract Lock)
