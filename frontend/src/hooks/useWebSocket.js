/**
 * Legacy WebSocket hook. Chat route also uses src/transport/wsClient.js via ChatAdapterContext.
 * DM events (MESSAGE_RECEIVE, MESSAGE_ACK, DELIVERY_STATUS) are routed by payload; conversationId is computed from senderId/recipientId.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { useChatStore } from "@/hooks/useChat";
import { getConversationId } from "@/utils/conversation";
import { isTestMode } from "@/utils/testMode";
import {
  connect,
  disconnect,
  send,
  subscribe as subscribeWithTracking,
  unsubscribeAllForComponent,
  EVENTS,
  resetAuthFailure,
} from "@/websocket";
import { routeMessageEvent } from "@/websocket/handlers/message";
import { getConnectionState, subscribeConnection } from "@/websocket/state/connection.state";
import { toDirectIdFromUsers } from "@/features/chat/utils/chatId";

export function useWebSocket() {
  const [connectionStatus, setConnectionStatus] = useState(() => getConnectionState().status);
  const { user } = useAuth();
  const { toast } = useToast();
  const { activeGroupId, activeDmUser } = useChatStore();
  const componentRefIdRef = useRef(`useWebSocket_${Date.now()}_${Math.random()}`);
  const isSubscribedRef = useRef(false);
  const activeConversationIdRef = useRef(null);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    activeConversationIdRef.current = getConversationId(activeGroupId, activeDmUser);
  }, [activeGroupId, activeDmUser]);

  useEffect(() => {
    if (isSubscribedRef.current) return;
    isSubscribedRef.current = true;
    const unsubscribe = subscribeWithTracking(
      "*",
      ({ type, payload }) => {
        if (type === EVENTS.ERROR || type === "ERROR") {
          toast?.({ title: "Error", description: payload?.message, variant: "destructive" });
          return;
        }
        if (type === EVENTS.AUTH_ERROR || type === "AUTH_ERROR" || type === "auth_error") {
          toast?.({ title: "Session Expired", description: payload?.message || "Please log in again.", variant: "destructive" });
          return;
        }
        if (type === EVENTS.CONNECTION_STATUS || type === "CONNECTION_STATUS") return;

        const cid = activeConversationIdRef.current;
        const meId = userRef.current?.id;

        // Message events: route by payload for DM (conversationId from senderId/recipientId), or use activeConversationId when provided
        if (
          type === EVENTS.MESSAGE_SENT ||
          type === EVENTS.MESSAGE_DELIVERED ||
          type === EVENTS.MESSAGE_READ ||
          type === "MESSAGE_SENT" ||
          type === "MESSAGE_DELIVERED" ||
          type === "MESSAGE_READ"
        ) {
          if (cid) routeMessageEvent(type, payload, cid);
          return;
        }
        if (type === "MESSAGE_RECEIVE") {
          const dmCid = payload?.senderId && payload?.recipientId ? toDirectIdFromUsers(payload.senderId, payload.recipientId) : null;
          routeMessageEvent(type, payload, dmCid || cid, { activeConversationId: cid });
          return;
        }
        if (type === "MESSAGE_ACK") {
          const msg = payload?.message;
          const dmCid = msg?.senderId && msg?.recipientId ? toDirectIdFromUsers(msg.senderId, msg.recipientId) : null;
          routeMessageEvent(type, payload, dmCid || cid);
          return;
        }
        if (type === "DELIVERY_STATUS") {
          const dmCid = meId && payload?.recipientId ? toDirectIdFromUsers(meId, payload.recipientId) : null;
          routeMessageEvent(type, payload, dmCid || cid);
          return;
        }
      },
      componentRefIdRef.current
    );
    return () => {
      isSubscribedRef.current = false;
      unsubscribe();
    };
  }, [toast]);

  useEffect(() => {
    return subscribeConnection(() => setConnectionStatus(getConnectionState().status));
  }, []);

  useEffect(() => {
    if (user) {
      resetAuthFailure();
      connect();
    } else {
      disconnect();
    }
    return () => {
      if (!user) disconnect();
      unsubscribeAllForComponent(componentRefIdRef.current);
      isSubscribedRef.current = false;
    };
  }, [user]);

  const sendMessage = useCallback((content) => {
    if (isTestMode()) return;
    send(EVENTS.MESSAGE_SEND, { content }).catch(() => {
      toast?.({ title: "Could not send", description: "Connection unavailable", variant: "destructive" });
    });
  }, [toast]);

  const sendTyping = useCallback((isTyping) => {
    if (isTestMode()) return;
    const eventType = isTyping ? EVENTS.TYPING_START : EVENTS.TYPING_STOP;
    send(eventType, {}).catch(() => {});
  }, []);

  const isConnected = connectionStatus === "connected";

  return { sendMessage, sendTyping, isConnected };
}
