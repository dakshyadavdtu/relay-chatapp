# Admin System Activity — Production Readiness Audit

This document analyzes the Admin Panel → Dashboard → System Activity feed end-to-end: emission, buffering, persistence, API, and frontend. No code changes are proposed; the goal is to identify root cause, architectural gaps, and decisions required before implementation.

---

## SECTION 1 — CURRENT FLOW

### 1.1 Event emission

Events are emitted by calling `adminActivityBuffer.recordEvent(ev)` from these locations only:

| Location | File:Line | Event type(s) | When |
|----------|-----------|---------------|------|
| WS message success | `backend/websocket/protocol/dispatcher.js:114–121` | `info` | Every time a message is **successfully** processed (`policy === 'ALLOW'`). Payload: `title: 'Message processed'`, `detail: userId \|\| 'unknown'`. No `userId`/`sessionId` passed on the event object. |
| WS message failure | `backend/websocket/protocol/dispatcher.js:96–104` | `failure` | When `policy === 'FAIL'`. Payload: `title: 'Message delivery failure'`, `detail: userId \|\| 'unknown'`. No `correlationId`, `roomId`, or message type. |
| WS connect | `backend/websocket/connection/connectionManager.js:184–192` | `connect` | After register (user connected). Payload: `title: 'User connected'`, `detail: userId + sessionId`. Includes `userId`, `sessionId`. No `connectionId`, close code, or duration. |
| WS disconnect | `backend/websocket/connection/connectionManager.js:238–246` and `281–289` | `disconnect` | On socket close (natural) or cleanup (forced). Payload: `title: 'User disconnected'`, `detail: userId + sessionId`. No `connectionId`, close code, reason, or duration. |
| Report created | `backend/http/controllers/reports.controller.js:168–175` | `report` | After `reportsStore.createReport()`. Payload: `title: 'New report created'`, `detail: 'Report &lt;id&gt;'`. No reporter/target userId, reason, or type (user vs message). |
| Suspicious flags | `backend/suspicious/suspicious.detector.js:136, 163, 222` | `flag` | On MESSAGE_BURST, RECONNECT_BURST, or `recordFlag()` (e.g. WS_RATE_LIMIT, WS_CLOSED_ABUSIVE). Detail: `userId` and reason. Cooldown per user+reason to avoid spam. |

There are **no** `recordEvent` calls for: ban user, unban, warn user, revoke session(s), resolve report, auth failures, persistence failures, retries, dead-letter, rebalance, emergency stop, or any infra events (no such emitters exist in the codebase for rebalance/kill-switch).

### 1.2 Buffering (`adminActivityBuffer.js`)

- **In-memory:** A single ring buffer (array), max 50 events, 1-hour time window. Every `recordEvent()` pushes to the buffer, then trims by time and length. No sampling or filtering; every emitted event enters the buffer.
- **Dedupe for persistence only:** Before persisting to DB, the buffer uses `shouldSkipPersist(type, userId, sessionId)` with key `type:userId:sessionId` and a 5-second window. So:
  - For **“Message processed”** the dispatcher does **not** pass `userId` or `sessionId` on the event; they are `undefined`. The dedupe key is therefore `"info::"` for all message-processed events. **At most one “Message processed” is persisted every 5 seconds globally.**
  - Connect/disconnect/report/flag/failure events often include `userId` and sometimes `sessionId`, so they dedupe per user/session per 5s.
- **Persistence:** Non-blocking `adminEvent.insertEvent(payload)` with `{ type, title, detail, severity, userId, sessionId }`. No `correlationId`, `roomId`, `connectionId`, or structured meta.

### 1.3 Persistence (`adminEvent.mongo.js`)

- **Collection:** `admin_events`.
- **TTL:** 7 days (`expiresAt`, TTL index).
- **Indexes:** `createdAt: -1`, `type: 1`, `userId: 1`, `expiresAt: 1` (TTL).
- **insertEvent:** Stores `id`, `type`, `title`, `detail`, `severity`, `userId`, `sessionId`, `createdAt`, `expiresAt`. No optional `meta` or extra fields.
- **findEvents(opts):** `filter` by optional `type` and `since`; sort `createdAt: -1`; `limit` (1–500, default 100). Returns array of events; no merge with in-memory buffer.

