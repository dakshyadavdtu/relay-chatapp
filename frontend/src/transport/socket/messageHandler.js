/**
 * DM WebSocket message handler. Routes MESSAGE_RECEIVE, MESSAGE_ACK, DELIVERY_STATUS
 * by payload only (conversationId from senderId/recipientId + currentUserId). Do not rely on activeConversationId.
 */

import { toDirectIdFromUsers } from "@/features/chat/utils/chatId.js";
import {
  addMessage as addMessageToState,
  replaceMessage as replaceMessageInState,
  updateMessageStatus as updateMessageStatusInState,
  messageExistsInConversation,
  incrementUnread as incrementUnreadInState,
  setLastMessagePreview as setLastMessagePreviewInState,
  updateLastActivity as updateLastActivityInState,
} from "@/state/chat.state";

/**
 * Compute canonical DM conversationId from payload and current user.
 * If payload.senderId === me => conversation with recipientId; else conversation with senderId.
 * Returns direct:<min>:<max>.
 */
export function getConversationIdFromDMPayload(payload, currentUserId) {
  if (!payload || !currentUserId) return null;
  const senderId = payload.senderId ?? payload.message?.senderId;
  const recipientId = payload.recipientId ?? payload.message?.recipientId;
  if (!senderId || !recipientId) return null;
  return toDirectIdFromUsers(senderId, recipientId);
}

/**
 * Normalize MESSAGE_RECEIVE payload to UI message shape.
 */
export function normalizeMESSAGE_RECEIVE(payload) {
  if (!payload) return null;
  const timestamp = payload.timestamp ?? payload.createdAt ?? Date.now();
  return {
    id: payload.messageId,
    messageId: payload.messageId,
    clientMessageId: payload.clientMessageId,
    senderId: payload.senderId,
    recipientId: payload.recipientId,
    content: payload.content,
    createdAt: timestamp,
    timestamp,
    state: payload.state ?? "sent",
  };
}

/**
 * Handle MESSAGE_RECEIVE: compute conversationId from payload, normalize message, dispatch addMessage.
 * Does not rely on activeConversationId for routing. When DM is not active, increments unread and updates preview/activity.
 */
export function handleMESSAGE_RECEIVE(payload, currentUserId, actions = {}) {
  const conversationId = getConversationIdFromDMPayload(payload, currentUserId);
  if (!conversationId) return;
  const message = normalizeMESSAGE_RECEIVE(payload);
  if (!message) return;

  const addMessage = actions.addMessage ?? addMessageToState;
  if (messageExistsInConversation(conversationId, message)) return;

  addMessage(conversationId, message);

  const getActiveConversationId = actions.getActiveConversationId;
  const activeConversationId = typeof getActiveConversationId === "function" ? getActiveConversationId() : undefined;
  const isRecipient = payload.recipientId === currentUserId;
  const isNotActiveConversation = activeConversationId != null && conversationId !== activeConversationId;

  if (isRecipient && isNotActiveConversation) {
    const inc = actions.incrementUnread ?? incrementUnreadInState;
    const setPreview = actions.setLastMessagePreview ?? setLastMessagePreviewInState;
    const updateActivity = actions.updateLastActivity ?? updateLastActivityInState;
    inc(conversationId);
    setPreview(conversationId, { content: message.content ?? "", timestamp: message.timestamp ?? message.createdAt, senderId: payload.senderId });
    updateActivity(conversationId);
  }
}

/**
 * Handle MESSAGE_ACK (sender-side): update optimistic message by clientMessageId or ensure ack message in conversation.
 */
export function handleMESSAGE_ACK(payload, currentUserId, actions = {}) {
  const conversationId = payload.message
    ? getConversationIdFromDMPayload({ senderId: payload.message.senderId, recipientId: payload.message.recipientId }, currentUserId)
    : null;
  if (!conversationId) return;

  const replaceMessage = actions.replaceMessage ?? replaceMessageInState;
  const addMessage = actions.addMessage ?? addMessageToState;

  const clientId = payload.clientMessageId ?? payload.clientMsgId;
  const message = payload.message;

  if (clientId && message) {
    replaceMessage(conversationId, clientId, {
      ...message,
      id: payload.messageId ?? message.id,
      messageId: payload.messageId ?? message.id,
      status: message.state ?? "sent",
    });
    return;
  }
  if (clientId && !message) {
    replaceMessage(conversationId, clientId, { id: payload.messageId, messageId: payload.messageId, status: "sent" });
    return;
  }
  if (message) {
    const normalized = normalizeMESSAGE_RECEIVE({ ...message, messageId: payload.messageId ?? message.id });
    addMessage(conversationId, normalized);
  }
}

/**
 * Handle DELIVERY_STATUS: update message state/ticks by messageId for sender's view.
 */
export function handleDELIVERY_STATUS(payload, _currentUserId, actions = {}) {
  if (payload.messageId == null) return;
  const updateMessageStatus = actions.updateMessageStatus ?? updateMessageStatusInState;
  const status = payload.status === "DELIVERED" ? "delivered" : payload.status === "SEEN" ? "read" : payload.status?.toLowerCase?.() ?? payload.status;
  updateMessageStatus(payload.messageId, status);
}
