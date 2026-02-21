# Admin Error Mapping & No-Refetch Behavior

## Error mapping (file + lines)

| Location | File | Lines |
|----------|------|-------|
| Dashboard adapter | `src/features/admin/adapters/useAdminDashboard.js` | 48–68 (catch block) |
| Users adapter | `src/features/admin/adapters/useAdminUsers.js` | 46–66 (catch block) |

### Mapping rules

| Status/Code | errorKey | errorMessage | blockRefetch |
|-------------|----------|--------------|--------------|
| 401 | UNAUTHORIZED | "Login required" | yes |
| 403, FORBIDDEN, NOT_AUTHORIZED | FORBIDDEN | "Admin role required" | yes |
| 404 | NOT_FOUND | "Not found" | no |
| ≥ 500 | SERVER_ERROR | server message | no |
| other | SERVER_ERROR | message or fallback | no |

## No-refetch loop guard

- **Implementation**: `blockRefetchRef.current` set to `true` on 401/403.
- **Location**: `useAdminDashboard.js` lines 28, 51–52; `useAdminUsers.js` lines 27, 49–54.
- **Effect guard**: `useEffect` checks `if (blockRefetchRef.current) return` before calling `refetch()`.
- **Behavior**: On 401/403, the effect exits early and does not call `refetch()` again. Manual retry is not allowed for auth errors (user must log in or refresh page).
