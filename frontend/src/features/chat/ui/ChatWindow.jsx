/**
 * ChatWindow: messages from useMessages(conversationIdNormalized) (WS adapter);
 * send via sendOrQueueMessage; pending -> sent -> delivered lifecycle from adapter.
 * No mock data; empty/loading states from adapter state.
 * PHASE C: Legacy dm-* is normalized to direct:<min>:<max> before reading/writing messages.
 * 
 * ============================================================================
 * PHASE A4: Manual Test Script (WS → UI Update Verification)
 * ============================================================================
 * 
 * GOAL: Prove that WS MESSAGE_RECEIVE drives UI updates without page refresh.
 * 
 * STEPS:
 * 1. Open two browser windows/tabs:
 *    - Window A: Login as User A
 *    - Window B: Login as User B
 * 
 * 2. In Window A:
 *    - Select DM conversation with User B (from sidebar)
 *    - Open browser DevTools Console
 * 
 * 3. In Window B:
 *    - Select DM conversation with User A
 *    - Send a message to User A
 * 
 * 4. In Window A Console, verify logs appear WITHOUT page refresh:
 *    - [WS_MERGE] { chatId: "direct:<min>:<max>", messageId: "...", totalMessagesInThatChat: N }
 *    - [UI_READ] { conversationIdNormalized: "direct:<min>:<max>", renderedCount: N }
 * 
 * EXPECTED BEHAVIOR:
 * - WS_MERGE log appears immediately when message arrives via WebSocket
 * - UI_READ log appears immediately after (React re-render triggered by state update)
 * - Both counts increment WITHOUT any page refresh or manual reload
 * - Message appears in UI instantly
 * 
 * VERIFICATION:
 * - If WS_MERGE appears but UI_READ doesn't → React state update issue
 * - If neither appears → WebSocket connection issue
 * - If both appear → WS → UI pipeline working correctly ✓
 * 
 * ============================================================================
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth, useChatStore, useMessages, useSettingsStore } from "../adapters";
import { getConversationId } from "../domain/conversation";
import { getAuthState } from "@/state/auth.state";
import { toDirectIdFromUsers, toCanonicalChatId } from "../utils/chatId.js";
import { getDaySeparator, formatTimestamp, shouldGroupWithPrev as shouldGroupMessages, getStatusIconConfig } from "../domain/message";
import { formatUserStatus, countOnlineUsers } from "../domain/user";
import { SendHorizontal, Paperclip, Smile, MoreVertical, Loader2, MessageCircle, AlertCircle, Check, CheckCheck, Trash2, Edit2, Flag, X, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "../utils/utils";
import { resolveUserPrimary } from "../utils/userDisplay";
import { avatarSrc, resolveThumbnailUrl } from "../utils/avatarUrl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupInfoPanel } from "./GroupInfoPanel";
import { EmojiPicker } from "../components/EmojiPicker";
import { useToast } from "@/hooks/useToast";
import { MAX_CONTENT_LENGTH } from "@/config/wsContract";
import { useLocation } from "wouter";
import { createReport } from "../api/report.api";
import { getServerConversationId } from "../utils/chatId.js";

export function ChatWindow() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const {
    activeGroupId,
    activeDmUser,
    activeConversationId,
    roomIds,
    roomsById,
    membersByRoomId,
    simulatedTypingUser,
    setSimulatedTypingUser,
    getTypingUserForChat,
    getTypingUsersForChat,
    sendTypingIndicator,
    updateLastActivity,
    setLastMessagePreview,
    connectionStatus,
    presenceUsers,
    onlineUsers,
    dummyUserOnlineOverrides,
    usersById,
    users,
    setActiveGroupId,
    addMessage,
    editMessage,
    replaceMessage,
    deleteMessage,
    loadMessages,
    historyCursor,
    historyLoading,
    messagesByConversation,
    scrollToMessageId,
    setScrollToMessageId,
    isWsReady,
    sendMessageViaWs,
    sendRoomMessageViaWs,
    sendOrQueueMessage,
    markAsReadForConversation,
    requestRoomMembers,
    roomDeliveryByRoomMessageId,
  } = useChatStore();
  const { reducedMotion, enterToSend, messageGrouping } = useSettingsStore();
  const { toast } = useToast();
  const prevConversationIdRef = useRef(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);

  const conversationId = activeConversationId ?? (
    activeDmUser ? (() => {
      const me = getAuthState().user?.id;
      return me ? toDirectIdFromUsers(me, activeDmUser) : null;
    })() : (activeGroupId != null ? `room:${activeGroupId}` : null)
  );
  // PHASE A3: Normalize dm-* to direct:<min>:<max> so UI reads the same bucket WS writes to.
  const myId = user?.id ?? getAuthState().user?.id ?? null;
  const conversationIdNormalized = toCanonicalChatId(conversationId ?? null, myId);
  
  // PHASE A3: DEV-only assertion to catch any remaining dm-* IDs
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV && conversationIdNormalized && typeof conversationIdNormalized === "string" && conversationIdNormalized.startsWith("dm-")) {
    console.warn(
      `[PHASE_A3_ASSERT] Found dm-* ID after normalization in ChatWindow: "${conversationIdNormalized}"`,
      { originalConversationId: conversationId, myId },
      new Error().stack
    );
  }
  const rawRoomId = conversationIdNormalized?.startsWith("room:") ? conversationIdNormalized.slice(5) : null;
  const isActiveRoom = !!rawRoomId && Array.isArray(roomIds) && roomIds.includes(rawRoomId);
  const messages = useMessages(conversationIdNormalized);
  
  // PHASE A4: DEV-only log to prove UI reads updated messages from WS merge
  useEffect(() => {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV && conversationIdNormalized && messages) {
      console.log("[UI_READ]", {
        conversationIdNormalized,
        renderedCount: messages.length,
        messageIds: messages.slice(-5).map((m) => m.messageId || m.id).filter(Boolean), // Last 5 message IDs for verification
      });
    }
  }, [conversationIdNormalized, messages]);
  const activeGroup = (isActiveRoom && rawRoomId ? roomsById[rawRoomId] : null) ?? (activeGroupId != null ? roomsById[activeGroupId] : null) ?? null;
  const activeGroupThumbnailUrl = activeGroup?.thumbnailUrl ?? activeGroup?.meta?.thumbnailUrl ?? null;
  const dmUser = activeDmUser ? usersById[activeDmUser] ?? null : null;
  const cursor = conversationIdNormalized ? historyCursor[conversationIdNormalized] : null;
  const isLoadingHistory = conversationIdNormalized ? historyLoading[conversationIdNormalized] : false;
  const canPaginateHistory = conversationIdNormalized?.startsWith("direct:") || conversationIdNormalized?.startsWith("room:");

  const [inputValue, setInputValue] = useState("");
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [showReportModal, setShowReportModal] = useState(null);
  const [showReportUserModal, setShowReportUserModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [groupThumbnailError, setGroupThumbnailError] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const prevActiveGroupIdRef = useRef(activeGroupId);

  useEffect(() => {
    setGroupThumbnailError(false);
  }, [activeGroupId, activeGroupThumbnailUrl]);
  const lastMarkedMessageIdRef = useRef({});
  // PROMPT 2 PART C: Track last message ID that was marked as read to prevent duplicate calls
  const lastReadMsgRef = useRef({ conversationId: null, lastMsgId: null });
  const typingDebounceRef = useRef(null);
  /** Throttle: send typing true at most once per 1000ms per conversation (WS-5). */
  const lastTypingTrueAtRef = useRef({});

  const isSendDisabled = !conversationIdNormalized || !inputValue.trim() || !user || connectionStatus === "connecting";
  const sendDisabledReason = !conversationIdNormalized ? "Select a chat" : !inputValue.trim() ? "Type a message" : !user ? "Sign in" : connectionStatus === "connecting" ? "Connecting…" : null;

  useEffect(() => {
    if (conversationIdNormalized !== prevConversationIdRef.current) {
      if (prevConversationIdRef.current) {
        sendTypingIndicator(prevConversationIdRef.current, false);
      }
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      prevConversationIdRef.current = conversationIdNormalized;
      setInputValue("");
      setEditingMessageId(null);
      setEditingContent("");
      setShowEmojiPicker(false);
      setSimulatedTypingUser(null);
      sendTypingIndicator(conversationIdNormalized, false);
    }
  }, [conversationIdNormalized, setSimulatedTypingUser, sendTypingIndicator]);

  // Request room members ASAP when active chat is a room so header count hydrates quickly
  useEffect(() => {
    if (rawRoomId) requestRoomMembers(rawRoomId);
  }, [rawRoomId, requestRoomMembers]);

  // Rehydrate message history when opening any conversation (DM or room) if not yet loaded. Survives refresh/relogin.
  // For rooms: do not fetch history until room exists in roomsById (avoids "Room not found" right after create).
  useEffect(() => {
    if (!conversationIdNormalized) return;
    if (conversationIdNormalized.startsWith("room:")) {
      const roomId = conversationIdNormalized.slice(5);
      if (!roomsById?.[roomId]) return;
    }
    const alreadyHasMessages = messagesByConversation[conversationIdNormalized] !== undefined;
    if (alreadyHasMessages) return;
    loadMessages(conversationIdNormalized, { limit: 50 })
      .catch((e) => toast({ title: "Failed to load messages", description: e?.message || "Try again", variant: "destructive" }));
  }, [conversationIdNormalized, messagesByConversation, roomsById]);

  // Scroll to and briefly highlight a message (e.g. from global search result click).
  useEffect(() => {
    if (!scrollToMessageId || !conversationIdNormalized || !setScrollToMessageId) return;
    let highlightTimeout;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(scrollToMessageId);
        setScrollToMessageId(null);
        highlightTimeout = setTimeout(() => setHighlightedMessageId(null), 2000);
      }
    }, 100);
    return () => {
      clearTimeout(timer);
      if (highlightTimeout) clearTimeout(highlightTimeout);
    };
  }, [scrollToMessageId, conversationIdNormalized, setScrollToMessageId, messages?.length]);

  // PROMPT 2 PART C: Mark as read only when last message ID changes (prevent spam calls)
  useEffect(() => {
    if (!conversationIdNormalized || !messages?.length || !user?.id) return;
    if (conversationIdNormalized.startsWith("room:")) return;
    const isDm = conversationIdNormalized.startsWith("direct:");
    if (!isDm) return;
    
    const fromOther = messages.filter((m) => m.senderId !== user.id);
    const latestFromOther = fromOther.length ? fromOther[fromOther.length - 1] : null;
    if (!latestFromOther?.id) return;
    
    // Get the messageId (prefer messageId over id)
    const lastMsgId = latestFromOther.messageId || latestFromOther.id || null;
    if (!lastMsgId) return;
    
    // PROMPT 2 PART C: Only mark as read if conversation changed OR last message ID changed
    if (lastReadMsgRef.current.conversationId === conversationIdNormalized &&
        lastReadMsgRef.current.lastMsgId === lastMsgId) {
      return; // Already marked this message as read
    }
    
    // Update ref and mark as read
    lastReadMsgRef.current = { conversationId: conversationIdNormalized, lastMsgId };
    // Also update legacy ref for compatibility
    lastMarkedMessageIdRef.current[conversationIdNormalized] = lastMsgId;
    markAsReadForConversation(conversationIdNormalized);
  }, [conversationIdNormalized, messages, markAsReadForConversation, user?.id]);

  useEffect(() => {
    const chatId = conversationIdNormalized;
    const lastMsg = messages?.length ? messages[messages.length - 1] : null;
    if (!lastMsg?.content) return;
    if (!chatId) return;
    setLastMessagePreview(chatId, {
      content: lastMsg.content,
      timestamp: lastMsg.createdAt ?? lastMsg.timestamp ?? Date.now(),
      senderId: lastMsg.senderId,
    });
  }, [messages, conversationIdNormalized, setLastMessagePreview]);

  const scrollToBottom = useCallback((force = false) => {
    if (!scrollRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
        }
      });
    });
  }, [reducedMotion]);

  useEffect(() => {
    if (messages?.length && conversationIdNormalized) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        });
      });
    }
  }, [conversationIdNormalized, messages?.length]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollButton(distanceFromBottom > 100);
  }, []);

  useEffect(() => {
    if (showGroupInfo && prevActiveGroupIdRef.current !== activeGroupId && activeGroupId !== null) setShowGroupInfo(false);
    prevActiveGroupIdRef.current = activeGroupId;
  }, [activeGroupId, activeDmUser, showGroupInfo]);

  const getRecipientFromDirectChat = useCallback((chatId) => {
    if (!chatId || !chatId.startsWith("direct:") || !user?.id) return null;
    const parts = chatId.split(":");
    if (parts.length !== 3) return null;
    const other = parts[1] === user.id ? parts[2] : parts[1];
    return other;
  }, [user?.id]);

  const handleSend = async () => {
    if (!conversationIdNormalized) {
      toast({ title: "Select a chat", description: "Create or join a room from the sidebar first.", variant: "destructive" });
      return;
    }
    const text = inputValue.trim();
    if (!text || !user || isSendDisabled) return;
    if (text.length > MAX_CONTENT_LENGTH) {
      toast({ title: "Message too long", description: `Max ${MAX_CONTENT_LENGTH.toLocaleString()} characters`, variant: "destructive" });
      return;
    }
    if (connectionStatus === "connecting") return;
    setInputValue("");
    sendTypingIndicator(conversationIdNormalized, false);
    // PHASE 2: Generate clientMessageId for optimistic send reconciliation
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const message = {
      id: clientId,
      messageId: null, // Will be set by server
      clientMessageId: clientId, // PHASE 2: Track optimistic message for reconciliation
      senderId: user.id,
      content: text,
      status: "sending",
      createdAt: new Date(),
      ...(isActiveRoom && rawRoomId ? { roomId: rawRoomId } : {}),
    };
    addMessage(conversationIdNormalized, message);
    if (conversationIdNormalized) updateLastActivity(conversationIdNormalized);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    inputRef.current?.focus();

    if (isActiveRoom && rawRoomId) {
      const handled = sendOrQueueMessage(conversationIdNormalized, text, clientId, { roomId: conversationIdNormalized });
      if (!handled) {
        toast({ title: "Send failed", description: "WebSocket not ready or message too long", variant: "destructive" });
        replaceMessage(conversationIdNormalized, clientId, { status: "failed" });
      }
    } else if (conversationIdNormalized?.startsWith("direct:")) {
      const recipientId = getRecipientFromDirectChat(conversationIdNormalized);
      if (recipientId) {
        const handled = sendOrQueueMessage(conversationIdNormalized, text, clientId, { recipientId });
        if (!handled) {
          toast({ title: "Send failed", description: "WebSocket not ready or message too long", variant: "destructive" });
          replaceMessage(conversationIdNormalized, clientId, { status: "failed" });
        }
      }
    }
  };

  const handleKeyDown = (e) => {
    if (enterToSend && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e) => {
    setInputValue(e.target.value);
    if (!conversationIdNormalized || (!conversationIdNormalized.startsWith("direct:") && !isActiveRoom)) return;
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      const now = Date.now();
      const last = lastTypingTrueAtRef.current[conversationIdNormalized] ?? 0;
      if (now - last >= 1000) {
        sendTypingIndicator(conversationIdNormalized, true);
        lastTypingTrueAtRef.current[conversationIdNormalized] = now;
      }
      typingDebounceRef.current = null;
    }, 800);
  };

  const handleEmojiSelect = (emoji) => {
    setInputValue((prev) => prev + emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };

  const handleStartEdit = (msgId, content) => {
    setEditingMessageId(msgId);
    setEditingContent(content);
  };

  const handleSaveEdit = () => {
    if (editingMessageId !== null && editingContent.trim()) {
      editMessage(conversationIdNormalized, editingMessageId, editingContent.trim());
      setEditingMessageId(null);
      setEditingContent("");
    } else {
      setEditingMessageId(null);
      setEditingContent("");
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent("");
  };

  const handleDeleteMessage = (messageId) => {
    deleteMessage(conversationIdNormalized, messageId);
  };

  const handleRetryFailedMessage = (msg) => {
    if (!conversationIdNormalized || !user || !msg?.content) return;
    // PHASE 2: Generate new clientMessageId for retry (new optimistic message)
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    deleteMessage(conversationIdNormalized, msg.id);
    const newMsg = {
      id: clientId,
      messageId: null, // Will be set by server
      clientMessageId: clientId, // PHASE 2: Track optimistic message for reconciliation
      senderId: user.id,
      content: msg.content,
      status: "sending",
      createdAt: new Date(),
      ...(isActiveRoom && rawRoomId ? { roomId: rawRoomId } : {}),
    };
    addMessage(conversationIdNormalized, newMsg);
    const roomId = isActiveRoom && rawRoomId ? conversationIdNormalized : null;
    const recipientId = conversationIdNormalized?.startsWith("direct:") ? getRecipientFromDirectChat(conversationIdNormalized) : null;
    sendOrQueueMessage(conversationIdNormalized, msg.content, clientId, roomId != null ? { roomId } : { recipientId });
  };

  const getStatusIcon = (status, isMe) => {
    const config = getStatusIconConfig(status, isMe);
    if (!config) return null;
    switch (config.type) {
      case "spinner":
        return <Loader2 className={config.className} />;
      case "check":
        return <Check className={config.className} />;
      case "check-check":
        return <CheckCheck className={config.className} />;
      case "alert-circle":
        return <AlertCircle className={config.className} />;
      default:
        return <Check className={config.className} />;
    }
  };

  const typingUserId = getTypingUserForChat?.(conversationIdNormalized) ?? simulatedTypingUser;
  const typingDisplayName = typingUserId ? resolveUserPrimary(usersById[typingUserId]) : null;
  const typingUserIds = (getTypingUsersForChat?.(conversationIdNormalized) ?? []);
  const dmOtherUserId = conversationIdNormalized?.startsWith("direct:") ? getRecipientFromDirectChat(conversationIdNormalized) : null;
  const dmHeaderUser = dmOtherUserId ? (usersById[dmOtherUserId] ?? null) : dmUser;
  const isDmChat = !!dmOtherUserId;

  const msgList = Array.isArray(messages) ? messages : [];

  const headerTitle =
    conversationIdNormalized?.startsWith("room:")
      ? (activeGroup?.name ?? activeGroup?.title ?? "Group")
      : conversationIdNormalized?.startsWith("direct:")
        ? (dmHeaderUser?.displayName ?? dmHeaderUser?.username ?? "Direct message")
        : "Select a chat";
  const headerInitials =
    conversationIdNormalized?.startsWith("room:")
      ? (headerTitle?.slice(0, 1) ?? "G")
      : conversationIdNormalized?.startsWith("direct:")
        ? (dmHeaderUser ? (dmHeaderUser.avatarInitials ?? (dmHeaderUser.displayName ?? dmHeaderUser.username ?? "U").slice(0, 2).toUpperCase()) : "U")
        : "C";
  const headerAvatarColor = dmUser ? (dmUser.avatarColor ?? "bg-primary/10") : "bg-primary/10";

  const showChatHeader = !!conversationIdNormalized;
  const chatTitle = showChatHeader ? headerTitle : "Select a chat";
  // Authoritative count: activeGroup.members length > activeGroup.memberCount > "…" (avoids wrong value after refresh)
  const groupMemberCountDisplay =
    activeGroup == null
      ? "…"
      : Array.isArray(activeGroup.members)
        ? activeGroup.members.length
        : typeof activeGroup.memberCount === "number"
          ? activeGroup.memberCount
          : "…";
  const chatSubtitle = showChatHeader
    ? (isActiveRoom ? (typingUserIds.length > 0 ? (
        <span className="text-primary font-medium animate-pulse">
          {typingUserIds.map((id) => resolveUserPrimary(usersById[id])).join(", ")} typing...
        </span>
      ) : (
        <span>{groupMemberCountDisplay} members</span>
      )) : isDmChat ? (typingDisplayName ? (
        <span className="text-primary font-medium animate-pulse">{typingDisplayName} is typing...</span>
      ) : (
        (presenceUsers[dmOtherUserId] == null ? "Offline" : formatUserStatus(presenceUsers[dmOtherUserId]))
      )) : (
        <span>{groupMemberCountDisplay} members</span>
      ))
    : "Select a chat from the sidebar";

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#EFEAE2] dark:bg-[#0f172a] relative">
      <div className="absolute inset-0 chat-bg-pattern opacity-40 pointer-events-none" />
      <div className="chat-header h-[60px] px-[var(--ui-pad-inline,1rem)] bg-card/95 backdrop-blur-sm border-b border-border/50 flex items-center justify-between z-10 shadow-sm">
        <div
          className="flex items-center gap-3 cursor-pointer p-1 rounded-lg transition-colors hover:bg-accent/50"
          onClick={() => {
            if (!conversationIdNormalized?.startsWith("room:")) return;
            if (!activeGroupId) {
              toast({ title: "No active group", description: "Select a group first to view its details.", variant: "destructive" });
              return;
            }
            setShowGroupInfo(true);
          }}
          data-testid="button-chat-header"
        >
          <div className="relative">
            <Avatar className="h-10 w-10 ring-1 ring-border shadow-sm">
              {showChatHeader && dmUser?.avatarUrl && <AvatarImage src={avatarSrc(dmUser.avatarUrl, dmUser.updatedAt)} alt="" />}
              {showChatHeader && !dmUser && resolveThumbnailUrl(activeGroupThumbnailUrl) && !groupThumbnailError && (
                <AvatarImage src={resolveThumbnailUrl(activeGroupThumbnailUrl)} alt="" className="rounded-full object-cover" onError={() => setGroupThumbnailError(true)} />
              )}
              <AvatarFallback className={cn("font-bold", showChatHeader && dmUser ? `text-white ${headerAvatarColor}` : "bg-primary/10 text-primary")}>
                {showChatHeader ? headerInitials : "C"}
              </AvatarFallback>
            </Avatar>
            {showChatHeader && isDmChat && (
              <span
                className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-card", presenceUsers[dmOtherUserId]?.online === true ? "bg-green-500" : presenceUsers[dmOtherUserId]?.status === "away" ? "bg-yellow-500" : "bg-muted-foreground/30")}
                title={presenceUsers[dmOtherUserId]?.online === true ? "Online" : presenceUsers[dmOtherUserId] != null && presenceUsers[dmOtherUserId].status === "offline" ? "Offline" : "—"}
              />
            )}
          </div>
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold leading-none" data-testid="text-chat-name">{chatTitle}</h2>
            <p className="text-xs text-muted-foreground mt-1">{chatSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {showChatHeader && isDmChat && user?.id !== activeDmUser && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground rounded-full" onClick={() => { setShowReportUserModal(true); setReportReason(""); setReportDetails(""); }} data-testid="button-report-user">
                  <Flag className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Report user</p></TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground rounded-full"
            onClick={() => {
              if (typeof window !== "undefined") window.sessionStorage.setItem("settings:returnTo", window.location.pathname);
              setLocation("/settings/profile");
            }}
            data-testid="button-open-settings"
          >
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="chat-root-pad flex-1 min-h-0 overflow-y-auto custom-scrollbar z-0 relative">
        {!conversationIdNormalized ? (
          <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
            <MessageCircle className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-sm">Select a chat from the sidebar</p>
          </div>
        ) : !isActiveRoom && activeGroupId != null && activeGroup == null ? (
          <div className="chat-empty-state flex flex-col h-full items-center justify-center text-muted-foreground">
            <p className="text-sm">Group not available</p>
          </div>
        ) : (
        <>
        <div className="msg-list flex flex-col">
          {canPaginateHistory && (cursor?.hasMore || isLoadingHistory) && (
            <div className="flex justify-center py-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isLoadingHistory}
                onClick={() => loadMessages(conversationIdNormalized, { limit: 50, beforeId: cursor?.nextCursor ?? undefined })}
              >
                {isLoadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load older"}
              </Button>
            </div>
          )}
          {msgList.map((msg, index) => {
            const isMe = msg.senderId === user?.id;
            const prevMsg = index > 0 ? msgList[index - 1] : undefined;
            const grouped = messageGrouping ? shouldGroupMessages(msg, prevMsg, 5 * 60 * 1000) : false;
            const showAvatar = !isMe && !grouped;
            const msgDate = new Date(msg.createdAt ?? msg.timestamp);
            const prevDate = prevMsg ? new Date(prevMsg.createdAt ?? prevMsg.timestamp) : undefined;
            const daySeparator = !Number.isNaN(msgDate.getTime()) ? getDaySeparator(msgDate, prevDate && !Number.isNaN(prevDate.getTime()) ? prevDate : undefined) : null;
            const senderUser = msg.senderId ? usersById[msg.senderId] : undefined;

            const msgId = msg.messageId ?? msg.id ?? msg.roomMessageId;
            const isHighlighted = highlightedMessageId && String(highlightedMessageId) === String(msgId);
            const isRoomMsg = msg.roomId != null || msg.roomMessageId != null;
            const roomMsgId = msg.roomMessageId ?? msg.id;
            const delivery = roomDeliveryByRoomMessageId?.[String(roomMsgId)];
            const displayStatus = isMe && isRoomMsg && delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount
              ? "delivered"
              : msg.status;
            return (
              <div
                key={
                  // Stable, collision-resistant keys: namespace by room vs dm so replays/acks can't hide messages.
                  msg.roomId != null
                    ? `room:${msg.roomId}:${msg.roomMessageId ?? msg.id ?? msg.clientMessageId ?? index}`
                    : (msg.messageId != null || msg.id != null || msg.clientMessageId != null)
                      ? `dm:${msg.messageId ?? msg.id ?? msg.clientMessageId}`
                      : `msg-${index}`
                }
                data-message-id={msgId ?? undefined}
                className={cn("flex flex-col", grouped ? "mt-0.5" : "mt-3", isHighlighted && "rounded-lg ring-2 ring-primary/50 bg-primary/5 transition-colors")}
              >
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
                      ) : <div className="w-8" />}
                    </div>
                  )}
                  <div
                    className={cn(
                      "msg-bubble max-w-[75%] sm:max-w-[60%] shadow-sm relative text-sm group rounded-2xl",
                      isMe ? "bg-[#D9FDD3] dark:bg-primary/20 dark:border dark:border-border text-foreground message-bubble-sent" : "bg-white dark:bg-card text-foreground message-bubble-received"
                    )}
                  >
                    {!isMe && showAvatar && (
                      <p className="text-[10px] font-bold mb-1 leading-none opacity-80">
                        <span className={cn(senderUser ? "text-primary" : "text-orange-500")}>
                          {senderUser ? resolveUserPrimary(senderUser) : "—"}
                        </span>
                      </p>
                    )}
                    {editingMessageId === msg.id && !msg.deleted ? (
                      <div className="space-y-2 p-2">
                        <textarea
                          className="w-full bg-transparent border border-border rounded-lg p-2 focus:ring-1 focus:ring-primary text-sm resize-none"
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") handleCancelEdit(); }}
                          data-testid="input-edit-message"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={handleCancelEdit} className="h-6 text-[10px]" data-testid="button-cancel-edit">Cancel</Button>
                          <Button variant="default" size="sm" onClick={handleSaveEdit} className="h-6 text-[10px]" data-testid="button-save-edit">Save</Button>
                        </div>
                      </div>
                    ) : msg.deleted === true ? (
                      <p className="whitespace-pre-wrap leading-relaxed break-words italic text-muted-foreground p-2">This message was deleted</p>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed break-words p-2">{msg.content}</p>
                    )}
                    <div className={cn("text-[10px] mt-1 flex items-center gap-1 opacity-60 select-none px-2 pb-1", isMe ? "justify-end" : "justify-start")}>
                      {formatTimestamp(msg.timestamp || msg.createdAt)}
                      {msg.editedAt && !msg.deleted && (
                        <span className="ml-1 text-muted-foreground italic" title={msg.editedAt ? new Date(msg.editedAt).toLocaleString() : ""}>edited</span>
                      )}
                      {isMe && <span className="ml-1">{getStatusIcon(displayStatus, isMe)}</span>}
                      {isMe && isDmChat && (msg.status !== "delivered" && msg.status !== "read") && (() => {
                        const presence = dmOtherUserId != null ? presenceUsers[dmOtherUserId] : null;
                        const recipientOffline = presence != null
                          ? (presence.status === "offline" || presence.online === false)
                          : Boolean(msg.deliveryStatus === "offline");
                        return recipientOffline ? (
                          <span className="ml-1 text-[10px] text-muted-foreground" title="Recipient offline">(offline)</span>
                        ) : null;
                      })()}
                      {isMe && msg.status === "failed" && (
                        <button type="button" className="ml-1 underline hover:no-underline text-primary font-medium" onClick={() => handleRetryFailedMessage(msg)} data-testid={`button-retry-inline-${msg.id}`}>
                          Retry
                        </button>
                      )}
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="relative group/menu">
                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full bg-background/50">
                          <MoreVertical className="w-3 h-3" />
                        </Button>
                        <div className="absolute right-0 top-full hidden group-hover/menu:block bg-card border border-border shadow-lg rounded-lg z-50 min-w-[100px] overflow-hidden">
                          {isMe && !msg.deleted && (
                            <>
                              {msg.status === "failed" && (
                                <button className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent flex items-center gap-2" onClick={() => handleRetryFailedMessage(msg)} data-testid={`button-retry-msg-${msg.id}`}>
                                  <SendHorizontal className="w-3 h-3" /> Retry
                                </button>
                              )}
                              <button className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent flex items-center gap-2" onClick={() => handleStartEdit(msg.id, msg.content)} data-testid={`button-edit-msg-${msg.id}`}>
                                <Edit2 className="w-3 h-3" /> Edit
                              </button>
                              <button className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent text-destructive flex items-center gap-2" onClick={() => handleDeleteMessage(msg.id)} data-testid={`button-delete-msg-${msg.id}`}>
                                <Trash2 className="w-3 h-3" /> Delete
                              </button>
                            </>
                          )}
                          {!isMe && (
                            <button className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent flex items-center gap-2" onClick={() => { setShowReportModal({ messageId: msg.id, senderId: msg.senderId }); setReportReason(""); setReportDetails(""); }} data-testid={`button-report-msg-${msg.id}`}>
                              <Flag className="w-3 h-3" /> Report message
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {showScrollButton && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight); }}
            className="fixed bottom-24 right-8 rounded-full shadow-lg z-50 flex items-center gap-2"
            data-testid="button-scroll-bottom"
          >
            <MessageCircle className="w-4 h-4" /> New Messages
          </Button>
        )}
        </>
        )}
      </div>

      <div className="p-3 border-t border-border bg-card/95 backdrop-blur-sm z-10">
        {connectionStatus === "connecting" && (
          <p className="text-xs text-muted-foreground text-center mb-1" data-testid="text-connecting">Connecting…</p>
        )}
        <div className="max-w-4xl mx-auto flex items-end gap-2">
          <div className="relative flex-1 flex items-end gap-1">
            <Button variant="ghost" size="icon" className="flex-shrink-0 rounded-full h-9 w-9 text-muted-foreground" disabled><Paperclip className="w-4 h-4" /></Button>
            <div className="relative flex-1 min-w-0">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                disabled={!conversationIdNormalized}
                placeholder={conversationIdNormalized ? "Type a message..." : "Select/create/join a chat to start messaging..."}
                rows={1}
                className="w-full min-h-[40px] max-h-[120px] resize-none rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
                data-testid="input-message"
              />
              <div className="absolute bottom-2 right-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground" onClick={() => setShowEmojiPicker((v) => !v)} disabled={!conversationIdNormalized} data-testid="button-emoji-picker">
                  <Smile className="w-4 h-4" />
                </Button>
                {showEmojiPicker && (
                  <div className="absolute bottom-full right-0 mb-1">
                    <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
                  </div>
                )}
              </div>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="icon" className="rounded-full h-10 w-10 flex-shrink-0" onClick={handleSend} disabled={isSendDisabled} data-testid="button-send">
                  <SendHorizontal className="w-5 h-5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isSendDisabled && sendDisabledReason ? sendDisabledReason : "Send"}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {showGroupInfo && conversationIdNormalized?.startsWith("room:") && activeGroupId != null && (
        <GroupInfoPanel groupId={isActiveRoom ? rawRoomId : activeGroupId} open={showGroupInfo} onClose={() => setShowGroupInfo(false)} />
      )}

      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !reportSubmitting && setShowReportModal(null)}>
          <div className={cn("bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6")} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">Report message</h3>
            <p className="text-sm text-muted-foreground mb-4">Why are you reporting this message?</p>
            <div className="space-y-3 mb-4">
              <label className="text-xs font-medium text-muted-foreground block">Category (required)</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                data-testid="select-report-reason"
              >
                <option value="">Select a category</option>
                <option value="Spam">Spam</option>
                <option value="Harassment">Harassment</option>
                <option value="Hate speech">Hate speech</option>
                <option value="Sexual content">Sexual content</option>
                <option value="Illegal">Illegal</option>
              </select>
              <label className="text-xs font-medium text-muted-foreground block">Details (optional)</label>
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Additional context..."
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value.slice(0, 2000))}
                maxLength={2000}
                data-testid="textarea-report-details"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowReportModal(null)} disabled={reportSubmitting} data-testid="button-cancel-report">Cancel</Button>
              <Button
                variant="destructive"
                disabled={!reportReason.trim() || reportSubmitting}
                onClick={async () => {
                  if (!reportReason.trim() || reportSubmitting || !showReportModal || !conversationIdNormalized) return;
                  const { messageId, senderId } = showReportModal;
                  const conversationIdBackend = getServerConversationId(conversationIdNormalized, user?.id);
                  setReportSubmitting(true);
                  try {
                    await createReport({ messageId, conversationId: conversationIdBackend, senderId, category: reportReason.trim(), reason: reportReason.trim(), details: reportDetails.trim() || undefined });
                    toast({ title: "Message reported", description: "Our team will review this message." });
                    setShowReportModal(null);
                    setReportReason("");
                    setReportDetails("");
                  } catch (e) {
                    const msg = e?.message ?? "Failed to submit report";
                    toast({ title: "Report failed", description: msg, variant: "destructive" });
                  } finally {
                    setReportSubmitting(false);
                  }
                }}
                data-testid="button-submit-report-message"
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showReportUserModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => !reportSubmitting && setShowReportUserModal(false)}>
          <div className={cn("bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6")} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">Report user</h3>
            <p className="text-sm text-muted-foreground mb-4">Why are you reporting this user?</p>
            <div className="space-y-3 mb-4">
              <label className="text-xs font-medium text-muted-foreground block">Category (required)</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                data-testid="select-report-user-reason"
              >
                <option value="">Select a category</option>
                <option value="Spam">Spam</option>
                <option value="Harassment">Harassment</option>
                <option value="Hate speech">Hate speech</option>
                <option value="Sexual content">Sexual content</option>
                <option value="Illegal">Illegal</option>
              </select>
              <label className="text-xs font-medium text-muted-foreground block">Details (optional)</label>
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Additional context..."
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value.slice(0, 2000))}
                maxLength={2000}
                data-testid="textarea-report-user-details"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowReportUserModal(false)} disabled={reportSubmitting}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={!reportReason.trim() || reportSubmitting || !activeDmUser}
                onClick={async () => {
                  if (!reportReason.trim() || reportSubmitting || !activeDmUser) return;
                  setReportSubmitting(true);
                  try {
                    await createReport({ targetUserId: activeDmUser, category: reportReason.trim(), reason: reportReason.trim(), details: reportDetails.trim() || undefined });
                    toast({ title: "User reported", description: "Our team will review this report." });
                    setShowReportUserModal(false);
                    setReportReason("");
                    setReportDetails("");
                  } catch (e) {
                    const msg = e?.message ?? "Failed to submit report";
                    toast({ title: "Report failed", description: msg, variant: "destructive" });
                  } finally {
                    setReportSubmitting(false);
                  }
                }}
                data-testid="button-submit-report-user"
              >
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}