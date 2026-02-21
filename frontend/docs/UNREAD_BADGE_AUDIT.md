# Unread badge logic — single source of truth and write paths

**Requirement:** For the currently open conversation (DM or group), `unreadCount` must ALWAYS be 0 (on refresh, on navigation into chat, and when new messages arrive while chat is open).

**No code changes in this doc — audit only.**

---

## 1. Single source of truth for unread counts

There are **two** state layers; the **primary** one used by the main chat UI is in **ChatAdapterContext**:

| Layer | State keys | Where used |
|-------|------------|------------|
| **ChatAdapterContext** (primary) | `unreadCounts` (useState), `roomUnreadCounts` (useState) | Sidebar, ChatWindow, all chat UI. Keys: canonical `direct:<min>:<max>` or `room:<roomId>`. |
| **chat.state** (legacy / optional) | `unreadCounts` (module state) | Legacy useWebSocket path, useChat.js; `incrementUnread`, `clearUnread` exported. |

**Sidebar** reads unread from **ChatAdapterContext** (`unreadCounts`, `roomUnreadCounts`, plus `computeUnreadCount` for computed fallback). So the **single source of truth for the visible badge** is **ChatAdapterContext** `unreadCounts` and `roomUnreadCounts`.

---

## 2. Map of every write path

### A) When a message arrives via WS

| Event | File | What writes unread |
|-------|------|--------------------|
| **DM: MESSAGE_RECEIVE** | ChatAdapterContext.jsx | `mergeMessageReceiveRef`: `setUnreadCounts((prev) => ({ ...prev, [chatId]: (prev[chatId]\|\|0) + 1 }))` **only if** `!isActiveConversation && isRecipient && !isReplayMsg` (lines 557–563). |
| **DM: MESSAGE_RECEIVE** (legacy path) | websocket/handlers/message.js | `incrementUnread(conversationId)` when `conversationId !== activeConversationId` and user is recipient (writes to **chat.state**). |
| **DM: MESSAGE_RECEIVE** (legacy path) | transport/socket/messageHandler.js | `handleMESSAGE_RECEIVE`: can call `incrementUnread(conversationId)` when `isNotActiveConversation && isRecipient` (writes to **chat.state** if actions use it). |
| **Room: ROOM_MESSAGE** | ChatAdapterContext.jsx | Sets `roomUnreadPendingRef.current = roomConversationId` when `!isRoomActive && isFromOther` (line 1334). After `setMessagesByConversation`, an effect (lines 1380–1384) runs: `setRoomUnreadCounts((prev) => ({ ...prev, [cid]: (prev[cid]\|\|0) + 1 }))` for that pending room. |

### B) When messages are fetched via HTTP (on refresh)

| Flow | File | What writes unread |
|------|------|--------------------|
| **loadChats()** (GET /api/chats) | ChatAdapterContext.jsx | `setUnreadCounts((prev) => { const next = { ...prev }; list.forEach((c) => { if (c.chatId != null && typeof c.unreadCount === "number") next[normalizeConversationId(c.chatId)] = c.unreadCount; }); return next; })` (lines 1811–1819). **Overwrites** per-chat unread from API for every chat in the list — **including the currently open conversation** if backend returns unreadCount > 0 for it. |

So on refresh, **loadChats** can set the active conversation’s unread to a non-zero value if the API returns it.

### C) When user opens a conversation / selects chat

| Flow | File | What clears unread |
|------|------|--------------------|
| **setActiveConversationId(normalizedId)** (DM branch) | ChatAdapterContext.jsx | Inside the callback: for `direct:` → `setUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }))`; for `room:` → `setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }))` (lines 1625–1629, 1638–1644). Then `setActiveConversationIdState(normalizedId)` etc. |
| **setActiveConversationId(normalizedId)** (room branch) | ChatAdapterContext.jsx | Same: `setRoomUnreadCounts(..., [normalizedId]: 0)` then set state (lines 1583–1587, 1653–1655). |
| **clearUnread(chatId)** | ChatAdapterContext.jsx | `setUnreadCounts((prev) => { delete next[normalizedId]; return next; })`; for room also `setRoomUnreadCounts(..., [normalizedId]: 0)` (lines 1657–1666). |
| **Sidebar onClick** | Sidebar.jsx | Calls `setActiveConversationId(cid)` then `clearUnread(cid)` (e.g. lines 153–154, 163–164, 175–176). |

