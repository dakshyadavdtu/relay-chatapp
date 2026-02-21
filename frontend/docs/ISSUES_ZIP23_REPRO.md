# ISSUES_ZIP23 — Reproducible checklist and dev commands

**Note:** The zip file `/mnt/data/z integrated frontend nayii wali copy 23.zip` was not found at that path. This checklist and paths refer to the **current workspace** as the repo. If you unzip the zip elsewhere, adjust paths accordingly.

---

## Repo roots (exact paths)

| Role        | Path (absolute) | Path (from repo root) |
|------------|------------------|------------------------|
| **Repo root** | `.../z integrated frontend nayii wali` | `.` |
| **Backend root** | `.../z integrated frontend nayii wali/backend` | `backend/` |
| **Frontend root** | `.../z integrated frontend nayii wali/myfrontend/frontend` | `myfrontend/frontend/` |

- Backend entry: `backend/server.js` (see `package.json` `"main":"server.js"`).
- Frontend entry: Vite dev server (see `myfrontend/frontend/package.json` `"dev":"vite"`).

---

## One-command dev start (two terminals)

From **repo root** (`z integrated frontend nayii wali`):

**Terminal 1 — Backend**
```bash
cd backend && npm run dev
```
- Expect: server listening (default `PORT=8000` in dev). Log line with `B1 DEV: PORT=...`.

**Terminal 2 — Frontend**
```bash
cd myfrontend/frontend && npm run dev
```
- Expect: Vite dev server (default port 5173). Open http://localhost:5173 (or the port Vite prints).

**Port contract:** Frontend proxies `/api` and `/ws` to `VITE_BACKEND_PORT` (default 8000). Backend in dev defaults to `PORT=8000`. Keep them aligned.

---

## Install dependencies

From repo root:

```bash
cd backend && npm install
cd ../myfrontend/frontend && npm install
```

Use `npm` (repo uses npm; no pnpm lockfile in scope).

---

## Repro checklist — 10 issues

Fill in each issue when defined. For each: click path, observed vs expected, and file candidates.

### Issue 1 — Toast “X” does not dismiss immediately
- **How to reproduce (click path):** Trigger any toast (e.g. Login → submit; or Settings → any action that shows a toast). Click the top-right X on the toast.
- **Observed (before fix):** Toast stayed visible for several seconds after clicking X.
- **Expected:** Toast disappears immediately from the UI when X is clicked.
- **Root cause:** (1) Toaster rendered all items in `toasts` regardless of `open`; (2) REMOVE_TOAST was scheduled after `TOAST_REMOVE_DELAY` (5000ms), so state kept the toast for 5s after dismiss.
- **Fixed by:**  
  - **Rendering:** Only render toasts with `open !== false` in `Toaster` (`toasts.filter(t => t.open !== false)`), so as soon as DISMISS_TOAST sets `open: false`, the toast is no longer rendered.  
  - **Removal timing:** Reduced `TOAST_REMOVE_DELAY` from 5000ms to 200ms in `useToast.js` so dismissed toasts are pruned from state quickly (no memory leak).  
- **File references:** `myfrontend/frontend/src/hooks/useToast.js`, `myfrontend/frontend/src/components/ui/toaster.jsx`.  
- **Verify:** Trigger toast → click X → disappears immediately. With multiple toasts (if TOAST_LIMIT increased), dismiss middle one → only that one disappears. Auto-dismiss unchanged. No console errors.

### Issue 2 — Remove “old db not implemented” / “not implemented” red warning
- **How to reproduce (click path):** Admin → Reports when backend returns notAvailable or when reports API is unavailable.
- **Observed (before fix):** Red or prominent “Not available from backend yet. Reports API not implemented.” (or backend `reason` containing “not implemented” / “old db”).
- **Expected:** No user-visible “not implemented” or technical reason text; neutral message only.
- **Source location and removal:**
  - **AdminReportsPage.jsx:** Replaced banner text “Not available from backend yet. {reason ?? 'Reports API not implemented.'}” with neutral “Reports moderation is not available right now.” Removed any UI display of `reason`. Added `console.debug('[AdminReports] not available:', reason)` when `notAvailable && reason` so devs can still see the backend reason.
- **Note:** The exact string “old db not implemented” was not found in the repo; the fix removes all user-visible “not implemented” and technical-reason emission. If a backend ever sent that reason, it would have appeared in these banners; it is now debug-only.