### 1.4 API

- **GET /api/admin/dashboard/activity** (used by the dashboard): `admin.controller.getDashboardActivity`.
  - Tries **DB first:** `adminEventStore.findEvents({ limit, type, since })`. Default `limit` from query (frontend uses 25).
  - If `ok && Array.isArray(events)`: returns `items` mapped to `{ id, type, title, detail, createdAt }` and `fromDb: true`.
  - **Else (DB failure or missing):** fallback to in-memory `adminActivityBuffer.getEvents({ windowSeconds, maxEvents: limit })`; same shape with synthetic `id`; `fromDb: false`.
- **GET /api/admin/activity** (legacy): returns only in-memory buffer via `adminActivityBuffer.getEvents()`; no DB.

Dashboard activity feed **always** uses `/api/admin/dashboard/activity`, so it receives **DB-backed** data when MongoDB is healthy.

### 1.5 Frontend

- **Adapter:** `useAdminDashboardActivity.js` calls `fetchAdminDashboardActivity({ limit: 25, windowSeconds })` and maps `data.items` to `events` with `id`, `type`, `title`, `detail`, `ts` (from `createdAt`).
- **Page:** `DashboardPage.jsx` builds `activityItems` as:
  - `msg: ev.detail ? \`${ev.title}: ${ev.detail}\` : ev.title`
  - So each row is literally **“&lt;title&gt;: &lt;detail&gt;”** (e.g. “Message processed: userId: &lt;uuid&gt;”).
- **Display:** Single line of text (`item.msg`), small type badge, and “time ago”. No separation of title vs detail, no formatting of key=value, no icons by type beyond the existing TYPE_ICON/TYPE_COLOR map (report, ban, flag, spike, failure).

**End-to-end:** Emit → in-memory buffer (all events) → persist with 5s dedupe by `type:userId:sessionId` → MongoDB `admin_events` → GET dashboard/activity (DB first, limit 25) → frontend shows “title: detail”.

---

## SECTION 2 — ROOT CAUSE

**Why the feed is dominated by “Message processed: userId: &lt;uuid&gt;”:**

1. **Volume at source:** The dispatcher emits a **success** (“Message processed”) event on **every** successfully processed message (`dispatcher.js:109–121`). At any non-trivial chat load this is by far the highest-volume emitter.
2. **Dedupe only reduces DB writes, not variety:** Persist dedupe uses key `"info::"` for these events (no userId/sessionId on the event). So at most **one** “Message processed” is written to the DB every **5 seconds**. Over time the DB still accumulates a large number of these (e.g. 12/minute, 17k+ over 24h within TTL). Other event types (connect, disconnect, report, flag, failure) are orders of magnitude rarer.
3. **Query returns “last N by time”:** `findEvents` returns the **last `limit` (25) events** by `createdAt` descending. So the feed is the 25 most recent rows in `admin_events`. Whenever the last 2+ minutes of DB writes are mostly “Message processed” (one every 5s), the **last 25 rows are all or mostly “Message processed”**.
4. **No server-side filtering by type:** The API does not exclude `info` or “Message processed” from the dashboard activity. So the feed is a raw time-ordered slice of all stored events.
5. **Fallback worsens it:** When DB is unavailable, the response comes from the in-memory buffer (last 25 of up to 50 events). Under load that buffer is dominated by recent “Message processed” events, so the fallback feed is also dominated by the same text.

**Exact emitter for “Message processed”:**  
`backend/websocket/protocol/dispatcher.js` lines 114–121, inside the `if (result.policy === 'ALLOW' && result.response)` block.

---

## SECTION 3 — WHAT IS MISSING

Important system events that **should** be visible for operations but currently are **not** (or are under-represented):

