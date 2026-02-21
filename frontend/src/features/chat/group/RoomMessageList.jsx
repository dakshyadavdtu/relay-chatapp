/**
 * Group-only message list. Fetches history via getRoomHistory and renders messages.
 * Use when a room is active to show messages from GET /api/chat?chatId=room:<id>.
 * Does not depend on ChatWindow; can be composed wherever the group panel is rendered.
 */
import { useEffect, useState, useCallback } from "react";
import { useChatStore } from "../adapters";
import { getRoomHistory } from "./history";
import { getDaySeparator, formatTimestamp, shouldGroupWithPrev, getStatusIconConfig } from "../domain/message";
import { resolveUserPrimary } from "../utils/userDisplay";
import { avatarSrc } from "../utils/avatarUrl";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, MessageCircle, AlertCircle, Check, CheckCheck } from "lucide-react";
import { cn } from "../utils/utils";

const DEFAULT_LIMIT = 50;

function normalizeMsg(m) {
  if (!m) return null;
  return {
    id: m.id ?? m.messageId ?? m.roomMessageId,
    messageId: m.messageId ?? m.id,
    roomMessageId: m.roomMessageId,
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt ?? m.timestamp,
    timestamp: m.timestamp ?? m.createdAt,
    status: m.status ?? m.state ?? "delivered",
  };
}

