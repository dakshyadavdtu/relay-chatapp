# Dashboard timeseries semantics (GET /api/admin/dashboard/timeseries)

## Conclusion

**`points[].messages` means rate (messages per second), not message count.**

- Each point is one sample from the admin dashboard buffer (one sample per `intervalSeconds`, typically 60s).
- The value is the **messages-per-second** rate at that bucket time (from the messages aggregator: count of persisted messages in the last 60s divided by 60).
- Decimals are expected (e.g. 0.05 msg/s). The UI should label the series as "msg/s" to avoid confusion with message counts.
- For backward compatibility the API also exposes `points[].messagesPerSecond` with the same value; clients may use either.

## Trace

1. `adminDashboardBuffer.sample()` runs every **1s** and computes MPS from delta of `metrics.messages_persisted_total` → stores `messagesPerSecondAvg` (rate). See `docs/METRICS_MPS_CALCULATION_FLOW.md`.
2. `getDashboardTimeseries()` calls `adminDashboardBuffer.getSeries()` and maps each point to `{ time, messages, messagesPerSecond, connections }` where both `messages` and `messagesPerSecond` are that rate, rounded to 2 decimals.
