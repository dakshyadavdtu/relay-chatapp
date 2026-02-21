# Real-time message delivery

## Backend

- **DM delivery:** `websocket/handlers/sendMessage.js` builds a `MESSAGE_RECEIVE` payload and calls `wsMessageService.attemptDelivery(messageId, receivePayload, { correlationId })`.
- **Recipient sockets:** `websocket/services/message.service.js` uses **`connectionManager.getSockets(recipientId)`** (plural) so every tab and device for that user receives the message. Do not use `getSocket(userId)` for delivery.
- This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, PresenceTrace, WS_CONN_TRACE) are no longer available. Standard delivery behavior is unchanged.

## Frontend

- **Listener:** `ChatAdapterContext` subscribes to `wsClient` once when authenticated; the handler forwards to `mergeMessageReceiveRef.current(msg)` so the merge logic always runs with current refs.
- **MESSAGE_RECEIVE:** `mergeMessageReceiveRef` derives `chatId` via `directChatId(senderId, recipientId)` (same format as backend: `direct:<smaller>:<larger>`), appends the message to `messagesByConversation[chatId]`, and updates `lastMessagePreviews` and `unreadCounts` when the conversation is not active.
- **Reconnect:** On HELLO_ACK the client sends RESUME; on STATE_SYNC_RESPONSE with `hasMoreMessages` it sends MESSAGE_REPLAY. Replay messages are merged with `isReplay: true` so delivered confirm is not re-sent.

## Verification

1. Run backend (`npm run dev`); send a DM from UserA to UserB.
2. This instrumentation was removed. Debug mode flags are no longer available. Use normal logging and UI to verify.
3. UserB’s UI should show the new message immediately without refresh.
