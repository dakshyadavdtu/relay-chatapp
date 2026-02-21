# Phase 8C: Admin Panel Contract Inventory

## A) Frontend Entrypoints

### Routes
- **File:** `myfrontend/frontend/src/routes.jsx`
- **Admin route tree:**
  - `/admin` → DashboardPage (AdminLayout)
  - `/admin/users` → AdminUsersPage (AdminLayout)
  - `/admin/users/:userId` → AdminDiagnosticsPage (AdminLayout) — user detail + role control
  - `/admin/diagnostics/:userId` → AdminDiagnosticsPage (AdminLayout) — diagnostics view

### Admin feature
- **Directory:** `myfrontend/frontend/src/features/admin/`
  - `ui/AdminLayout.jsx` — sidebar nav (Dashboard, Users), Return to Chat
  - `adapters/useAdminDashboard.js` — calls fetchAdminDashboard()
  - `adapters/useAdminUsers.js` — calls fetchAdminUsers({ q, cursor, limit })
  - `api/admin.api.js` — fetchAdminDashboard, fetchAdminUsers, fetchAdminDiagnostics, setUserRole
  - `AdminPage.jsx` — diagnostics + role promotion (used for both /admin/users/:userId and /admin/diagnostics/:userId)

### Pages
- `myfrontend/frontend/src/pages/admin/DashboardPage.jsx`
- `myfrontend/frontend/src/pages/admin/AdminUsersPage.jsx`

---

## B) Backend Contract (Actual)

### Routes
- **File:** `backend/http/routes/admin.routes.js`
- Mounted under `/admin` (via `http/index.js` under `/api`)
- All routes require `requireAuth` + role middleware:
  - `GET /dashboard` — requireAdmin
  - `GET /users` — requireAdmin
  - `GET /diagnostics/:userId` — requireAdmin
  - `POST /users/:id/role` — requireAdmin

### Controller
- **File:** `backend/http/controllers/admin.controller.js`

---

## C) Contract Table: UI Expects vs Backend Returns

### GET /api/admin/dashboard
| Field | Backend Returns | UI Expects |
|-------|-----------------|------------|
| onlineUsers | ✓ connections.totalConnections | ✓ |
| messagesPerSecond | ✓ events.messagesPerSecond | ✓ |
| latencyAvg | ✓ latency.avgLatency | ✓ |
| suspiciousFlags | ✓ suspiciousDetector.getTotalFlagsCount() | ✓ |
| adminsCount | ✓ countByRole.admin | ✓ |
| regularUsersCount | ✓ countByRole.user | ✓ |
| **Wrapper** | sendSuccess(res, data) → `{ success: true, data }` | fetchAdminDashboard returns json.data |

### GET /api/admin/users
| Field | Backend Returns | UI Expects |
|-------|-----------------|------------|
| users | Array of `{ id, username, status, flagged, lastSeen, messages, failures, reconnects, violations, latency, role, email }` | ✓ |
| nextCursor | string \| null | ✓ |
| total | number | ✓ |
| notAvailable | `['violations','latency','email']` | ✓ |
| **Wrapper** | sendSuccess(res, { users, nextCursor, total, notAvailable }) | fetchAdminUsers returns json.data |

### GET /api/admin/diagnostics/:userId
| Field | Backend Returns | UI Expects |
|-------|-----------------|------------|
| userId | string | ✓ |
| snapshot | object (buildUserSnapshot) | ✓ |
| timestamp | number | ✓ |
| **Wrapper** | sendSuccess(res, { userId, snapshot, timestamp }) → `{ success: true, data }` | fetchAdminDiagnostics returns json.data; AdminPage displays diagResult |

### POST /api/admin/users/:id/role
| Field | Backend Returns | UI Expects |
|-------|-----------------|------------|
| success | true | ✓ |
| message | "User promoted to admin" | ✓ |
| user | `{ userId, role }` | ✓ |
| **Wrapper** | `res.status(200).json({ success, message, user })` | setUserRole returns apiFetch result |

---

## Error Mapping (apiFetch + adapters)

| Status | Meaning | UI Shows |
|--------|---------|----------|
| 401 | Unauthenticated | "Login required" |
| 403 | Forbidden (admin required) | "Admin role required" / "Access denied" |
| 404 | Not found | "Route not found" / "User not found" |
| 500 | Server error | message + code |
