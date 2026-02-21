/**
 * Chat state - conversations, messages, active chat.
 * Subscribable, no Redux/WebSocket. Real data only (no mock groups).
 */

let state = {
  activeGroupId: null,
  activeDmUser: null,
  groups: [],
  byConversation: {},
  unreadCounts: {},
  lastActivityTimestamps: {},
  lastMessagePreviews: {},
};

const listeners = new Set();

export function getChatState() {
  return { ...state, byConversation: { ...state.byConversation } };
}

export function setChatState(update) {
  if (typeof update === "function") {
    state = update(state);
  } else {
    state = { ...state, ...update };
  }
  listeners.forEach((fn) => fn());
}

export function subscribeChat(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setActiveGroupId(id) {
  setChatState({ activeGroupId: id, activeDmUser: null });
}

export function setActiveDmUser(userId) {
  setChatState({ activeDmUser: userId, activeGroupId: null });
}

export function clearUnread(chatId) {
  const next = { ...state.unreadCounts };
  delete next[chatId];
  setChatState({ unreadCounts: next });
}

/** Increment unread count for a conversation (e.g. MESSAGE_RECEIVE when that DM is not open). Guard: unread never negative. */
export function incrementUnread(chatId) {
  if (!chatId) return;
  const next = { ...state.unreadCounts };
  next[chatId] = Math.max(0, (next[chatId] || 0) + 1);
  setChatState({ unreadCounts: next });
}

export function setMessages(conversationId, messages) {
  const byConversation = { ...state.byConversation };
  byConversation[conversationId] = messages || [];
  setChatState({ byConversation });
}

/** True if a message with this id/messageId/clientId already exists in the conversation. */
export function messageExistsInConversation(conversationId, message) {
  if (!conversationId || !message) return false;
  const list = state.byConversation[conversationId] || [];
  const id = message.id ?? message.messageId;
  const clientId = message.clientMessageId ?? message.clientId;
  return list.some(
    (m) =>
      (id && (String(m.id) === String(id) || String(m.messageId) === String(id))) ||
      (clientId && (String(m.clientMessageId) === String(clientId) || String(m.clientId) === String(clientId)))
  );
}

export function addMessage(conversationId, message) {
  const byConversation = { ...state.byConversation };
  const list = byConversation[conversationId] || [];
  const exists = list.some(
    (m) =>
      (m.id != null && message.id != null && String(m.id) === String(message.id)) ||
      (m.messageId != null && message.messageId != null && String(m.messageId) === String(message.messageId)) ||
      (m.id ?? m.clientId) === (message.id ?? message.clientId)
  );
  if (!exists) {
    byConversation[conversationId] = [...list, message];
    setChatState({ byConversation });
  }
}

/**
 * Update message content by id (or clientId). Used for edit flow.
 */
export function updateMessageContent(conversationId, messageId, content) {
  const byConversation = { ...state.byConversation };
  const list = byConversation[conversationId] || [];
  const idx = list.findIndex((m) => String(m.id) === String(messageId) || String(m.clientId) === String(messageId));
  if (idx === -1) return;
  const next = [...list];
  next[idx] = { ...next[idx], content };
  byConversation[conversationId] = next;
  setChatState({ byConversation });
}

/**
 * Replace message by clientMessageId or messageId (e.g. optimistic → server ack).
 */
export function replaceMessage(conversationId, oldMessageId, newMessage) {
  const byConversation = { ...state.byConversation };
  const list = byConversation[conversationId] || [];
  const idx = list.findIndex(
    (m) =>
      String(m.id) === String(oldMessageId) ||
      String(m.messageId) === String(oldMessageId) ||
      String(m.clientMessageId) === String(oldMessageId) ||
      String(m.clientId) === String(oldMessageId)
  );
  if (idx === -1) return;
  const merged = { ...list[idx], ...newMessage, id: newMessage.id ?? newMessage.messageId ?? list[idx].id, messageId: newMessage.messageId ?? newMessage.id ?? list[idx].messageId };
  const next = list.map((m, i) => (i === idx ? merged : m));
  byConversation[conversationId] = next;
  setChatState({ byConversation });
}

/**
 * Update message state/ticks by messageId (DM or any conversation).
 */
export function updateMessageStatus(messageId, status) {
  if (messageId == null) return;
  const mid = String(messageId);
  const byConversation = { ...state.byConversation };
  let updated = false;
  for (const [cid, list] of Object.entries(byConversation)) {
    const idx = list.findIndex((m) => String(m.id) === mid || String(m.messageId) === mid);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = { ...next[idx], state: status, status };
      byConversation[cid] = next;
      updated = true;
      break;
    }
  }
  if (updated) setChatState({ byConversation });
}

/**
 * Remove message or mark deleted. Used for delete flow.
 */
export function deleteMessageLocal(conversationId, messageId) {
  const byConversation = { ...state.byConversation };
  const list = byConversation[conversationId] || [];
  const filtered = list.filter((m) => String(m.id) !== String(messageId) && String(m.clientId) !== String(messageId));
  if (filtered.length === list.length) return;
  byConversation[conversationId] = filtered;
  setChatState({ byConversation });
}

export function setLastMessagePreview(chatId, content) {
  const lastMessagePreviews = { ...state.lastMessagePreviews, [chatId]: content };
  setChatState({ lastMessagePreviews });
}

export function updateLastActivity(chatId) {
  const lastActivityTimestamps = { ...state.lastActivityTimestamps, [chatId]: Date.now() };
  setChatState({ lastActivityTimestamps });
}

/**
 * Add a new group locally. Used by group creation flow.
 */
export function addGroup(group) {
  const nextGroups = [...(state.groups || []), group];
  setChatState({ groups: nextGroups });
}

export function resetAllState() {
  state = {
    activeGroupId: null,
    activeDmUser: null,
    groups: [],
    byConversation: {},
    unreadCounts: {},
    lastActivityTimestamps: {},
    lastMessagePreviews: {},
  };
  listeners.forEach((fn) => fn());
}
