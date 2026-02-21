# Admin Message Inspection API — Plan

## Goal

Add **GET /api/admin/messages** with query params `conversationId`, `senderId`, `limit`, `before`. Admin-only (requireAuth + requireAdmin). Cursor-based pagination consistent with existing chat history.

---

## 1. Location Summary

| Item | Location |
|------|----------|
| Admin HTTP router | `backend/http/routes/admin.routes.js` |
| Message read layer | `backend/services/message.store.js` |
| History (paginated) | `backend/services/history.service.js` |
| chatId format | `backend/utils/chatId.js`: DM = `direct:u1:u2`, Room = `room:<roomId>` |
| Canonical API message shape | `backend/utils/apiShape.js` → `toApiMessage(msg)` |
| Admin validation helpers | `backend/utils/adminValidation.js` |

---

## 2. conversationId / chatId Representation

- **DM:** `direct:<u1>:<u2>` with user IDs sorted (from `toDirectChatId`, `parseRoomChatId` in `chatId.js`).
- **Room:** `room:<roomId>` (from `toRoomChatId`, `toRoomId` in `chatId.js`).
- Confirmed in `history.service.js`: `chatId` is "direct:u1:u2 for DM, or room:<roomId> for room"; room resolution uses `toRoomId(chatId)`.

---

## 3. Implementation Approach

**Preferred:** Use **`messageStore.getAllHistory(conversationId)`**.

- It already accepts `direct:u1:u2` and `room:roomId` and returns messages for both (see `message.store.js` and `storage/message.mongo.js`: `find({ chatId })` with room dedup).
- It returns **all** messages for that chat (no server-side pagination). Admin handler will:
  1. Call `getAllHistory(conversationId)`.
  2. Optionally filter by `senderId` if provided.
  3. Sort descending by `(timestamp, id)` (newest first).
  4. Apply cursor pagination: `before` = exclusive cursor (message id); `limit` = page size.
  5. Map each item with `toApiMessage(msg)` from `utils/apiShape.js`.

**Fallback (if needed later):** If `getAllHistory` is too broad/slow for very large conversations, use the same pattern as `history.service.getHistory`: for DM use `getMessagesForRecipient` + filter by other participant; for room use `getMessagesByRoom(toRoomId(chatId))`, then filter by chatId/senderId, sort, and paginate in memory. For the initial implementation, `getAllHistory` is sufficient.

---

## 4. Query Params and Validation Rules

| Param | Required | Validation | Notes |
|-------|----------|------------|--------|
| `conversationId` | **Yes** | Non-empty string; must match `direct:u1:u2` or `room:<id>` (e.g. `direct:` + 2 segments, or `room:` + 1 segment); max length 256; no control chars | Rejects invalid chatId format. |
| `senderId` | No | If present: non-empty string, max 128 chars, no control chars | Optional filter by sender. Use existing `validateOptionalId` or extend adminValidation. |
| `limit` | **Yes** | Integer in range [1, 100]; default not allowed — must be supplied | Clamp to 1–100 (align with `history.service.js` MAX_PAGE_SIZE). |
| `before` | No | If present: non-empty string, max 128 chars, no control chars | Cursor = message id (messageId or roomMessageId). |

**Validation failures:** 400 with clear message and code (e.g. `INVALID_PAYLOAD`, `MISSING_LIMIT`).

---

## 5. Pagination Rules

- **Order:** Messages sorted **descending** by `(timestamp, id)` (newest first). `id` = `roomMessageId || messageId` for tie-break.
- **Cursor:** `before` is the **exclusive** upper bound (first page: omit `before`; next page: `before` = last message id from previous response).
- **Page size:** `limit` (required), clamped 1–100.
- **Response:**
  - `nextCursor`: id of the last message in the current page if there are more messages; otherwise `null`.
  - `hasMore`: boolean, true if there is at least one message after the current page.

---

## 6. Output Shape

- **Success (200):**
  - `success: true`
  - `data.conversationId`: echo of validated `conversationId`
  - `data.messages`: array of API message objects from **`toApiMessage(msg)`** (`utils/apiShape.js`): `id`, `messageId`, `roomMessageId`, `roomId`, `senderId`, `recipientId`, `content`, `createdAt`, `timestamp`, `state`, `messageType`, `editedAt`, `deleted`, `deletedAt`
  - `data.nextCursor`: string | null
  - `data.hasMore`: boolean