### Issue 3 — IP shown wrong everywhere (normalize capture + read)
- **How to reproduce (click path):** Login on localhost → Settings → Security (right widget) or Settings → Devices or Admin → Reports → User metadata → Last known IP. Compare displayed IP.
- **Observed (before fix):** ::1 or ::ffff:127.0.0.1 shown instead of 127.0.0.1; inconsistent or wrong when behind proxy.
- **Expected:** Dev localhost shows 127.0.0.1; behind proxy shows first public IP from X-Forwarded-For. Same value in all three places. Null/unknown shows "—".
- **Fixed by:** Shared IP normalization utility and consistent capture/read.
  - **backend/utils/ip.js:** `normalizeIp(raw)` (::1 → 127.0.0.1, strip ::ffff:, XFF first), `getClientIpFromReq(req)`, `getClientIpFromWsRequest(request)`.
  - **Capture:** auth.controller.js (login + register) uses `getClientIpFromReq(req)`; wsServer.js uses `getClientIpFromWsRequest(request)` for WS clientIp.
  - **Read:** sessions.controller.js and admin.controller.js (getUserSessions, getReportDetails userMeta) normalize IP before returning via `normalizeIp(...) ?? null`.
  - **Frontend:** SecurityPage and DevicesPage display `ip ?? "—"`; Admin Reports/Users already use "—" for null.
- **File references:** `backend/utils/ip.js`, `backend/http/controllers/auth.controller.js`, `backend/websocket/connection/wsServer.js`, `backend/http/controllers/sessions.controller.js`, `backend/http/controllers/admin.controller.js`, `myfrontend/frontend/src/pages/settings/SecurityPage.jsx`, `myfrontend/frontend/src/pages/settings/DevicesPage.jsx`.

### Issue 4 — Remove 3-dots menu next to username in Admin Users directory
- **How to reproduce (click path):** Admin → Users → User Directory (left column list).
- **Observed (before fix):** A 3-dots (kebab) icon button appeared to the right of each username row.
- **Expected:** No kebab button; row remains clickable to select user; layout aligned.
- **Fixed by:** Removed the kebab `Button` with `MoreVertical` icon from each user row in the User Directory. Removed `MoreVertical` from lucide-react imports. Changed row layout from `justify-between` to `justify-start` so alignment stays correct without the right-side button. No dropdown/popover was present (button only).
- **File reference:** `myfrontend/frontend/src/pages/admin/AdminUsersPage.jsx`.

### Issue 5 — Make/Revoke system admin shows "Root (locked)" correctly; only root can change roles
- **How to reproduce (click path):** Login as root (email = `ROOT_ADMIN_EMAIL`) → Admin → Users. Select another user → use "Make Admin" or "Revoke Admin". Login as non-root admin → Admin → Users: no Make/Revoke control. Root’s row shows "Root (locked)".
- **Observed (before fix):** "Root (locked)" could appear for non-root users, or Make/Revoke not restricted to root.
- **Expected:** Root identity from env `ROOT_ADMIN_EMAIL` (case-insensitive). Only root can grant/revoke ADMIN. Root cannot change own role or revoke root. Root row shows "Root (locked)"; other users show Make/Revoke when viewer is root. Backend and UI use consistent `isRootAdmin`; role change works end-to-end.
- **Endpoints and fields:**
  - **GET /api/me** — Response `data.user` includes `isRootAdmin` (boolean). Root is determined by comparing user email to `ROOT_ADMIN_EMAIL`.
  - **GET /api/admin/users** — Each user object includes `isRootAdmin` (boolean). Only the user whose email matches `ROOT_ADMIN_EMAIL` has `isRootAdmin: true`.
  - **POST /api/admin/users/:id/role** — Body `{ role: "ADMIN" | "USER" }`. Protected by `requireRootAdmin` (403 for non-root). Rejects self-role-change and changing root. Returns `{ success, message, user: { userId, username, role, isRootAdmin } }`.
