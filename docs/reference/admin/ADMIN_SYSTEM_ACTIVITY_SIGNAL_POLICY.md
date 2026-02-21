# Admin System Activity – Signal Quality Policy

## Policy choice: **POLICY A (no success logging)**

We use **Policy A**: do not record a "Message processed" (or any success) event for routine WS message handling. The activity feed is intended for **signal-rich** events: failures, lifecycle (connect/disconnect), moderation (report, flag, ban), and admin actions. Emitting an event on every successful message would dominate the feed, bloat the in-memory buffer and DB, and add no operational value. Sampling (Policy B) or logging only admin/moderation message types (Policy C) would still allow high volume from busy rooms or power users. Removing success logging entirely keeps the feed balanced, protects DB growth, and requires no schema or API changes. Important events (failure, report, flag, ban, connect, disconnect, admin) continue to be recorded at their existing call sites.

## Feed-level filtering (default allowlist)

Both activity endpoints apply a **type allowlist** by default so that even if `info` (or other high-volume) events exist in the buffer or DB, the dashboard feed stays balanced:

- **Default types returned:** `connect`, `disconnect`, `failure`, `report`, `flag`, `ban`, `admin`, `spike`
- **GET /api/admin/activity:** uses this allowlist by default; override with `?types=connect,disconnect,info` if needed
- **GET /api/admin/dashboard/activity:** already used this allowlist for DB and fallback; unchanged
- **Fallback (in-memory buffer when DB fails):** same allowlist is passed as `typeAllowlist` to `getEvents()`, so filtering is consistent

## Demo output: 10 example activity items (variety)

After the change, the dashboard activity feed shows only allowlisted types. Example items that may appear (format matches API response):

| # | type        | title                  | detail                                      |
|---|-------------|------------------------|---------------------------------------------|
| 1 | connect     | User connected         | userId: usr_abc sessionId: sess_xyz          |
| 2 | disconnect  | User disconnected      | userId: usr_abc sessionId: sess_xyz         |
| 3 | failure     | Message delivery failure | userId: usr_def                            |
| 4 | report      | New report created     | Report rep_123                              |
| 5 | flag        | User flagged           | userId: usr_ghi (MESSAGE_BURST)             |
| 6 | flag        | User flagged           | userId: usr_jkl reason: RECONNECT_BURST     |
| 7 | ban         | User banned            | userId: usr_mno                             |
| 8 | admin       | Session revoked        | userId: usr_pqr sessionId: sess_2           |
| 9 | spike       | Traffic spike          | messages in window                          |
|10 | disconnect  | User disconnected      | userId: usr_stu sessionId: sess_3           |

No "Message processed: userId ..." entries appear in the default feed. Override with `?types=info` only if raw diagnostics are needed.
