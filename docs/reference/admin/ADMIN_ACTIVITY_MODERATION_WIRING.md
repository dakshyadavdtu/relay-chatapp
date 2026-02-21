# Admin Activity — Moderation Events Wiring

## Status: Already Implemented

All moderation actions in this repo **already emit** admin activity events. No new `recordEvent` calls were required; the only gap was **warnUser** not recording "Admin action blocked" when the root-protection guard fires — that block is already present in the file (warnUser, banUser, revokeOneSession, revokeSessions, unbanUser all record the blocked attempt).

---

## List of Code Locations (Existing)

| Action | File | Function | Lines (approx) | Event |
|--------|------|----------|----------------|-------|
| Report created | `backend/http/controllers/reports.controller.js` | `createReport` | 168–175 | type `report`, title "New report created", detail `Report <id>` |
| Resolve report | `backend/http/controllers/admin.controller.js` | `resolveReport` | 955–962 | type `admin`, title "Report resolved", detail `actor=... reportId=...` |
| Warn user | `backend/http/controllers/admin.controller.js` | `warnUser` | 1001–1008 | type `admin`, title "User warned", detail `actor=... target=... reason=...` |
| Ban user | `backend/http/controllers/admin.controller.js` | `banUser` | 1081–1088 | type `ban`, title "User banned", detail `actor=... target=...` |
| Unban user | `backend/http/controllers/admin.controller.js` | `unbanUser` | 1239–1246 | type `admin`, title "User unbanned", detail `actor=... target=...` (only when `wasBanned`) |
| Revoke one session | `backend/http/controllers/admin.controller.js` | `revokeOneSession` | 1148–1155 | type `admin`, title "Session revoked", detail `actor=... target=... sessionId=...` |
| Revoke all sessions | `backend/http/controllers/admin.controller.js` | `revokeSessions` | 1233–1240 | type `admin`, title "Sessions revoked", detail `actor=... target=... count=...` |
| Admin action blocked (root) | `backend/http/controllers/admin.controller.js` | `warnUser`, `banUser`, `revokeOneSession`, `revokeSessions`, `unbanUser` | 995–1005, 1040–1050, 1135–1145, 1207–1217, 1266–1276 | type `admin`, title "Admin action blocked", detail `actor=... reason=root_protected` |

Root protection is unchanged: `guardRootTarget(req, target, res)` runs before any mutation; when it blocks, the handler records "Admin action blocked" (actor + reason only, no target id) then returns. No API or auth changes.

---

## Sample Activity Feed Lines (As Rendered)

These are example lines as they appear in the System Activity feed (title + detail):

| # | type | title | detail |
|---|------|--------|--------|
| 1 | report | New report created | Report rpt-abc-123 |
| 2 | admin | Report resolved | actor=admin-uuid reportId=rpt-abc-123 |
| 3 | admin | User warned | actor=admin-uuid target=user-uuid reason=Spam in chat |
| 4 | ban | User banned | actor=admin-uuid target=user-uuid |
| 5 | admin | User unbanned | actor=admin-uuid target=user-uuid |
| 6 | admin | Session revoked | actor=admin-uuid target=user-uuid sessionId=sess-xyz |
| 7 | admin | Sessions revoked | actor=admin-uuid target=user-uuid count=3 |
| 8 | admin | Admin action blocked | actor=admin-uuid reason=root_protected |

---

## Optional Enhancement

**Report creation** in `reports.controller.js` currently uses `detail: \`Report ${record.id}\``. You could extend it to include reporter and target for consistency with other moderation events, e.g.:

`detail: \`actor=${userId} target=${record.targetUserId ?? 'n/a'} reportId=${record.id}\``

Only add this if you want report-created events to follow the same actor/target pattern as the rest.
