# Admin Dashboard – System Performance Graph Fix Analysis

## Step 1: Frontend (confirmed)

### Endpoint polled for graph points
- **Hook:** `useAdminDashboardTimeseries({ windowSeconds: 86400, bucketSeconds: 3600 })`
- **API:** `fetchAdminDashboardTimeseries()` → **GET `/api/admin/dashboard/timeseries?windowSeconds=86400&bucketSeconds=3600`**
- **File:** `myfrontend/frontend/src/features/admin/api/admin.api.js` (lines 75–84), called from `useAdminDashboardTimeseries.js` (line 44).

### What is plotted (yAxisId="right") and tooltip
- **Chart:** `Area` with `dataKey="messages"`, `yAxisId="right"`, `name="Messages (msg/s)"`.
- **Chart data source:** `chartData[].messages` is set in `DashboardPage.jsx` (lines 78–104) from:
  - `p.messagesPerSecond` (if number) **else** `p.messages` (if number) **else** `Number(p.messages) || 0`.
- **Tooltip:** Recharts `Tooltip` with custom `formatter(value, name)` (lines 322–330). For `name === "Messages (msg/s)"` it returns `[Number(value).toFixed(2), name]` — so it displays whatever `value` Recharts passes for that series (the same value used to draw the line for that point).

### Axis/label requirements
- Right Y-axis: messages rate (msg/s), `tickFormatter={(value) => Number(value).toFixed(2)}`.
- Left Y-axis: connections count, `tickFormatter={(value) => Math.round(value).toString()}`.
- UI expects **rate (msg/s)** for the messages series, not cumulative count.

---

## Step 2: Backend (confirmed)

### Truth table

| Item | Detail |
|------|--------|
| **metrics.messages_persisted_total** | Incremented in `message.service.js` when a message is **persisted** (DM after `persistMessage`, room per-recipient, room canonical). Lines: 220, 260, 292. Represents “messages accepted and stored”. |
| **metrics.messages_delivered_total** | Incremented in `delivery.service.js` when delivery state transitions to **DELIVERED** (recipient got it). Line 166. Represents “messages delivered to recipient”. |
| **Which = “messages sent” in UI** | UI label “Messages (msg/s)” is ambiguous. In common wording, “messages sent” usually means “delivered to the client”. So **messages_delivered_total** matches “sent” semantics; **messages_persisted_total** is “persisted/accepted”. |
| **What adminDashboardBuffer computes** | **Delta (rate), not total.** `adminDashboardBuffer.js` `sample()` (lines 29–82): reads `currentTotal = metrics.getMetrics().messages_persisted_total`, computes `delta = currentTotal - previousTotalMessagesProcessed`, then `messagesPerSecondAvg = delta / SAMPLE_INTERVAL_SECONDS` (1s). So it stores **msg/s** per sample. `getSeries()` returns points with `messagesPerSecondAvg` (rate). |
| **Why tooltip shows 0** | The tooltip shows whatever Recharts passes as `value` for the “Messages (msg/s)” series; that value is the same as `chartData[].messages` for the hovered point. So **the exact variable that is 0 is `chartData[].messages`** (and thus the API’s `points[].messages` / `points[].messagesPerSecond`). That stays 0 because either: (1) **Backend sends 0:** `messagesPerSecondAvg` from the buffer is 0 (e.g. no traffic, or the counter used for the delta is never incremented in the path that runs in this env), or (2) **Frontend/Recharts quirk:** formatter is called with the wrong `value` (e.g. from the other series or wrong payload key). Most likely (1): backend is sending 0 for the messages rate. |

### Important detail: getSeries ignores request params
- `getDashboardTimeseries` calls `adminDashboardBuffer.getSeries({ windowSeconds, intervalSeconds: bucketSeconds })` (e.g. 86400, 3600).
- **`getSeries(opts)` in `adminDashboardBuffer.js` does not use `opts`.** It always uses `DEFAULT_WINDOW_SECONDS` (60) and `DEFAULT_INTERVAL_SECONDS` (1), and returns the raw 60-point ring (one point per second). So the API always returns **last 60 seconds at 1s resolution**, regardless of `windowSeconds`/`bucketSeconds`. The graph is therefore a 60s window, not 24h bucketed. This does not by itself make the line “cumulative,” but it can make the chart look wrong if the UI expects a longer window.

---

## Root cause (1–2 bullets)