So opening a conversation clears unread in context. If **loadChats** runs after that (e.g. on refresh), it can still overwrite with API unread.

### D) When read receipts are sent/received

| Flow | File | What clears unread |
|------|------|--------------------|
| **markAsReadForConversation(conversationId)** | ChatAdapterContext.jsx | After debounce: for `direct:` → `setUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }))`; for `room:` → `setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }))` (lines 2479–2487). |
| **ChatWindow** | ChatWindow.jsx | useEffect that calls `markAsReadForConversation(conversationIdNormalized)` when latest message from other user changes (lines 240–264). |

No separate “on MESSAGE_READ received” clear in this audit; unread is cleared when we send read (markAsReadForConversation) or when we open the conversation.

---

## 3. State key for “active conversation”

- **Primary:** `activeConversationId` (useState in ChatAdapterContext) — canonical string: `direct:<min>:<max>` or `room:<roomId>`.
- **Derived / also set:** `activeGroupId`, `activeDmUser` (useState). `activeConversationId` is set in sync with these (e.g. setActiveGroupId clears activeDmUser and sets activeConversationId to `room:${id}`; setActiveDmUser sets activeConversationId to canonical direct id).
- **Ref used in WS handlers:** `activeConversationIdRef.current` (synced from `activeConversationId` in useEffect) — used in mergeMessageReceive and ROOM_MESSAGE to decide “is this the open conversation?” so we don’t increment unread.
- **No route param:** Active conversation is not in the URL; it’s state only.

**Where activeConversationId is set:**

- ChatAdapterContext: `setActiveConversationIdState(normalizedId)` from:
  - `setActiveGroupId(id)` → room, clear DM
  - `setActiveDmUser(userId)` → canonical direct id
  - `setActiveConversationId(chatId)` → normalizedId (direct or room), used by Sidebar/NewGroupPopup/GroupInfoPanel
  - ROOM_* WS handlers (e.g. join/create room) and resetAllState

---

## 4. Short list (for fix)

**Actions that INCREMENT unread:**

- **ChatAdapterContext:** `mergeMessageReceiveRef` (DM): `setUnreadCounts(..., +1)` when `!isActiveConversation && isRecipient && !isReplay`.
- **ChatAdapterContext:** ROOM_MESSAGE path: `roomUnreadPendingRef` then effect → `setRoomUnreadCounts(..., +1)` when `!isRoomActive && isFromOther`.
- **chat.state** (legacy): `incrementUnread(chatId)` — used by websocket/handlers/message.js and transport/socket/messageHandler.js when DM not active.

**Actions that CLEAR unread (set to 0 or delete):**

- **ChatAdapterContext:** `setActiveConversationId` callback: `setUnreadCounts(..., [normalizedId]: 0)` and/or `setRoomUnreadCounts(..., [normalizedId]: 0)` when opening a conversation.
- **ChatAdapterContext:** `clearUnread(chatId)`: delete from unreadCounts, set room to 0.
- **ChatAdapterContext:** `markAsReadForConversation`: after debounce, `setUnreadCounts(..., [normalizedId]: 0)` and `setRoomUnreadCounts(..., [normalizedId]: 0)`.
- **chat.state:** `clearUnread(chatId)` (delete key).

**Where activeConversationId is set:**

- ChatAdapterContext: `setActiveConversationIdState` (and ref `activeConversationIdRef.current`) — from `setActiveGroupId`, `setActiveDmUser`, `setActiveConversationId`, ROOM_* handlers, `resetAllState`.

**Critical for “open conversation always 0”:**

- **loadChats** (HTTP) overwrites `unreadCounts` from API without excluding the current `activeConversationId`; so after refresh or when loadChats runs, the active conversation can get a non-zero unread if the API returns it.
- **WS paths** already gate on “not active” for increment; the main risk is **loadChats** overwriting the active conversation’s unread.
