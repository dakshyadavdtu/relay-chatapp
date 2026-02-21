# Admin Dashboard Metrics — Verification Checklist

Use this doc to verify dashboard metrics and to avoid regressions (e.g. TEMP logs, missing fields, wrong formatting).

---

## 1. Fetching data via curl (cookie auth)

Use the same cookie your browser sends after login. The backend typically uses a `token` (or session) cookie.

```bash
# Replace BASE_URL and COOKIE with your values (copy cookie from DevTools → Application → Cookies).
BASE_URL="http://localhost:3000"
COOKIE="token=YOUR_JWT_OR_SESSION_VALUE"

# Dashboard (cards)
curl -s -b "$COOKIE" "$BASE_URL/api/admin/dashboard" | jq .

# Timeseries (chart)
curl -s -b "$COOKIE" "$BASE_URL/api/admin/dashboard/timeseries?windowSeconds=86400&bucketSeconds=3600" | jq .
```

If your app uses a different cookie name (e.g. `connect.sid`), substitute it in `COOKIE`.

---

## 2. Expected fields on `/api/admin/dashboard`

Response shape (from backend) must include:

| Field | Type | Notes |
|-------|------|--------|
| `messagesPerSecond` | number (decimal) | Rate (msg/s); can be fractional e.g. `0.05`. |
| `messagesLastMinute` | number (integer) | Count of messages in the last 60 seconds. |
| `onlineUsers` | number | |
| `latencyAvg` | number | |
| `suspiciousFlags` | number | |
| `adminsCount`, `regularUsersCount` | number | |

- **messagesPerSecond**: Must be a decimal when rate is small; UI must show 2 decimals (e.g. `0.05`, not `0`).
- **messagesLastMinute**: Integer; used for the “Last 60s: X msgs” line.

---

## 3. Expected fields on timeseries

`GET /api/admin/dashboard/timeseries` returns:

- `windowSeconds`, `bucketSeconds`
- `points`: array of:
  - `time` (ISO string)
  - `messages` (number, rate in msg/s — same as `messagesPerSecond` per point)
  - `messagesPerSecond` (number, same as `messages`; explicit name for rate)
  - `connections` (number)

So each point has **points[].messages** and **points[].connections** (and optionally **points[].messagesPerSecond**). Values in `messages` are rates (decimals), not counts.

---

## 4. Visual verification (UI)

- **Messages Per Second card**
  - Main value shows **2 decimals** (e.g. `0.05` avg), never a misleading `0` for small rates.
  - **“Last 60s: X msgs”** line is visible and updates as you send messages (within the same 60s window).

- **System Performance chart**
  - **Messages curve** is visible (dual Y-axis: left = connections, right = messages rate).
  - Chart/tooltip label indicates **msg/s** (e.g. “Messages (msg/s)”).
  - Tooltip shows messages value with 2 decimals.

- **No TEMP logs**
  - Open DevTools → Console; load Admin Dashboard and timeseries. There must be **no** `[TEMP useAdminDashboard]` or `[TEMP useAdminDashboardTimeseries]` logs.

---

## 5. Common false negatives

- **“Last 60s” goes back to 0**  
  If you send 1 message then wait **more than 60 seconds**, the last-minute window no longer contains that message, so “Last 60s: 0 msgs” is **correct**.

- **Very small MPS**  
  Low traffic yields small rates (e.g. 0.01–0.05 msg/s). Formatting must show them as **0.01** / **0.05**, not **0**. If you see `0` while messages were sent in the last 60s, that’s a formatting bug.

- **Empty timeseries**  
  Right after startup, the buffer may have no or few points; the chart can be empty or flat until samples accumulate. That’s expected, not a regression.

---

## 6. Regression guard

Before release or after touching dashboard adapters / backend dashboard endpoints:

1. Remove any **TEMP** or ad-hoc **console.log** in:
   - `src/features/admin/adapters/useAdminDashboard.js`
   - `src/features/admin/adapters/useAdminDashboardTimeseries.js`
2. Re-run the curl checks above and confirm `messagesPerSecond`, `messagesLastMinute`, and timeseries `points[].messages` / `points[].connections`.
3. Do the visual checks in §4 and confirm no false positives from §5.