1. **Graph shows “cumulative” instead of msg/s:** The buffer correctly computes **rate** (delta per second) from `messages_persisted_total`. If the line still looks cumulative, the only plausible cause is that **another code path or an older contract** is sending a total (or the frontend is misreading). In the current code, the controller maps `p.messagesPerSecondAvg` → `messages` and `messagesPerSecond` (rate). So the main fix is to ensure the **same** rate is used everywhere and that the **right counter** is used for “messages sent” (see below). If “messages sent” is intended to mean “delivered,” the buffer should use **messages_delivered_total** for the delta; using only **messages_persisted_total** can undercount or show 0 when there is no persistence in the observed path.

2. **Tooltip always 0:** The variable that is 0 is **`chartData[].messages`** (and thus API `points[].messages` / `points[].messagesPerSecond`). Most likely the **backend is sending 0** because `messagesPerSecondAvg` from the buffer is 0 (e.g. no traffic, or the metric driving the buffer is not the one that increments in this environment). A defensive frontend fix is to have the tooltip formatter use the **payload** explicitly (e.g. `payload.messages`) so the displayed value cannot be the wrong series.

---

## Exact files/lines to change

### Backend
- **`backend/observability/adminDashboardBuffer.js`**
  - **Lines 38–42** (in `sample()`): Currently uses `counters.messages_persisted_total` for delta. If “messages sent” = delivered, switch to `messages_delivered_total` (or add a separate series; minimal fix is to use the counter that matches UI semantics).
  - **Lines 135–164** (`getSeries`): Optionally use `opts.windowSeconds` / `opts.intervalSeconds` so the API can return bucketed data for the requested window (e.g. 24h with 1h buckets). This fixes “wrong window” and avoids confusion with “cumulative” if the UI ever summed buckets.

- **`backend/http/controllers/admin.controller.js`**
  - **Lines 266–284** (`getDashboardTimeseries`): Ensure the field sent for the messages rate is consistently named and that the value comes from the buffer’s rate (already does; no change needed unless you add a new counter/series).

### Frontend
- **`myfrontend/frontend/src/pages/admin/DashboardPage.jsx`**
  - **Lines 78–104** (`chartData` useMemo): Ensure `messages` is taken from `p.messagesPerSecond` or `p.messages` (already does). If the API adds a different key (e.g. `messagesPerSecondAvg`), prefer that for clarity.
  - **Lines 322–330** (Tooltip formatter): Use the **payload** explicitly for the messages value so the tooltip cannot show the wrong series’ value, e.g. `formatter={(value, name, item) => { const payload = item?.payload; ... use payload.messages for "Messages (msg/s)" ... }}`.

---

## Minimal safe fix plan (backend + frontend)

### Backend
1. **Semantics:** Decide whether “Messages (msg/s)” = persisted or delivered. If it should mean “messages sent (delivered),” change `adminDashboardBuffer.js` `sample()` to compute the delta from **`messages_delivered_total`** instead of (or in addition to) `messages_persisted_total`, and expose that rate in `getSeries` (e.g. keep or rename `messagesPerSecondAvg` so the controller can map it to `messages` / `messagesPerSecond`).
2. **Stability:** Do not change counter names or remove `messages_persisted_total`; other consumers (e.g. GET /metrics, aggregators) may depend on it.
3. **Optional:** In `getSeries`, use `opts.windowSeconds` and `opts.intervalSeconds` to aggregate the 1s buffer into fewer, larger buckets when the client requests a long window (e.g. 24h, 1h buckets), so the chart is not limited to 60s and does not look like “cumulative” if the UI ever interprets buckets as cumulative.

### Frontend
1. **Tooltip:** In `DashboardPage.jsx`, change the Tooltip formatter to derive the messages value from the **hovered point’s payload** (e.g. `payload.messages`) when `name === "Messages (msg/s)"`, and format that with `toFixed(2)`. This guarantees the tooltip shows the same number as the line and avoids 0 from a wrong `value` argument.
2. **Chart data:** Keep using `p.messagesPerSecond ?? p.messages` for `chartData[].messages`; if the backend adds an explicit rate key (e.g. `messagesPerSecond`), the current fallback already uses it. No breaking change needed.
3. **Other dashboard features:** Do not change `useAdminDashboardTimeseries`, `fetchAdminDashboardTimeseries`, or the stats/activity endpoints; only the graph data source and tooltip display.

---

## Summary

| Issue | Cause | Fix |
|-------|--------|-----|
| Graph shows cumulative instead of msg/s | Buffer uses rate but (1) wrong counter for “sent” (persisted vs delivered) and/or (2) getSeries ignores window/interval so only 60s is shown | Use `messages_delivered_total` for “sent” rate; optionally bucket getSeries by requested interval. |
| Tooltip “Messages (msg/s)” always 0 | Backend sends 0 for rate and/or Recharts passes wrong value to formatter | Backend: ensure buffer uses the counter that increments in this env. Frontend: formatter use `payload.messages` for “Messages (msg/s)”. |