- **WS lifecycle (enrichment):** Connect/disconnect are present but **detail is shallow**: no `connectionId`, close code, reason string, or duration. Auth rejection (invalid token, expired session) is not emitted at all.
- **Delivery/persistence failures:** Only router-level “Message delivery failure” exists; no events for persistence failures, retries, or dead-letter. No `correlationId` or `roomId` in the failure event.
- **Moderation actions:** Report **creation** is emitted; **resolve report**, **warn user**, **ban user**, **unban**, **revoke one session**, **revoke all sessions** do **not** call `recordEvent`. So the feed does not show who banned whom, who revoked which session, or report resolution.
- **Suspicious/flags:** Flag events exist (burst, rate limit, etc.) but detail is minimal (userId + reason). No count, window, or lastDetail in the event payload; optional meta is not stored.
- **Infra:** No code paths for “rebalance”, “emergency stop”, “partial outage”, or “kill-switch” that could emit admin activity. If such features are added later, there is no central place to emit them.
- **Auth/security:** Auth failures (invalid/expired token, rejected WS connect) are not written to the activity feed.
- **Richer success context:** If “message processed” were ever to be sampled, there is no `roomId`, `msgType`, or `latencyMs` on the event today.

---

## SECTION 4 — ARCHITECTURAL GAPS

1. **No separation of “metrics” vs “activity”:** Success “Message processed” is an operational metric (throughput) but is treated as an activity feed event. That conflates high-volume metrics with low-volume, human-readable actions and lifecycle events.
2. **Single channel for all event types:** One buffer and one collection for connect, disconnect, failure, report, flag, and per-message success. Volume is driven by the noisiest emitter; no server-side filtering or priority (e.g. “show only failures + moderation + lifecycle”).
3. **Persist dedupe is type+user+session only:** For “Message processed” this collapses to one write per 5s globally, but the in-memory buffer still receives every success. So under load the in-memory ring is mostly “Message processed”, and any fallback or future in-memory-only path stays noisy.
4. **Thin event schema:** Only `type`, `title`, `detail`, `severity`, `userId`, `sessionId` are stored. No `correlationId`, `roomId`, `connectionId`, `actorUserId`, `targetUserId`, `latencyMs`, `reason` code, or structured `meta`. Enrichment and filtering by these fields is impossible without schema change.
5. **Dashboard reads DB only (no merge):** When DB is used, the in-memory buffer is ignored. So very recent events that have not yet been persisted (or that were skipped by dedupe) can be missing from the feed until the next persist. When DB fails, only the buffer is used; there is no merge of “DB + buffer”.
6. **No severity or sampling policy:** All event types are treated the same for retention and display. There is no rule like “always persist failures and moderation; sample or drop success”.
7. **Moderation not wired to activity:** Ban, unban, warn, revoke session(s), and resolve report are implemented in the admin controller but do not call `adminActivityBuffer.recordEvent`. So the activity feed does not reflect moderation actions.
8. **Frontend treats all events the same:** Single line “title: detail”, no parsing of key=value, no richer layout for types that have more context (e.g. report with reporter/target, failure with correlationId).

---

## SECTION 5 — IMPLEMENTATION QUESTIONS

Before implementing improvements, the following technical decisions should be clarified:

### 5.1 Success (“Message processed”) events

- **Should success events be recorded at all?** Option: never record routine message success; keep activity for failures, lifecycle, moderation, and suspicious only.
- **If we keep them, should they be sampled?** E.g. at most 1 per 30s globally, or per userId, or per msgType? Who defines the sampling interval and key?
- **Should “message processed” appear only for certain message types?** E.g. only ADMIN_ACTION, MODERATION, REPORT, or only for admin/test traffic?

### 5.2 Database and retention

- **Should `admin_events` be capped per type or globally?** E.g. cap total docs, or cap “info” type, or run a periodic job to delete old “Message processed” while keeping failures/moderation longer?
- **Is 7-day TTL sufficient for compliance/audit?** Should moderation and failure events be retained longer than “info”?
- **Should we separate collections or streams?** E.g. “admin_activity” for human-facing feed vs “admin_metrics_events” for high-volume/sampled success, with different retention and limits?

### 5.3 Event schema and metadata

