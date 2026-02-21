# Warn User Button Fix

## Summary

Fixed and verified "Warn User" button on Admin Reports page to successfully create warning records and update the Prev Warnings count in real-time.

## Files Changed

1. **`myfrontend/frontend/src/pages/admin/AdminReportsPage.jsx`**
   - Updated `handleWarnUser()` to:
     - Include HTTP status code in error toast (e.g., `[403]`, `[429]`)
     - Call `details.refetch()` after successful warn to update Prev Warnings count
   - Reason: Better error diagnostics and real-time UI updates

## Verification Checklist

### ✅ 1. Frontend Implementation

- **AdminReportsPage.jsx** (line 83-98):
  - `handleWarnUser()` calls `adminWarnUser(targetUserId, warnReason)` ✅
  - Error handling shows status code + error code ✅
  - Calls `details.refetch()` after success to update insights ✅

- **admin.api.js** (line 335-340):
  - `adminWarnUser()` uses `POST /api/admin/users/:id/warn` ✅
  - Sends reason in body (max 500 chars) ✅

### ✅ 2. Backend Implementation

- **admin.routes.js** (line 51):
  - Route exists: `POST /users/:id/warn -> adminController.warnUser` ✅
  - Protected with `requireAdmin` middleware ✅
  - Rate limited with `adminActionLimiter` (60 req/hour per admin) ✅

- **admin.controller.js** (line 843-874):
  - `warnUser()` function exists ✅
  - Validates userId and reason ✅
  - Creates warning via `warningsStore.createWarning()` ✅
  - Returns `{ id, userId }` on success ✅
  - Error codes: `400` (validation), `404` (user not found), `500` (server error) ✅

### ✅ 3. targetUserId Mapping

- **reports.mongo.js** (line 108-131):
  - Message reports: `targetUserId = senderId` (line 120) ✅
  - User reports: `targetUserId = targetUserIdRaw` (line 129) ✅
  - Both types always have `targetUserId` set ✅

- **admin.controller.js** (line 626):
  - `getReports()` includes `targetUserId` in response ✅
  - Falls back to `null` if missing (defensive) ✅

### ✅ 4. Error Handling

**Frontend Error Display:**
```javascript
// Before:
toast({ title: "Warn failed", description: `${msg}${code}`, ... });

// After:
toast({ title: "Warn failed", description: `${msg}${status}${code}`, ... });
// Shows: "Failed to warn user [403] (FORBIDDEN)"
```

**Common Error Scenarios:**
- `targetUserId` is null → Button disabled (line 84: `if (!targetUserId ...)`)
- `403` → Not ADMIN or middleware mismatch
- `429` → Rate limited (adminActionLimiter: 60 req/hour)
- `404` → User not found
- `500` → Server error

### ✅ 5. Prev Warnings Update

- After successful warn:
  1. `adminWarnUser()` creates warning record ✅
  2. `refetch()` updates reports list ✅
  3. `details.refetch()` updates report details ✅
  4. `computeReportInsights()` recalculates `prevWarnings` ✅
  5. UI displays updated count in "Prev Warnings" card ✅

## Manual Test Steps

1. **Create a report:**
   ```bash
   curl -X POST http://localhost:3000/api/reports \
     -H "Content-Type: application/json" \
     -H "Cookie: ..." \
     -d '{
       "reason": "Spam",
       "targetUserId": "user123"
     }'
   ```

2. **Open Admin Reports page:**
   - Navigate to `/admin/reports`
   - Verify report appears in moderation queue
   - Click on the report to select it

3. **Verify Prev Warnings initial value:**
   - Check "Moderation Insights" → "Prev Warnings" card
   - Note the current count (e.g., `0`)

4. **Click "Warn User" button:**
   - Button should be enabled (targetUserId exists)
   - Click "Warn User"
   - Verify success toast: "User warned - Warning recorded for user."

5. **Verify Prev Warnings increments:**
   - Check "Prev Warnings" card again
   - Should show incremented count (e.g., `0` → `1`)
   - No page refresh needed (real-time update via `details.refetch()`)

6. **Test error scenarios:**
   - **Rate limit**: Click warn 60+ times in 1 hour → Should show `[429] (RATE_LIMITED)`
   - **Not admin**: Login as non-admin → Button disabled or shows `[403] (FORBIDDEN)`
   - **Invalid user**: Use invalid targetUserId → Should show `[404] (USER_NOT_FOUND)`

## Expected Behavior

### Success Flow:
1. Admin clicks "Warn User"
2. Backend creates warning record
3. Frontend shows success toast
4. Report details refetch automatically
5. "Prev Warnings" count updates immediately (e.g., `0` → `1`)

### Error Flow:
1. Admin clicks "Warn User"
2. Backend returns error (e.g., 403, 429, 404, 500)
3. Frontend shows error toast with status + code:
   - `"Failed to warn user [403] (FORBIDDEN)"`
   - `"Failed to warn user [429] (RATE_LIMITED)"`
   - `"User not found [404] (USER_NOT_FOUND)"`
4. Button re-enables (allows retry if transient error)

## Implementation Details

### Warning Record Creation:
- Stored in `warnings` collection (MongoDB)
- Fields: `id`, `userId`, `adminId`, `reason?`, `createdAt`
- Idempotent: Each call creates a new warning (no deduplication)

### Rate Limiting:
- `adminActionLimiter`: 60 requests per hour per admin
- Key: `req.user.userId` (per-admin limit, not per-IP)
- Response: `429` with `code: 'RATE_LIMITED'`

### Prev Warnings Calculation:
- Uses `warningsStore.countByUser(targetUserId)`
- Counts all warnings for the user (no time window)
- Updates immediately after warn via `details.refetch()`

## Notes

- Warn button is disabled if `targetUserId` is null (defensive)
- Report details refetch happens automatically after warn (no manual refresh needed)
- Error messages include both HTTP status code and error code for debugging
- Rate limit is per-admin (60/hour), not per-IP, to prevent abuse
