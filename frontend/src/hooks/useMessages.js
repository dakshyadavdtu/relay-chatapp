/**
 * FIX B NOTE
 * This file currently contains mock fallbacks.
 * These fallbacks will be removed in Fix B.
 * UI structure must remain unchanged.
 */

import { useState, useEffect } from "react";
import { getChatState, subscribeChat } from "@/state/chat.state";
import { getConversationId } from "@/utils/conversation";

export { getConversationId };

/**
 * Returns messages for a conversation. Uses chat state only; no mock fallback.
 */
export function useMessages(conversationId) {
  const [messages, setMessagesLocal] = useState(() => {
    const s = getChatState();
    return s.byConversation[conversationId] || [];
  });

  useEffect(() => {
    return subscribeChat(() => {
      const s = getChatState();
      setMessagesLocal(s.byConversation[conversationId] || []);
    });
  }, [conversationId]);

  return messages;
}
