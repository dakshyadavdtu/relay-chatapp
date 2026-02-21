# Dashboard Messages Precision Fix

## Summary

Fixed dashboard "System Performance" graph and messages/sec display to preserve decimal precision instead of rounding to integers, which was destroying small values like 0.05 → 0.

## Root Cause

Backend `getDashboardTimeseries()` was rounding `messagesPerSecondAvg` to integer:
```javascript
messages: Math.max(0, Math.round(Number(p.messagesPerSecondAvg) || 0))
```

This destroyed small values:
- `0.05` → `0` (chart appears dead)
- `0.15` → `0` (chart appears dead)
- `1.5` → `2` (inaccurate)

## Files Changed

1. **`backend/http/controllers/admin.controller.js`**
   - Updated `getDashboardTimeseries()` to preserve 2-decimal precision
   - Changed from `Math.round()` to `Math.round(m * 100) / 100`
   - Matches precision used by `adminDashboardBuffer.getSeries()` (which already rounds to 2 decimals)

## Before/After Example

### Before (Integer Rounding):
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "time": "2024-01-15T10:00:00.000Z",
        "messages": 0,  // ❌ Was 0.05, rounded to 0
        "connections": 5
      },
      {
        "time": "2024-01-15T11:00:00.000Z",
        "messages": 0,  // ❌ Was 0.15, rounded to 0
        "connections": 6
      }
    ]
  }
}
```

### After (2-Decimal Precision):
```json
{
  "success": true,
  "data": {
    "points": [
      {
        "time": "2024-01-15T10:00:00.000Z",
        "messages": 0.05,  // ✅ Preserved
        "connections": 5
      },
      {
        "time": "2024-01-15T11:00:00.000Z",
        "messages": 0.15,  // ✅ Preserved
        "connections": 6
      }
    ]
  }
}
```

## Frontend Verification

- **Chart Data Mapping**: `DashboardPage.jsx` line 137 correctly handles numeric values:
  ```javascript
  messages: typeof p.messages === "number" ? p.messages : (Number(p.messages) || 0)
  ```
  ✅ Supports decimal numbers correctly

- **Polling**: `useAdminDashboardTimeseries` polls every 4 seconds (`POLL_INTERVAL_MS = 4000`)
  ✅ Updates frequently enough to show changes

- **Chart Component**: Uses Recharts `AreaChart` which handles decimal Y-axis values
  ✅ Will display 0.05, 0.15, etc. correctly

## Testing

### Manual Test Steps:

1. **Start backend and frontend**

2. **Send a few messages in chat:**
   ```bash
   # Login as user A
   curl -X POST http://localhost:3000/api/login \
     -H "Content-Type: application/json" \
     -d '{"username":"userA","password":"pass"}'
   
   # Send a few messages
   curl -X POST http://localhost:3000/api/chat/send \
     -H "Content-Type: application/json" \
     -b cookies.txt \
     -d '{"recipientId":"userB","content":"Test message 1"}'
   ```

3. **Check `/api/admin/dashboard/timeseries` endpoint:**
   ```bash
   curl http://localhost:3000/api/admin/dashboard/timeseries \
     -H "Cookie: ..." \
     | jq '.data.points[] | {time, messages}'
   ```
   
   **Expected**: `messages` values should be decimals like `0.05`, `0.15`, `1.25`, etc. (not integers)

4. **Check `/api/admin/dashboard` endpoint:**
   ```bash
   curl http://localhost:3000/api/admin/dashboard \
     -H "Cookie: ..." \
     | jq '.data.messagesPerSecond'
   ```
   
   **Expected**: Should show decimal value if messages are being sent slowly

5. **Open Admin Dashboard page:**
   - Navigate to `/admin/dashboard`
   - Watch "System Performance" graph
   - Verify chart shows non-zero values even when message rate is low (e.g., 0.05 msg/sec)
   - Verify chart updates every 4 seconds (if backend buffer samples every 60s, chart updates slower but still shows decimals)

## Implementation Details

### Precision Matching

- `adminDashboardBuffer.getSeries()` already rounds to 2 decimals (line 118):
  ```javascript
  messagesPerSecondAvg: Math.round((...p.messagesPerSecondAvg...) * 100) / 100
  ```

- `getDashboardTimeseries()` now matches this precision:
  ```javascript
  const m = Number(p.messagesPerSecondAvg) || 0;
  const messages = Math.max(0, Math.round(m * 100) / 100);
  ```

### Why 2 Decimals?

- Messages per second can be fractional (e.g., 0.05 msg/sec = 3 messages per minute)
- 2 decimals provide sufficient precision without excessive noise
- Matches precision used elsewhere in the system (messages aggregator)

## Notes

- Backend buffer (`adminDashboardBuffer`) samples every 60 seconds by default
- Frontend polls every 4 seconds, so chart updates when new buffer samples arrive
- Chart will show smooth transitions between samples
- Small values (< 0.01) will still round to 0.00, which is acceptable (too small to be meaningful)