- **Empty conversation / no matches:** 200 with `messages: []`, `nextCursor: null`, `hasMore: false`.

---

## 7. Security Notes

- **Access control:** Route MUST use `requireAuth` then `requireAdmin`. No bypass; no “admin by query param” or similar.
- **No ownership check:** Admin is allowed to inspect any conversation; do not call `validateChatOwnership` for this endpoint (admin can view any `conversationId`).
- **No data leak for non-admins:** If `requireAdmin` fails, respond 403 and do not return any message content or metadata. Never return message list to non-admin users.
- **Input validation:** Strict validation of `conversationId` and optional params to avoid injection or abuse; bounded `limit` to avoid DoS.

---

## 7b. Guardrails (reduce accidental admin DoS)

- **limit:** Hard-bounded 1–100; required (no default). Enforced in `validateRequiredIntInRange(..., 1, 100)`.
- **conversationId:** Max length 256. Enforced in `validateConversationId` (MAX_CONVERSATION_ID_LEN).
- **before (cursor) / senderId:** Max length 128 each. Enforced in `validateOptionalCursor` and `validateOptionalSenderId` (MAX_CURSOR_LEN, MAX_USER_ID_LEN).
- **getAllHistory(chatId):** Storage layer (`message.mongo.js`) queries with `find({ chatId })` only; results are scoped to that chat. No cross-chat message return.

**TODO:** For very large chats, implement storage-level pagination later (e.g. limit/offset or cursor at DB level) to avoid loading full history into memory.

---

## 8. Files to Edit or Create

| Action | File |
|--------|------|
| **Create** | `backend/docs/ADMIN_MESSAGES_API_PLAN.md` (this file) |
| **Edit** | `backend/http/routes/admin.routes.js` — add `GET /messages`, `requireAdmin`, handler reference |
| **Edit** | `backend/http/controllers/admin.controller.js` — add `getAdminMessages` (or equivalent) that validates params, calls messageStore.getAllHistory, filters by senderId, sorts, paginates, maps with toApiMessage, returns JSON |
| **Edit** | `backend/utils/adminValidation.js` (optional) — add `validateConversationId(value)` and/or `validateLimitRequired(value, min, max)` if we want reusable helpers; otherwise validation can live in controller |

No changes to `message.store.js`, `history.service.js`, or `apiShape.js` for the minimal implementation (use existing APIs and `toApiMessage`).

---

## 9. Exact Validation and Pagination Rules (Implementation Reference)

**Validation:**

1. **conversationId (required)**  
   - Not undefined/null; after trim, length > 0; length ≤ 256.  
   - Format: either `direct:<id1>:<id2>` (exactly 3 segments, segments 1–2 non-empty) or `room:<id>` (exactly 2 segments, segment 1 non-empty).  
   - No control characters (e.g. `[\x00-\x1f\x7f]`).  
   - On failure: 400, e.g. `conversationId is required` / `Invalid conversationId format`.

2. **limit (required)**  
   - Must be present (supplied in query).  
   - Parsed as integer; must be in range [1, 100].  
   - On failure: 400, e.g. `limit is required` / `limit must be between 1 and 100`.

3. **senderId (optional)**  
   - If present: trim; non-empty; length ≤ 128; no control characters.  
   - On failure: 400.

4. **before (optional)**  
   - If present: trim; non-empty; length ≤ 128; no control characters.  
   - On failure: 400.

**Pagination:**

1. Fetch list: `messageStore.getAllHistory(conversationId)`.
2. If `senderId` provided, filter: `msg.senderId === senderId`.
3. Sort: `(a, b) => (b.timestamp - a.timestamp) || (id(b) - id(a))` desc, with `id(m) = m.roomMessageId || m.messageId`.
4. Cursor: find index of message where `id(m) === before`; start slice at `index + 1`. If `before` not provided, start at 0. If `before` not found, treat as start from 0 (or document as “undefined” — plan: treat as start from 0).
5. Slice: `list.slice(startIndex, startIndex + limit)`.
6. `hasMore`: `startIndex + limit < list.length`.
7. `nextCursor`: if `hasMore` and page length > 0, last element’s id (`roomMessageId || messageId`); else `null`.
8. Map each message with `toApiMessage(msg)` for response.

---

*Plan only. No code implementation in this document.*
