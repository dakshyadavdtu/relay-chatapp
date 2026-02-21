# Messages-per-second and dashboard metrics: calculation flow

## Sampling interval (confirmed)

- **Interval:** 1 second.
- **Constant:** `SAMPLE_INTERVAL_MS = 1000` in `observability/adminDashboardBuffer.js`.
- The backend timer runs every 1s; the frontend does **not** run any timer for rates and must **not** compute rates.

## Metric calculation flow

1. **Monotonic counter**
   - `totalMessagesProcessed` is the value of `metrics.messages_persisted_total` (see `observability/metrics.js`).
   - It is incremented only when a message is accepted and persisted (e.g. in `message.service.js` via `metrics.increment('messages_persisted_total')`).

2. **Every 1 second (backend only)**
   - `adminDashboardBuffer.sample()` runs on a `setInterval(..., SAMPLE_INTERVAL_MS)`.
   - Read current total: `currentTotal = metrics.getMetrics().messages_persisted_total`.
   - Delta: `delta = max(0, currentTotal - previousTotalMessagesProcessed)`.
   - Update: `previousTotalMessagesProcessed = currentTotal`.
   - Rate: `messagesPerSecond = delta / SAMPLE_INTERVAL_SECONDS` (i.e. `delta / 1`).

3. **Ring buffer**
   - Each sample is stored as `{ ts, messagesPerSecondAvg, connectionsAvg, latencyAvg, suspiciousFlags }`.
   - Last **60** samples are kept (`MAX_POINTS = 60`). Older entries are dropped (ring buffer).

4. **Values exposed to admin**
   - **Current MPS:** `getCurrentMps()` = last sample’s `messagesPerSecondAvg`.
   - **Avg over last 60 samples:** `getMpsAvg60()` = mean of the last 60 `messagesPerSecondAvg` values.
   - **Peak:** `getExtendedStats().messagesPerSecondPeak` = max of those 60 values.
   - **P95 MPS:** `getExtendedStats().messagesPerSecondP95` = 95th percentile of those 60 values.
   - **P95 latency:** From snapshot `latency.p95Latency` or `getExtendedStats().latencyAvgP95` (p95 of per-sample latency averages in the buffer).

5. **Admin dashboard endpoint**
   - `GET /api/admin/dashboard` returns (from backend only, no client-side rate math):
     - `messagesPerSecond` — current mps
     - `messagesPerSecondAvg60` — avg over last 60 samples
     - `messagesPerSecondPeak`, `messagesPerSecondP95`
     - `latencyAvg`, `latencyP95`
     - Plus: `onlineUsers`, `messagesLastMinute`, `suspiciousFlags`, `adminsCount`, `regularUsersCount`.

6. **Frontend**
   - Displays only what the API returns. It does **not** compute messages-per-second or any rate; the timer runs on the backend only.

## Admin performance graph (real-time)

- **Update frequency**
  - Backend: metrics sampled every **1s** (ring buffer of 60 points).
  - Frontend: **GET /api/admin/dashboard/timeseries** is polled every **2s** (`useAdminDashboardTimeseries` `POLL_INTERVAL_MS = 2000`). No WebSocket push; admin metrics are HTTP-only.
- **Timestamps**
  - Each timeseries point from the backend includes **`ts`** (number, Unix ms) and **`time`** (ISO string from that `ts`). The frontend graph plots using these backend timestamps only: x-axis label is derived from `time`/`ts`, and point order is the API order (oldest to newest). No client-side smoothing or averaging.

## Files

| Role | File |
|------|------|
| Counter | `observability/metrics.js` (`messages_persisted_total`) |
| Increment on persist | `services/message.service.js` |
| 1s sampler + ring buffer | `observability/adminDashboardBuffer.js` |
| Dashboard response | `http/controllers/admin.controller.js` (`getDashboard`) |
| Timeseries (points with ts, time) | `http/controllers/admin.controller.js` (`getDashboardTimeseries`) |
