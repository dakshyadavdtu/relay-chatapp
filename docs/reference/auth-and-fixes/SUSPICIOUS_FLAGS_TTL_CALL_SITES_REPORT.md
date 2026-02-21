# Suspicious Flags TTL — Call Sites Report

**Goal:** Ensure all places that surface suspicious flags benefit from TTL pruning without extra work.

---

## 1. Call sites of `getUserFlags` and `getTotalFlagsCount`

| File | Function / context | Method | Caching? |
|------|-------------------|--------|----------|
| `backend/http/controllers/admin.controller.js` | `getDashboard()` (line 201) | `getTotalFlagsCount()` | No — called at request time, value sent in response. |
| `backend/http/controllers/admin.controller.js` | User list (line 532) | `getUserFlags(u.id)` per user | No — called per user in the page, result used immediately for `flagged`. |
| `backend/http/controllers/admin.controller.js` | User detail (line 630) | `getUserFlags(userId)` | No — at request time, used for count. |
| `backend/http/controllers/admin.controller.js` | Moderation insights (line 757) | `getUserFlags(targetUserId)` | No — at request time, used for count. |
| `backend/observability/adminDashboardBuffer.js` | `sample()` (line 69, every 1s) | `getTotalFlagsCount()` | No — each sample is a fresh call; value stored as that sample’s point. Next sample prunes again. |
| `backend/observability/snapshotWriter.js` | Snapshot write (line 39–40) | `getTotalFlagsCount()` | No — one-off read for a single snapshot. |
| `backend/diagnostics/console.snapshot.js` | `buildUserSnapshot(userId)` (line 49) | `getUserFlags(userId)` | No — built on demand; snapshot is point-in-time. |
| `backend/scripts/observability.selfcheck.js` | Self-check (line 67) | `getTotalFlagsCount()` | No — one-off read. |
| `backend/tests/suspicious/suspicious.test.js` | Various | Both | No — test assertions only. |
| `backend/tests/safety/flowControl.suspicious.test.js` | Test | Both | No — test only. |
| `backend/tests/safety/socketSafety.suspicious.test.js` | Test | Both | No — test only. |

---

## 2. Caching that would defeat pruning

**None.** Every call site either:

- Calls the getter at request/sample time and uses the result immediately (or stores it as a point-in-time value, e.g. buffer point or snapshot), or  
- Is a test doing one-off reads for assertions.

The dashboard buffer stores **past samples** of the pruned count; it does not cache the “current” count in a way that would bypass future pruning.

---

## 3. Admin dashboard metric and auto-prune

**Confirmed.** `backend/observability/adminDashboardBuffer.js` line 69:

```js
suspiciousFlags = suspiciousDetector.getTotalFlagsCount ? suspiciousDetector.getTotalFlagsCount() : 0;
```

`getTotalFlagsCount()` runs `pruneAllFlags(Date.now())` before counting, so each sample (every 1s) gets a freshly pruned count. The `suspiciousFlags` metric is therefore TTL-aware with no change to this file.

---

## 4. Direct access to `flagsStore` or other internal state

**None.** Grep for `flagsStore` shows references only inside `backend/suspicious/suspicious.detector.js`. The detector does not export `flagsStore` or any other internal state. No refactor to use public getters is required.

---

## Conclusion

- **No further code changes needed.** All call sites already use the public API (`getUserFlags`, `getTotalFlagsCount`), and none cache results in a way that would defeat TTL pruning. The admin dashboard metric uses `getTotalFlagsCount()` and automatically reflects pruned counts.