- **Should we add optional structured `meta` (or equivalent)?** E.g. `correlationId`, `roomId`, `connectionId`, `actorUserId`, `targetUserId`, `latencyMs`, `reason`, `closeCode`, while keeping `detail` as a human-readable string for backward compatibility.
- **Should the API contract expose `meta`?** And should the frontend render from `meta` when present (e.g. “Banned by &lt;actor&gt; → &lt;target&gt;”)?

### 5.4 Metrics vs activity

- **Should “activity” be explicitly defined as “actions and incidents,” not raw throughput?** So dashboard activity = connect/disconnect, auth failures, delivery/persistence failures, suspicious flags, reports, moderation (create/resolve/ban/warn/revoke), and optional infra events—with no or heavily sampled “message processed”?
- **Where should message throughput live?** Confirm it stays in dashboard stats/timeseries (messages/sec, latency) and not in the activity feed.

### 5.5 Severity and filtering

- **Should we classify severity (e.g. info / warning / error) and use it for retention or display?** E.g. always persist and show “warning”/“error”; thin or drop “info” after N days or cap count.
- **Should the dashboard activity API support filtering by type or severity?** E.g. `?type=report,failure,disconnect` or `?severity=warning,error` so the UI can show “only important” by default?

### 5.6 Persistence and reliability

- **Should we persist all event types or only certain ones?** E.g. persist failures, moderation, flags, connect/disconnect; do not persist (or sample very aggressively) “Message processed”.
- **Should in-memory buffer be “activity only” (no success)?** So that even the fallback feed when DB is down is not dominated by message processed.

### 5.7 Moderation and lifecycle

- **Which moderation actions must appear in the feed?** At least: report created (already), report resolved, user warned, user banned, user unbanned, session revoked (one or all). Who is actor vs target should be explicit in event payload and optionally in UI.
- **Should connect/disconnect include connectionId, close code, reason, duration?** And should auth rejection (e.g. invalid token) emit a distinct event type (e.g. `auth_failure`)?

### 5.8 Infra and extensibility

- **Should infra events (rebalance, emergency stop, partial outage) be centralized in one place?** If/when such features exist, should they all call `adminActivityBuffer.recordEvent` with a dedicated type (e.g. `admin` or `infra`)?
- **Do we need a formal event catalog?** E.g. a list of allowed `type` values and recommended `title`/`detail`/meta so new features emit consistently?

### 5.9 Frontend

- **Should the UI show title and detail as two lines (title primary, detail secondary) and optionally format key=value?** Without changing the API contract (e.g. keep `detail` as string).
- **Should we extend TYPE_ICON/TYPE_COLOR for new types (e.g. connect, disconnect, admin/infra)?** So new event types get consistent styling.

### 5.10 Backward compatibility and safety

- **Must GET /api/admin/dashboard/activity remain backward compatible?** Keep returning `items: [{ id, type, title, detail, createdAt }]` and optionally add `meta` without breaking existing consumers.
- **Confirm root admin protections are unchanged:** No changes to auth, requireAdmin, requireRootAdmin, or role checks as part of activity changes.

---

## Summary

- **Current flow:** Emit → in-memory ring (all events) → persist with 5s dedupe by type+userId+sessionId → MongoDB → GET dashboard/activity (DB first, limit 25) → frontend “title: detail”.
- **Root cause:** Dispatcher emits “Message processed” on every successful message; dedupe only limits DB to one such event per 5s; the last 25 rows in DB are therefore often all “Message processed”. Fallback buffer is similarly dominated.
- **Missing:** Enriched connect/disconnect (connectionId, code, reason, duration), auth failures, delivery/persistence/retry/dead-letter events, moderation actions (ban/warn/revoke/resolve), richer flag/report detail, and any infra events (none implemented yet).
- **Gaps:** No metrics vs activity separation, single high-volume channel, thin schema, moderation not wired to activity, no severity/sampling policy.
- **Before implementing:** Decide on success sampling/capping, DB caps and TTL, optional `meta`, definition of “activity” vs metrics, severity and filtering, what to persist, which moderation events to emit, connect/disconnect and auth-rejection shape, infra centralization, and frontend presentation—all as above.