- **File references:** Backend: `backend/config/constants.js` (ROOT_ADMIN_EMAIL), `backend/http/middleware/auth.middleware.js` (sets req.user.isRootAdmin), `backend/http/middleware/requireRootAdmin.js`, `backend/http/controllers/auth.controller.js` (getMe: apiUser.isRootAdmin), `backend/http/controllers/admin.controller.js` (getUsers: isRootAdmin per user; promoteUserToAdmin: root-only, returns user with isRootAdmin), `backend/http/routes/admin.routes.js` (POST /users/:id/role with requireRootAdmin). Frontend: `myfrontend/frontend/src/http/auth.api.js` (getCurrentUser → /api/me), `myfrontend/frontend/src/features/admin/api/admin.api.js` (normalizeUser: isRootAdmin; setUserRole), `myfrontend/frontend/src/pages/admin/AdminUsersPage.jsx` (viewer.isRootAdmin gates Make/Revoke; selectedUser.isRootAdmin shows "Root (locked)").

### Issue 6 — User info panel "Avg Latency" shows value (RTT from heartbeat) or "—"
- **How to reproduce (click path):** Admin → Users → select a user. In the right-hand panel, check "Avg Latency". With two browser sessions (user online), wait a few heartbeat cycles (~30s); avg latency should show a value in ms. For a user with no samples or offline, show "—". Opening a user by direct route (e.g. /admin/diagnostics/:userId) or retained selection still shows diagnostics including avg latency when available.
- **Observed (before fix):** Avg latency was always blank/null (backend returned null).
- **Expected:** Server-side rolling average of WS heartbeat RTT (ping→pong) per user. When user is online or has samples, show meaningful value (e.g. "42 ms"); when no samples, show "—". Does not depend on user being in the directory list.
- **Implementation:**
  - **RTT sampling:** `websocket/connection/heartbeat.js` — before each `ws.ping()` set `ws._lastPingTs = Date.now()`; in `pong` handler compute `rttMs = Date.now() - ws._lastPingTs`, then `userDiagnostics.recordLatencySample(userId, rttMs)`.
  - **Per-user rolling average:** `diagnostics/userDiagnosticsAggregator.js` — `recordLatencySample(userId, rttMs)`; store `avgLatencyMs` and `latencySampleCount` (cap 100 samples); first sample sets avg, then rolling avg.
  - **Exposure:** `GET /api/admin/users` — each user has `avgLatencyMs` (number or null) from diagnostics. `GET /api/admin/diagnostics/:userId` — `metrics.avgLatencyMs` (number or null).
  - **Frontend:** Admin user detail panel uses `diagnostics.metrics.avgLatencyMs`; display `"X ms"` when number, `"—"` when null/undefined.
- **File references:** Backend: `backend/websocket/connection/heartbeat.js`, `backend/diagnostics/userDiagnosticsAggregator.js`, `backend/http/controllers/admin.controller.js` (getUsers, getDiagnostics). Frontend: `myfrontend/frontend/src/pages/admin/AdminUsersPage.jsx` (Avg Latency cell).

### Issue 7 — Admin must not see themselves in Admin → Users directory
- **How to reproduce (click path):** Log in as an admin → Admin → Users. Open the User Directory list.
- **Observed (before fix):** The current user (admin) appeared in the directory list.
- **Expected:** The logged-in admin does not see themselves in the User Directory list. Search and pagination unchanged. If the only user is the current user, show "No users found".
- **Implementation:** Frontend filter in Admin Users page: derive `listUsers = usersData.filter((u) => u.id !== viewer?.id)`; use `listUsers` for the directory list and empty state. Viewer comes from `useAuth().user` (/api/me). Selection: when `selectedUserId === viewer?.id`, set selection to first list user or null; auto-select first list user when list has items and none selected.
- **File reference:** `myfrontend/frontend/src/pages/admin/AdminUsersPage.jsx`.

### Issue 8 — Show email below username in user search (chat DM + create group)
- **How to reproduce (click path):** (A) Chat sidebar → search in DM/user search: results show username + email. (B) Create group → user picker search: results show username + email. No short userId line.
- **Observed (before fix):** Secondary line showed username (when different from displayName) or short userId (create group picker).
- **Expected:** Line 1: username/display name (normal). Line 2: email only (smaller, muted). If email missing, show nothing. Row height reasonable.
- **Implementation:** Backend GET /api/users/search already returns email (toApiUser in user.controller; userLookup.searchUsers returns toPublicUser with email). Frontend: (A) Sidebar user search results — use email for line 2 (text-xs text-muted-foreground), show only when present. (B) NewGroupPopup user picker — replace short id line with email (text-[10px] text-muted-foreground); show nothing when email missing. Filter in NewGroupPopup includes email in search. Placeholder "Search users...".
- **File references:** `myfrontend/frontend/src/features/chat/ui/Sidebar.jsx`, `myfrontend/frontend/src/features/chat/ui/NewGroupPopup.jsx`, `myfrontend/frontend/src/features/chat/api/users.api.js`. Backend: `backend/http/controllers/user.controller.js` (searchUsers), `backend/utils/apiShape.js` (toApiUser), `backend/users/user.service.js` (searchUsers, toPublicUser).