export function RoomMessageList({ roomIdRaw, onRefetch }) {
  const { user, usersById, messagesByConversation, loadMessages, roomDeliveryByRoomMessageId, applyRoomDeliverySummaries } = useChatStore();
  const conversationId = roomIdRaw ? `room:${roomIdRaw}` : null;

  const [localMessages, setLocalMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadHistory = useCallback(
    async (beforeId = null) => {
      if (!roomIdRaw) return;
      if (!beforeId) setLoading(true);
      setError(null);
      try {
        const { messages, nextCursor: cursor, hasMore: more } = await getRoomHistory(
          roomIdRaw,
          DEFAULT_LIMIT,
          beforeId
        );
        if (Array.isArray(messages) && messages.length > 0 && typeof applyRoomDeliverySummaries === 'function') {
          applyRoomDeliverySummaries(messages);
        }
        const normalized = (messages || []).map(normalizeMsg).filter(Boolean);
        if (!beforeId) {
          setLocalMessages(normalized);
        } else {
          setLocalMessages((prev) => {
            const byId = new Map(prev.map((m) => [String(m.id ?? m.messageId), m]));
            normalized.forEach((m) => byId.set(String(m.id ?? m.messageId), m));
            return Array.from(byId.values()).sort((a, b) => (a.createdAt ?? a.timestamp ?? 0) - (b.createdAt ?? b.timestamp ?? 0));
          });
        }
        setNextCursor(cursor);
        setHasMore(!!more);
        if (typeof onRefetch === "function") onRefetch();
      } catch (e) {
        setError(e?.message ?? "Failed to load messages");
        if (!beforeId) setLocalMessages([]);
      } finally {
        setLoading(false);
      }
    },
    [roomIdRaw, onRefetch, applyRoomDeliverySummaries]
  );

  useEffect(() => {
    if (!roomIdRaw) {
      setLocalMessages([]);
      setNextCursor(null);
      setHasMore(false);
      setError(null);
      return;
    }
    loadMessages(conversationId, { limit: DEFAULT_LIMIT }).catch(() => {});
    loadHistory();
  }, [roomIdRaw]);

  const contextMessages = conversationId ? (messagesByConversation[conversationId] || []) : [];
  const useContext = contextMessages.length > 0;
  const msgList = useContext ? contextMessages.map(normalizeMsg) : localMessages;

  if (!roomIdRaw) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <MessageCircle className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-sm">Select a group</p>
      </div>
    );
  }

  if (loading && msgList.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground" data-testid="room-messages-loading">
        <Loader2 className="w-10 h-10 animate-spin mb-4" />
        <p className="text-sm">Loading messages…</p>
      </div>
    );
  }

  if (error && msgList.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground p-4" data-testid="room-messages-error">
        <AlertCircle className="w-10 h-10 mb-4 text-destructive" />
        <p className="text-sm text-center mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={() => loadHistory()}>
          Retry
        </Button>
      </div>
    );
  }

  const getStatusIcon = (status, isMe) => {
    const config = getStatusIconConfig(status, isMe);
    if (!config) return null;
    switch (config.type) {
      case "spinner":
        return <Loader2 className={cn("w-3 h-3 animate-spin", config.className)} />;
      case "check":
        return <Check className={cn("w-3 h-3", config.className)} />;
      case "check-check":
        return <CheckCheck className={cn("w-3 h-3 text-blue-500", config.className)} />;
      case "alert-circle":
        return <AlertCircle className={cn("w-3 h-3 text-destructive", config.className)} />;
      default:
        return <Check className={cn("w-3 h-3", config.className)} />;
    }
  };

  return (
    <div className="msg-list flex flex-col flex-1 min-h-0">
      {hasMore && (
        <div className="flex justify-center py-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => loadHistory(nextCursor)}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load older"}
          </Button>
        </div>
      )}
      {msgList.length === 0 ? (
        <div className="flex flex-col flex-1 items-center justify-center text-muted-foreground">
          <MessageCircle className="w-16 h-16 mb-4 opacity-50" />
          <p className="text-sm">No messages yet</p>
        </div>
      ) : (
        msgList.map((msg, index) => {
          const isMe = msg.senderId === user?.id;
          const prevMsg = index > 0 ? msgList[index - 1] : undefined;
          const grouped = shouldGroupWithPrev(msg, prevMsg, 5 * 60 * 1000);
          const showAvatar = !isMe && !grouped;
          const msgDate = new Date(msg.createdAt ?? msg.timestamp ?? 0);
          const prevDate = prevMsg ? new Date(prevMsg.createdAt ?? prevMsg.timestamp ?? 0) : undefined;
          const daySeparator = !Number.isNaN(msgDate.getTime()) ? getDaySeparator(msgDate, prevMsg && !Number.isNaN(prevDate.getTime()) ? prevDate : undefined) : null;
          const senderUser = msg.senderId ? usersById?.[msg.senderId] : undefined;
          const roomMsgId = msg.roomMessageId ?? msg.id;
          const delivery = roomDeliveryByRoomMessageId?.[String(roomMsgId)];
          const displayStatus = isMe && delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount
            ? "delivered"
            : (msg.status ?? "sent");

          return (
            <div key={msg.id ?? index} className={cn("flex flex-col", grouped ? "mt-0.5" : "mt-3")}>
              {daySeparator && (
                <div className="flex justify-center my-6">
                  <span className="bg-background/80 backdrop-blur-sm px-4 py-1 rounded-full text-[11px] font-medium text-muted-foreground shadow-sm uppercase tracking-wider">
                    {daySeparator}
                  </span>
                </div>
              )}
              <div className={cn("flex w-full max-w-3xl", isMe ? "ml-auto justify-end" : "justify-start")}>
                {!isMe && (
                  <div className="w-8 mr-2 flex-shrink-0 flex flex-col justify-end">
                    {showAvatar ? (
                      <Avatar className="h-8 w-8">
                        {senderUser?.avatarUrl ? <AvatarImage src={avatarSrc(senderUser.avatarUrl, senderUser.updatedAt)} alt="" /> : null}
                        <AvatarFallback className={cn("text-[10px] border border-border text-white", senderUser?.avatarColor || "bg-secondary")}>
                          {senderUser ? (senderUser.avatarInitials ?? resolveUserPrimary(senderUser).slice(0, 2).toUpperCase()) : "?"}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className="w-8" />
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    "msg-bubble max-w-[75%] sm:max-w-[60%] shadow-sm relative text-sm rounded-2xl",
                    isMe ? "bg-[#D9FDD3] dark:bg-primary/20 dark:border dark:border-border" : "bg-white dark:bg-card"
                  )}
                >
                  {!isMe && showAvatar && (
                    <p className="text-[10px] font-bold mb-1 leading-none opacity-80">
                      <span className={cn(senderUser ? "text-primary" : "text-orange-500")}>
                        {senderUser ? resolveUserPrimary(senderUser) : "—"}
                      </span>
                    </p>
                  )}
                  {msg.deleted === true ? (
                    <p className="whitespace-pre-wrap leading-relaxed break-words italic text-muted-foreground p-2">This message was deleted</p>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed break-words p-2">{msg.content}</p>
                  )}
                  <div className={cn("text-[10px] mt-1 flex items-center gap-1 opacity-60 select-none px-2 pb-1", isMe ? "justify-end" : "justify-start")}>
                    {formatTimestamp(msg.timestamp ?? msg.createdAt)}
                    {isMe && <span className="ml-1">{getStatusIcon(displayStatus, isMe)}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
