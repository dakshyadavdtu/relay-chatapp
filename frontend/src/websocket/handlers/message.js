/**
 * WebSocket message handler. Routes message events to chat.state.
 * DM events (MESSAGE_RECEIVE, MESSAGE_ACK, DELIVERY_STATUS) are routed by payload; conversationId is computed by caller.
 * For MESSAGE_RECEIVE, when activeConversationId is passed and differs from the DM conversationId, unread is incremented and preview/activity updated.
 */
import {
  addMessage,
  replaceMessage,
  updateMessageStatus,
  messageExistsInConversation,
  incrementUnread,
  setLastMessagePreview,
  updateLastActivity,
} from "@/state/chat.state";
import { getChatState } from "@/state/chat.state";
import { WS_EVENTS } from "@/config/constants";
import {
  normalizeMESSAGE_RECEIVE,
  getConversationIdFromDMPayload,
  handleMESSAGE_RECEIVE as handleDMMessageReceive,
  handleMESSAGE_ACK as handleDMMessageAck,
  handleDELIVERY_STATUS as handleDMDeliveryStatus,
} from "@/transport/socket/messageHandler";
import { getAuthState } from "@/state/auth.state";

function messageBelongsToConversation(message, activeConversationId) {
  const cid = message.conversationId || message.conversation_id;
  if (!cid) return true;
  return cid === activeConversationId;
}

export function handleMessageAck(payload, activeConversationId) {
  if (!activeConversationId) return;
  const message = payload;
  if (!messageBelongsToConversation(message, activeConversationId)) return;
  const s = getChatState();
  const list = s.byConversation[activeConversationId] || [];
  const exists = list.some((m) => m.id === message.id || m.clientId === message.clientId);
  if (!exists) {
    addMessage(activeConversationId, message);
  }
}

export function handleMessageDelivered(payload, activeConversationId) {
  if (!activeConversationId) return;
  const message = payload;
  if (!messageBelongsToConversation(message, activeConversationId)) return;
  const s = getChatState();
  const list = s.byConversation[activeConversationId] || [];
  const exists = list.some((m) => (m.id ?? m.clientId) === (message.id ?? message.clientId));
  if (!exists) {
    addMessage(activeConversationId, message);
  }
}

export function handleMessageRead(payload, activeConversationId) {
  // Read receipts can be processed later - for now no-op
  (void payload, void activeConversationId);
}

export function handleIncomingMessage(payload, activeConversationId) {
  if (!activeConversationId) return;
  const message = payload;
  if (!messageBelongsToConversation(message, activeConversationId)) return;
  addMessage(activeConversationId, message);
}

export function routeMessageEvent(eventType, payload, conversationIdOrActive, options = {}) {
  const activeConversationId = options.activeConversationId ?? conversationIdOrActive;
  switch (eventType) {
    case WS_EVENTS.MESSAGE_SENT:
    case "MESSAGE_SENT":
      handleMessageAck(payload, conversationIdOrActive);
      break;
    case WS_EVENTS.MESSAGE_DELIVERED:
    case "MESSAGE_DELIVERED":
      handleMessageDelivered(payload, conversationIdOrActive);
      break;
    case WS_EVENTS.MESSAGE_READ:
    case "MESSAGE_READ":
      handleMessageRead(payload, conversationIdOrActive);
      break;
    case "MESSAGE_RECEIVE": {
      const meId = getAuthState().user?.id;
      const dmCid = payload?.senderId && payload?.recipientId ? getConversationIdFromDMPayload(payload, meId) : null;
      const conversationId = dmCid ?? conversationIdOrActive;
      if (!conversationId) break;
      const message = normalizeMESSAGE_RECEIVE(payload);
      if (!message) break;
      if (messageExistsInConversation(conversationId, message)) break;
      addMessage(conversationId, message);
      if (meId && payload.recipientId === meId && activeConversationId != null && conversationId !== activeConversationId) {
        incrementUnread(conversationId);
        setLastMessagePreview(conversationId, { content: message.content ?? "", timestamp: message.timestamp ?? message.createdAt, senderId: payload.senderId });
        updateLastActivity(conversationId);
      }
      break;
    }
    case "MESSAGE_ACK":
      if (activeConversationId) {
        const msg = payload?.message;
        if (msg) handleMessageAck(msg, activeConversationId);
      } else {
        const meId = getAuthState().user?.id;
        if (meId) handleDMMessageAck(payload, meId, { replaceMessage, addMessage });
      }
      break;
    case "DELIVERY_STATUS":
      const meId = getAuthState().user?.id;
      if (meId) handleDMDeliveryStatus(payload, meId, { updateMessageStatus });
      break;
    default:
      handleIncomingMessage(payload, activeConversationId);
  }
}