### Issue 9 — Updated avatar reflects to self + other users in chat and profile
- **How to reproduce (click path):** Open two sessions (User A, User B). User A: Settings → Profile → update avatar and save. User A sees new avatar in profile and in chat immediately. User B sees A’s new avatar in sidebar and in chat header/messages without refresh.
- **Observed (before fix):** Avatar might not update for other users; or same URL cached; or profile/sidebar not using AvatarImage.
- **Expected:** Backend truth + WS broadcast (USER_UPDATED). UI renders avatarUrl via AvatarImage with cache-bust (?v=updatedAt). Self: profile and chat update immediately (PATCH response + auth state; USER_UPDATED updates auth when self). Others: USER_UPDATED updates usersById/users; sidebar, chat header, message list use avatarUrl with cache-bust.
- **Implementation:** Backend: PATCH /api/me emits userUpdated with userId, displayName, avatarUrl, updatedAt (Date.now()). WS broadcasts USER_UPDATED with same. Response includes user.updatedAt for cache-bust. Frontend: ChatAdapterContext on USER_UPDATED updates usersById and users with avatarUrl + updatedAt; when msg.userId === self, setAuthState({ user: { ...me, displayName, avatarUrl, updatedAt } }). avatarSrc(url, updatedAt) helper appends ?v= or &v= for cache-bust. Sidebar: AvatarImage with avatarSrc in direct list, search results, matched direct chats. ChatWindow/RoomMessageList: AvatarImage src uses avatarSrc. ProfilePage: profile avatar img uses avatarSrc for http URLs so cache-bust applies.
- **File references:** Backend: `backend/http/controllers/auth.controller.js`, `backend/events/userUpdated.js`, `backend/websocket/index.js`. Frontend: `myfrontend/frontend/src/features/chat/utils/avatarUrl.js`, `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx`, `myfrontend/frontend/src/features/chat/ui/Sidebar.jsx`, `myfrontend/frontend/src/features/chat/ui/ChatWindow.jsx`, `myfrontend/frontend/src/features/chat/group/RoomMessageList.jsx`, `myfrontend/frontend/src/pages/settings/ProfilePage.jsx`.

### Issue 10 — Remove "Connection" option and content from Settings left column
- **How to reproduce (click path):** Settings (any sub-page). Check left sidebar; try opening /settings/connection directly.
- **Observed (before fix):** "Connection" appeared in the Settings left sidebar; /settings/connection showed the Connection page.
- **Expected:** Settings left sidebar must not show "Connection". Direct URL /settings/connection must not show that page (redirect or 404).
- **Implementation:** Removed "Connection" nav item and Wifi icon from SettingsLayout NAV_ITEMS. Removed /settings/connection route that rendered ConnectionPage; added route that redirects /settings/connection → /settings. Removed SETTINGS_CONNECTION from config/settings.routes.js and from SETTINGS_SUB_ROUTES. Deleted ConnectionPage.jsx. No dead imports.
- **File references:** `myfrontend/frontend/src/components/settings/SettingsLayout.jsx`, `myfrontend/frontend/src/routes.jsx`, `myfrontend/frontend/src/config/settings.routes.js`; deleted `myfrontend/frontend/src/pages/settings/ConnectionPage.jsx`.
- **Verify:** Settings page loads; Connection is not visible in sidebar. Visiting /settings/connection redirects to /settings.

---

## Unzip (when zip is available)

If you have the zip at the path below (or equivalent), unzip to a clean folder without overwriting:

```bash
mkdir -p ./repo_zip23
unzip "/mnt/data/z integrated frontend nayii wali copy 23.zip" -d ./repo_zip23
```

Then use `./repo_zip23/<contents>` as repo root and adjust paths in this doc accordingly.
