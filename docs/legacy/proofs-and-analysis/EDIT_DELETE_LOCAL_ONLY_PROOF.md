# Edit/Delete are local-only — call chain and missing pieces

## Current call chain

### Edit
- **ChatWindow.jsx** `handleSaveEdit` (line 400) → calls `editMessage(conversationIdNormalized, editingMessageId, editingContent.trim())`.
- **ChatAdapterContext.jsx** `editMessage` (lines 1976–1991): normalizes `conversationId` → `setMessagesByConversation(prev => ...)` only; maps over list and replaces `content` for the matching message by `messageId`. **No** `wsClient.*` or `apiFetch` calls.

### Delete
- **ChatWindow.jsx** `handleDeleteMessage` (line 416) → calls `deleteMessage(conversationIdNormalized, messageId)`; also used from context menu (line 424) as `deleteMessage(conversationIdNormalized, msg.id)`.
- **ChatAdapterContext.jsx** `deleteMessage` (lines 2014–2028): normalizes `conversationId` → `setMessagesByConversation(prev => ...)` only; maps over list and sets `{ ...m, deleted: true }` for the matching message. **No** `wsClient.*` or `apiFetch` calls.

---

## Frontend transport (wsClient.js)

- **Present:** `sendMessage`, `sendMessageDeliveredConfirm`, `sendMessageRead`, `sendMessageReplay`, `sendRoomMessage`, etc. (MESSAGE_SEND, ROOM_MESSAGE, etc.).
- **Absent:** No `sendMessageEdit` or `sendMessageDelete`; no outbound MESSAGE_EDIT or MESSAGE_DELETE.

---

## Backend WebSocket

- **backend/websocket/protocol/types.js:** No `MESSAGE_EDIT` or `MESSAGE_DELETE` in `MessageType` enum (only MESSAGE_SEND, MESSAGE_READ, ROOM_MESSAGE, ROOM_DELETE, etc.).
- **backend/websocket/protocol/wsSchemas.js:** No schema for MESSAGE_EDIT or MESSAGE_DELETE.
- **backend/websocket/router.js:** No `case MessageType.MESSAGE_EDIT` or `case MessageType.MESSAGE_DELETE`; router only switches on existing types (MESSAGE_SEND, MESSAGE_READ, ROOM_MESSAGE, ROOM_DELETE, etc.).
- **backend/websocket/handlers/:** No edit/delete **message** handler. Only delete-related handler is `handleRoomDelete` in `room.js` (ROOM_DELETE = delete room, not message).

---

## Missing pieces (to make edit/delete server-backed)

1. **Frontend transport:** Add `sendMessageEdit(messageId, content)` and `sendMessageDelete(messageId)` in `wsClient.js`, sending e.g. `MESSAGE_EDIT` / `MESSAGE_DELETE` payloads.
2. **Backend protocol:** Add `MESSAGE_EDIT` and `MESSAGE_DELETE` to `types.js`; add payload schemas in `wsSchemas.js`; add cases in `router.js` routing to new handlers.
3. **Backend handlers:** New handlers (e.g. `editMessage.js`, `deleteMessage.js` or in messageEngine) that validate, then call service/DB.
4. **DB / service mutation:** Backend message store (and any service layer) to update message content (edit) or mark/remove message (delete); no such API used by WS today for individual messages.
5. **Inbound handling (frontend):** Handle server-sent MESSAGE_EDIT / MESSAGE_DELETE (or equivalent sync events) in ChatAdapterContext to update or remove messages in `messagesByConversation` so other clients and reloads see the change.

No code changes were made; this document is proof only.
