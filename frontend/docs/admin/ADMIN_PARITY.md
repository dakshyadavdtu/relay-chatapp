# Admin Parity — our admin copy 4 vs myfrontend

## A) Feature-by-feature parity table

| Feature | Status | Backend | Notes |
|---------|--------|---------|-------|
| Dashboard | present + wired | GET /api/admin/dashboard | Real metrics |
| Users | present + wired | GET /api/admin/users | Real user list |
| Diagnostics/Role | present + wired | GET /api/admin/diagnostics/:userId, POST /api/admin/users/:id/role | User diagnostics + role promotion |
| Reports | present | GET /api/admin/reports → notAvailable | UI ported; backend returns structured notAvailable |

## B) Field inventory — Reports page

| Field / Section | Availability | Notes |
|-----------------|--------------|-------|
| Moderation Queue — reports list (id, date, user, priority) | **not available** | No reports store; would require new schema + user-report flow |
| Report Details — reason, date | not available | Depends on reports store |
| Message Context — thread of reported + surrounding messages | **not available** | No report-context linking; message store exists but not report-bound |
| Moderation Insights — Message Rate, Prev Warnings, Recent Reports, Suspicious Flags | **not available** | suspiciousDetector exists but not per-report; no warnings/reports store |
| User Metadata — Account Created, Last Known IP, Total Reports | **not available** | User store has createdAt; no IP tracking; no reports count |
| Resolve / Warn / Ban actions | **not available** | Would need POST endpoints + moderation store |

**Backend truth**: GET /api/admin/reports returns `{ success: true, data: { notAvailable: true, reason: "Reports moderation not implemented" } }`.

## C) Rendering rules

| State | UI behavior |
|-------|-------------|
| loading | Spinner / skeleton |
| unauthorized | "Login required" |
| forbidden | "Admin role required" |
| success + notAvailable | Banner: "Not available from backend yet" + empty/"—" values; controls disabled |
| success + data | Render real data |

No fake data. When `data.notAvailable === true`, UI shows explicit "Not available from backend yet" and does not fabricate numbers.
