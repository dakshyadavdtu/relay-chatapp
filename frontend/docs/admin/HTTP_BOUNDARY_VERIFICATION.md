# Admin HTTP Boundary Verification

Admin API calls MUST flow: `admin.api.js` → `src/lib/http.js` (`apiFetch`).
No legacy `http/client.js`, direct `fetch`, or `axios` in admin features.

## Verification (run from `myfrontend/frontend`)

```bash
# Must return 0 matches (no legacy http client in admin)
rg -n 'http/client' src/features/admin || true

# Must return 0 matches (no direct fetch/axios; only apiFetch allowed)
rg -n '\bfetch\s*\(|axios\s*\(' src/features/admin || true
```

Expected: both commands produce no output.

## Architecture

| Layer       | File                   | Responsibility                          |
|------------|------------------------|-----------------------------------------|
| Pages      | `pages/admin/*`        | UI only; use adapters                   |
| Adapters   | `features/admin/adapters/*` | Call `admin.api.js` functions  |
| API        | `features/admin/api/admin.api.js` | `apiFetch` for all endpoints |
| HTTP       | `lib/http.js`          | Single `apiFetch`; credentials; 401     |
| Legacy     | `http/client.js`       | DISABLED (throws at load)               |

## Endpoints (admin.api.js)

- `fetchAdminDashboard()` → GET `/api/admin/dashboard`
- `fetchAdminUsers({ q, limit, cursor })` → GET `/api/admin/users?q=&limit=&cursor=`
- `fetchAdminDiagnostics(userId)` → GET `/api/admin/diagnostics/:userId`
- `setUserRole(userId, role)` → POST `/api/admin/users/:id/role` body `{ role }`
