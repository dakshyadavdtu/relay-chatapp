import { useState, useEffect, useCallback } from "react";
import { getChatState, subscribeChat } from "@/state/chat.state";
import {
  setActiveGroupId as setActiveGroupIdAction,
  setActiveDmUser as setActiveDmUserAction,
  clearUnread as clearUnreadAction,
  setMessages as setMessagesAction,
  addMessage as addMessageAction,
  addGroup as addGroupAction,
  setLastMessagePreview as setLastMessagePreviewAction,
  updateLastActivity as updateLastActivityAction,
  resetAllState as resetAllStateAction,
  updateMessageContent as updateMessageContentAction,
  deleteMessageLocal as deleteMessageLocalAction,
} from "@/state/chat.state";

export function useChatStore() {
  const [state, setState] = useState(getChatState);

  useEffect(() => {
    return subscribeChat(() => setState(getChatState()));
  }, []);

  return {
    activeGroupId: state.activeGroupId,
    activeDmUser: state.activeDmUser,
    groups: state.groups || [],
    unreadCounts: state.unreadCounts || {},
    lastActivityTimestamps: state.lastActivityTimestamps || {},
    lastMessagePreviews: state.lastMessagePreviews || {},
    onlineUsers: new Set(),
    typingUsers: new Set(),
    dummyUserOnlineOverrides: {},

    setActiveGroupId: useCallback((id) => setActiveGroupIdAction(id), []),
    setActiveDmUser: useCallback((userId) => setActiveDmUserAction(userId), []),
    clearUnread: useCallback((chatId) => clearUnreadAction(chatId), []),
    setMessages: useCallback((conversationId, messages) => setMessagesAction(conversationId, messages), []),
    addMessage: useCallback((conversationId, message) => addMessageAction(conversationId, message), []),
    addGroup: useCallback((group) => addGroupAction(group), []),
    setLastMessagePreview: useCallback((chatId, content) => setLastMessagePreviewAction(chatId, content), []),
    updateLastActivity: useCallback((chatId) => updateLastActivityAction(chatId), []),
    resetAllState: useCallback(() => resetAllStateAction(), []),
    updateMessageContent: useCallback((conversationId, messageId, content) => updateMessageContentAction(conversationId, messageId, content), []),
    deleteMessageLocal: useCallback((conversationId, messageId) => deleteMessageLocalAction(conversationId, messageId), []),
  };
}
