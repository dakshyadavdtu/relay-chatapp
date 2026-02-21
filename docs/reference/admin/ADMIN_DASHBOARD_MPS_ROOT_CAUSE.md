# Admin Dashboard "Messages per second" + graph staying 0 — root cause

## Summary

- **Graph and "Messages per second"** use **`messages_delivered_total`** (delta per second) from `adminDashboardBuffer`.
- **`messages_delivered_total`** increments only when a delivery is marked **DELIVERED** (recipient ACK), which can be **late or never** (e.g. recipient offline, or single-user test).
- **`messages_persisted_total`** (and **messagesLastMinute**) increment **immediately** when a message is persisted (DM send path).
- So the graph uses the **late/never** counter; the **immediate** counter is the persisted path. That is why sending 1 DM can leave the graph at 0.

---

## 1. adminDashboardBuffer.js — which counter?

**Counter used: `messages_delivered_total`** (not `messages_persisted_total`).

- `sample()` runs every 1s and reads `counters.messages_delivered_total`.
- It computes `delta = currentTotal - previousTotalMessagesDelivered` and `messagesPerSecondAvg = delta / elapsedSeconds`.
- The buffer stores `messagesPerSecondAvg`; `getCurrentMps()`, `getMpsAvg60()`, and `getSeries()` all use this buffer.

So the dashboard **graph and MPS** are driven by **delivered** count, not persisted.

---

## 2. admin.controller.js — what the frontend gets

- **getDashboard()** returns:
  - `messagesPerSecond` = `adminDashboardBuffer.getCurrentMps()` → from **delivered** delta.
  - `messagesPerSecondAvg60` = `adminDashboardBuffer.getMpsAvg60()` → same buffer.
  - `messagesLastMinute` = `observability.getSnapshot().events.messagesLastMinute` → from **messages aggregator** (persisted timestamps).
  - Fallback: if `messagesPerSecondAvg60 === 0` and `messagesLastMinute > 0`, it uses `messagesLastMinute / 60` for the avg (so the number can look non-zero even when the graph is flat).

- **getDashboardTimeseries()** / **getDashboardSeries()** return points from `adminDashboardBuffer.getSeries()` → each point’s `messagesPerSecondAvg` is the **delivered** rate for that second.

So the **graph curve** is 100% from the **delivered** counter.

---

## 3. aggregators/messages.js — messagesLastMinute

- **messagesLastMinute** = count of **persisted** message timestamps in the last 60s.
- It is fed only by `trackPersistedMessageTimestamp()`, which is called from **message.service.js** after `metrics.increment('messages_persisted_total')`.
- So **messagesLastMinute** is driven by **persisted** timestamps and **messages_persisted_total**, not by **messages_delivered_total**.

---

## 4. When each counter increments

| Counter                     | When it increments                    | Typical timing        |
|----------------------------|----------------------------------------|------------------------|
| **messages_persisted_total** | When a message is accepted and saved to DB (message.service) | **Immediately** on send |
| **messages_delivered_total** | When a delivery is set to state **DELIVERED** (delivery.service), i.e. recipient ACK | **Late or never** (e.g. when recipient ACKs) |

So for “send 1 DM from admin”:

- **messages_persisted_total** increments as soon as the DM is persisted.
- **messages_delivered_total** increments only when that delivery is marked DELIVERED (recipient client ACK). If you’re the only user or the recipient doesn’t ACK in that second, the **delivered** delta in the next sample can be 0 → graph stays flat.

---

## 5. Temporary debug logs (env-guard)

Debug logs are added and **guarded by `DEBUG_ADMIN_MPS=1`** so they don’t spam.

- **adminDashboardBuffer.sample()**: every 10 samples, logs `currentTotal`, `delta`, `messagesPerSecondAvg`, `sampleCount` for the **delivered** counter.
- **delivery.service.js**: one log per `messages_delivered_total` increment (`messageId`, `recipientId`).
- **message.service.js**: one log per `messages_persisted_total` increment (DM, room-per-recipient, room-canonical).

To capture logs when sending 1 DM:

```bash
cd backend
DEBUG_ADMIN_MPS=1 NODE_ENV=development node server.js
```

Then send exactly 1 DM from the admin panel and check:

- **Which counter increments immediately?**  
  → You should see **MessageService** `messages_persisted_total_increment` right after sending.
- **Which counter increments late/never?**  
  → **DeliveryService** `messages_delivered_total_increment` only when the recipient’s delivery becomes DELIVERED (ACK). For a single user or no ACK, this may not appear.
- **Confirm graph uses the late/never one:**  
  → `AdminDashboardBuffer` `mps_sample_debug` will show `currentTotal`/`delta` for **messages_delivered_total**. If `delta` stays 0, the graph stays 0.

---

## 6. Conclusion

- **Graph rate uses the “late/never” counter:** `messages_delivered_total` (increment on DELIVERED/ACK).
- **Immediate counter:** `messages_persisted_total` (and thus **messagesLastMinute**) updates on persist; it is not what drives the graph.
- So the dashboard “Messages per second” and graph can stay 0 after sending 1 DM because they reflect **delivered** rate, not **persisted** rate. To show activity on send, the dashboard would need to either use the persisted path for the graph or combine both (e.g. show delivered rate but allow a fallback from messagesLastMinute, similar to the existing avg fallback).
