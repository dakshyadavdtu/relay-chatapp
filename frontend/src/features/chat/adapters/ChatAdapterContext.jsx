/**
 * FIX B NOTE
 * This file currently contains mock fallbacks.
 * These fallbacks will be removed in Fix B.
 * UI structure must remain unchanged.
 */
// See docs/FIXB_MOCK_REMOVAL_README.md for removal scope.

/**
 * Phase 3: Single context that provides chat state + connection + presence + messages.
 * Phase 2: API chat list + message history via loadChats / loadMessages.
 * Phase 3: WebSocket real-time send/ACK/MESSAGE_RECEIVE; reconnect.
 * Phase 3A: ERROR, MESSAGE_ERROR, RATE_LIMIT_WARNING, MESSAGE_REPLAY_COMPLETE, CLIENT_ACK.
 * Phase 3C: RESUME on connect, RESYNC_START/COMPLETE, MESSAGE_REPLAY, STATE_SYNC_RESPONSE, lastSeen tracking.
 * Phase 3D: TYPING_START/TYPING_STOP (DM), PRESENCE_UPDATE (inbound); typing/presence state.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { getChats as getChatsApi, getHistory as getHistoryApi, markChatRead } from "../api/chat.api.js";
import * as roomsApi from "../api/rooms.ws.js";
import { apiFetch } from "@/lib/http.js";
import { wsClient } from "@/transport/wsClient";
import { getAuthState } from "@/state/auth.state";
import { useAuth } from "@/hooks/useAuth";
import { getLastSeenMessageId, updateLastSeenMessageId, clearLastSeenMessageId } from "@/state/resume.state";
import { toast } from "@/hooks/useToast";
import { showToast, TOAST_KIND } from "@/lib/showToast";
import { normalizeBackendError, toUserMessage } from "@/lib/errorMap";
import { applyStateUpdate as applyStateUpdateFsm, isDeliveredOrRead as isDeliveredOrReadFsm, normalizeState as normalizeMessageState } from "@/lib/messageStateMachine";
import { isDmId, isDirectId, isRoomId, toDirectIdFromUsers, toCanonicalChatId, getUiConversationKey, getServerConversationId } from "../utils/chatId.js";
import { getUiPrefs } from "@/features/ui_prefs/store/uiPrefs.store";
import { showDesktopNotification } from "@/utils/notificationUtils";
import { playMessageSound } from "@/utils/soundEffects";
// Exported so feature entry points can detect if a provider is already present
// (useful when hot-reload or embedding renders the chat UI without the expected wrapper).
export const ChatAdapterContext = createContext(null);

const noop = () => {};

/** True when the browser tab/window is focused and visible. Safe on older browsers (does not throw). */
function isTabFocused() {
  try {
    if (typeof document === "undefined") return false;
    if (document.visibilityState !== "visible") return false;
    return document.hasFocus?.() === true;
  } catch (_) {
    return false;
  }
}

/** True when the tab is hidden (e.g. background or another tab focused). SSR-safe: returns false if document is undefined. */
function isTabHidden() {
  try {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "hidden";
  } catch (_) {
    return false;
  }
}

/** Notify when user is not actively focused: hidden tab OR visible but unfocused window (e.g. another app on Mac). */
function isBackgrounded() {
  if (typeof document === "undefined") return false;
  // Hidden tab, or visible but window not focused
  return document.visibilityState === "hidden" || document.hasFocus?.() === false;
}

function normalizeMessage(m) {
  if (!m) return null;
  const isRoom = m.roomId != null || m.roomMessageId != null;
  const id = isRoom
    ? (m.roomMessageId ?? m.id ?? m.messageId)
    : (m.id ?? m.messageId);
  const messageId = m.messageId ?? m.roomMessageId ?? m.id;
  return {
    id,
    messageId,
    roomMessageId: m.roomMessageId ?? (isRoom ? (m.id ?? m.messageId) : undefined),
    roomId: m.roomId,
    clientMessageId: m.clientMessageId,
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt ?? m.timestamp,
    status: m.state ?? m.status,
    recipientId: m.recipientId,
    editedAt: m.editedAt ?? null,
    deleted: m.deleted === true,
    deletedAt: m.deletedAt ?? null,
  };
}

/** Identity for dedupe: same message if same messageId, roomMessageId, or clientMessageId/id. Rooms: dedupe by roomMessageId || id; DMs: by messageId/clientMessageId. */
function sameMessageIdentity(a, b) {
  if (!a || !b) return false;
  const aRoom = a.roomMessageId ?? (a.roomId && (a.id ?? a.messageId) ? (a.id ?? a.messageId) : null);
  const bRoom = b.roomMessageId ?? (b.roomId && (b.id ?? b.messageId) ? (b.id ?? b.messageId) : null);
  if (aRoom && bRoom && String(aRoom) === String(bRoom)) return true;
  const aServer = a.messageId ?? a.id;
  const bServer = b.messageId ?? b.id;
  if (aServer && bServer && String(aServer) === String(bServer)) return true;
  const aClient = a.clientMessageId ?? (a.id && !a.messageId && !a.roomMessageId ? a.id : null);
  const bClient = b.clientMessageId ?? (b.id && !b.messageId && !b.roomMessageId ? b.id : null);
  if (aClient && bClient && String(aClient) === String(bClient)) return true;
  if (aServer && bClient && String(aServer) === String(bClient)) return true;
  if (bServer && aClient && String(bServer) === String(aClient)) return true;
  return false;
}

/**
 * PHASE A3: Normalize conversationId to canonical format for UI state (unreadCounts, messagesByConversation, etc.).
 * Uses getUiConversationKey so keys match GET /api/chats and readCursorStore.
 */
function normalizeConversationId(conversationId) {
  const me = getAuthState().user?.id;
  return getUiConversationKey(conversationId, me);
}

/**
 * PHASE A3: DEV-only assertion to catch any remaining dm-* IDs after normalization.
 */
function assertCanonicalId(conversationId, context = "") {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (conversationId && typeof conversationId === "string" && conversationId.startsWith("dm-")) {
      console.warn(
        `[PHASE_A3_ASSERT] Found dm-* ID after normalization: "${conversationId}"`,
        context,
        new Error().stack
      );
    }
  }
}

export function ChatAdapterProvider({ children }) {
  // #region agent log
  try {
    fetch("http://127.0.0.1:7440/ingest/34831ccd-0439-498b-bff5-78886fda482e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8283cd" },
      body: JSON.stringify({
        sessionId: "8283cd",
        location: "ChatAdapterContext.jsx:ChatAdapterProvider",
        message: "ChatAdapterProvider render start",
        data: {},
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
  } catch (_) {}
  // #endregion
  const { isAuthenticated, isLoading: authLoading, user: authUser, logout: authLogout } = useAuth();
  const [activeGroupId, setActiveGroupIdState] = useState(null);
  const [activeDmUser, setActiveDmUserState] = useState(null);
  const [activeConversationId, setActiveConversationIdState] = useState(null);
  /** When set, ChatWindow should scroll to this message and highlight briefly (e.g. from search result click). */
  const [scrollToMessageId, setScrollToMessageId] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  /** Phase 3: client-side room unread (increment on ROOM_MESSAGE when not viewing; clear when opening room). */
  const [roomUnreadCounts, setRoomUnreadCounts] = useState({});
  /** Invariant: if conversationId === activeConversationId then unreadCount must be 0 and must not increment (DM and room). Enforced in setActiveConversationId, mergeMessageReceive (DM), ROOM_MESSAGE (room), and loadChats. */
  /** PHASE 3: Single source of truth for read tracking - lastReadMessageId per conversation per user */
  const [lastReadMessageIdByConversation, setLastReadMessageIdByConversation] = useState({});
  const [lastActivityTimestamps, setLastActivityTimestamps] = useState({});
  const [lastMessagePreviews, setLastMessagePreviews] = useState({});
  const [dummyUserOnlineOverrides, setDummyUserOnlineOverrides] = useState({});
  const [simulatedTypingUser, setSimulatedTypingUser] = useState(null);
  const [typingByChatId, setTypingByChatId] = useState({});
  const [presenceByUserId, setPresenceByUserId] = useState({});
  const typingExpireRef = useRef(null);
  const [messagesByConversation, setMessagesByConversation] = useState(() => ({}));
  const [apiChats, setApiChats] = useState([]);
  const [apiChatsLoading, setApiChatsLoading] = useState(false);
  const [apiChatsError, setApiChatsError] = useState(null);
  const [roomsById, setRoomsById] = useState({});
  const [roomIds, setRoomIds] = useState([]);
  const [membersByRoomId, setMembersByRoomId] = useState({});
  /** Phase 3C: roomId -> myRole (OWNER|ADMIN|MEMBER) for RBAC UI */
  const [rolesByRoom, setRolesByRoom] = useState({});
  /** roomMessageId -> { deliveredCount, totalCount } for group tick: delivered only when all other members received */
  const [roomDeliveryByRoomMessageId, setRoomDeliveryByRoomMessageId] = useState({});
  /** Apply delivery summaries from room history (e.g. getRoomHistory) so old messages show double tick when delivered to all. */
  const applyRoomDeliverySummaries = useCallback((messages) => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    const summaries = {};
    messages.forEach((m) => {
      if (m.deliverySummary && typeof m.deliverySummary === 'object' && (m.roomMessageId || m.messageId)) {
        const rid = String(m.roomMessageId || m.messageId);
        summaries[rid] = {
          deliveredCount: m.deliverySummary.deliveredCount ?? 0,
          totalCount: m.deliverySummary.totalCount ?? 0,
        };
      }
    });
    if (Object.keys(summaries).length > 0) {
      setRoomDeliveryByRoomMessageId((prev) => ({ ...prev, ...summaries }));
    }
  }, []);
  const [users, setUsers] = useState([]);
  const [usersById, setUsersById] = useState({});
  const [historyCursor, setHistoryCursor] = useState({});
  const [historyLoading, setHistoryLoading] = useState({});
  const [wsConnectionStatus, setWsConnectionStatus] = useState("disconnected");
  /** Reactive WS ready (true after HELLO_ACK). Replaces stale wsClient.isReady() in context. */
  const [wsReady, setWsReady] = useState(() => wsClient.isReady());
  const [isReplaying, setIsReplaying] = useState(false);
  /** Phase 3: true until ROOMS_SNAPSHOT or ROOM_LIST_RESPONSE received; set true on auth->auth and on HELLO_ACK (reconnect). */
  const [isDirectoryHydrating, setIsDirectoryHydrating] = useState(false);
  const wsSubRef = useRef(null);
  const replaceMessageRef = useRef(() => {});
  const updateMessageStatusRef = useRef(() => {});
  /** P5: TYPING throttle 400ms + do not send same state twice consecutively (avoid rate limit). */
  const typingSendRef = useRef({
    lastStartTs: 0,
    stopTimer: null,
    startTimer: null,
    lastSentState: {}, // conversationId -> "start" | "stop"
    lastSentAt: {}, // conversationId -> timestamp
  });
  const pendingRoomSendsRef = useRef({});
  /** Idempotent: messageIds we've sent MESSAGE_DELIVERED_CONFIRM for (DM only). */
  const clientAckSentRef = useRef(new Set());
  /** B2: Pending outbox when send() returns false; flushed on HELLO_ACK with max retries. */
  const pendingOutboxRef = useRef([]);
  /** B2: Single active flush timer to avoid overlapping flush chains. */
  const flushTimerRef = useRef(null);
  /** B2: After RATE_LIMIT_WARNING, slow down outbox flush (ms until we allow normal rate again). */
  const rateLimitWarningUntilRef = useRef(0);
  /** Phase 4: Debounce rate-limit toasts (max one per 2s). */
  const lastRateLimitToastAtRef = useRef(0);
  const lastReconnectingToastAtRef = useRef(0);
  const RATE_LIMIT_TOAST_DEBOUNCE_MS = 2000;
  const RECONNECTING_TOAST_DEBOUNCE_MS = 5000;
  const OUTBOX_MAX_RETRIES = 3;
  const OUTBOX_DELAY_MS = 200;
  const OUTBOX_SLOW_DELAY_MS = 2000;
  const flushPendingOutboxRef = useRef(() => {});
  /** React 18 Strict Mode: avoid disconnecting on fake unmount (mount→cleanup→mount). Defer disconnect so remount cancels it. */
  const wsEffectRunIdRef = useRef(0);
  const prevAuthRef = useRef(false);
  /** Phase 2: roomIds we've already requested ROOM_INFO+ROOM_MEMBERS for (avoid duplicate requests). */
  const requestedRoomInfoRef = useRef(new Set());
  /** Phase 3: current conversation id for WS handler (avoid stale closure). */
  const activeConversationIdRef = useRef(null);
  const loadChatsRef = useRef(() => {});
  const loadChatsReqIdRef = useRef(0);
  const loadChatsInFlightRef = useRef(false);
  /** Per loadChats run: avoid duplicate /api/users/:id requests for the same userId in one run. */
  const loadChatsHydrationRequestedRef = useRef(new Set());
  const loadMessagesRef = useRef(() => {});
  /** Phase 3: Notification cooldown per conversation (1 notification per 2 seconds). */
  const notifyCooldownRef = useRef({});
  /** Phase 3: isReplaying ref for WS handler (avoid stale closure). */
  const isReplayingRef = useRef(false);
  /** ROOM_MESSAGE: when we add a new message (not exists), hold preview to update lastMessagePreviews after setState. */
  const roomPreviewPendingRef = useRef(null);
  /** ROOM_MESSAGE: when we add a new message and should increment unread (room not active, sender !== me), hold { roomConversationId, roomMessageId } to increment once after setState (dedupe by messageId). */
  const roomUnreadPendingRef = useRef(null);
  /** Per-conversation last persisted read cursor (DM only); skip POST if same cursor. */
  const lastPersistedReadCursorRef = useRef({});
  /** When opening a DM with no messages yet, hold chat id so we persist cursor once history loads. */
  const pendingReadAfterHydrationRef = useRef(null);
  /** DEV: log markChatRead failure once per (conversationId, messageId) to avoid spam. */
  const failedMarkReadLogRef = useRef(new Set());
  /** Debounced mark-read when new message arrives in active conversation (DM). Timer + pending conversationId/messageId. */
  const markReadOnNewMessagePendingRef = useRef({ timer: null, conversationId: null, messageId: null });
  /** Dedupe unread increment by messageId: avoid counting the same message twice (duplicate WS/replay). Keys: "conversationId:messageId". */
  const unreadIncrementedForRef = useRef(new Set());
  /** Self-heal INVALID_LAST_MESSAGE_ID: clear bad lastSeen, no toast, skip MESSAGE_REPLAY for this connection (reset on HELLO_ACK). */
  const invalidLastSeenRecoveredRef = useRef(false);
  /** Ref mirror of usersById so loadChats can read latest without depending on usersById (breaks dependency loop). */
  const usersByIdRef = useRef(usersById);
  useEffect(() => {
    usersByIdRef.current = usersById;
  }, [usersById]);

  /** Phase 3: Keep refs in sync for WS handler (avoid stale closure). */
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  /** Best-effort persist read cursor via POST /api/chats/:chatId/read (DM only). Non-blocking; guard to avoid spam. Declared here so the useEffect below can use it (avoid TDZ). */
  const persistReadCursor = useCallback(async (conversationId, latestMessageId) => {
    if (!conversationId || latestMessageId == null) return;
    const id = typeof latestMessageId === "string" ? latestMessageId : String(latestMessageId);
    if (!id.trim()) return;
    const normalizedId = normalizeConversationId(conversationId);
    if (!normalizedId.startsWith("direct:")) return;
    const last = lastPersistedReadCursorRef.current[normalizedId];
    if (last === id) return;
    try {
      const result = await markChatRead(normalizedId, id);
      if (result?.ok) lastPersistedReadCursorRef.current[normalizedId] = id;
    } catch (e) {
      if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
        const key = `${normalizedId}:${id}`;
        if (!failedMarkReadLogRef.current.has(key)) {
          failedMarkReadLogRef.current.add(key);
          if (import.meta.env.DEV) console.warn("[markChatRead] persist failed", normalizedId, e?.message);
        }
      }
    }
  }, []);

  /** One-shot: when chat was opened with empty list, persist read cursor once messages load. */
  useEffect(() => {
    const activeId = activeConversationId;
    if (!activeId || !activeId.startsWith("direct:")) return;
    if (pendingReadAfterHydrationRef.current !== activeId) return;
    const list = messagesByConversation[activeId] || [];
    if (list.length === 0) return;
    const me = getAuthState().user?.id ?? getAuthState().user?.userId;
    if (!me) return;
    const fromOther = list.filter((m) => m.senderId && String(m.senderId) !== String(me));
    const latestMessage = fromOther.length > 0 ? fromOther[fromOther.length - 1] : list[list.length - 1];
    const latestMessageId = latestMessage?.messageId || latestMessage?.id;
    if (!latestMessageId) return;
    pendingReadAfterHydrationRef.current = null;
    void persistReadCursor(activeId, latestMessageId);
    if (wsClient.isReady()) wsClient.sendMessageRead(latestMessageId);
  }, [activeConversationId, messagesByConversation, persistReadCursor]);

  /** Phase 3: Set directory hydrating when auth transitions to authenticated (so UI shows loading until ROOMS_SNAPSHOT/ROOM_LIST_RESPONSE). */
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      if (!prevAuthRef.current) setIsDirectoryHydrating(true);
      prevAuthRef.current = true;
    } else {
      prevAuthRef.current = false;
    }
  }, [isAuthenticated, authLoading]);

  /** PRESENCE_PING: interval is in wsClient (one per connection, 60s); cleared on WS close. One-off on HELLO_ACK below. */

  /** B5.2 / U3: Load users directory for DM picker. GET /api/users. Runs once when auth is ready; stable deps only so profile/avatar edits do not refetch. */
  useEffect(() => {
    if (!isAuthenticated || authLoading) return;
    if (authUser?.id == null) return;
    apiFetch("/api/users")
      .then((res) => {
        const data = res?.data ?? res;
        const list = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
        const arr = list.map((u) => {
          const id = u.id ?? u.userId;
          const displayName = u.displayName ?? u.username ?? String(id).slice(0, 8);
          const username = u.username ?? u.email ?? "";
          return {
            id,
            username,
            displayName,
            avatarUrl: u.avatarUrl ?? null,
            avatarInitials: (displayName || username || id).slice(0, 2).toUpperCase(),
            avatarColor: "bg-primary/10 text-primary",
          };
        });
        setUsers(arr);
        const byId = {};
        arr.forEach((u) => { byId[u.id] = u; });
        setUsersById(byId);
      })
      .catch((err) => {
        setUsers([]);
        setUsersById({});
        const status = err?.status ?? err?.code;
        const isAuth = status === 401 || status === 403 || err?.name === "UnauthorizedError";
        const msg = status === 403 ? "Access denied to people list" : isAuth ? "Please sign in again" : (err?.message || "Could not load people list");
        toast({ title: "People list", description: msg, variant: isAuth ? "destructive" : "destructive" });
      });
  }, [isAuthenticated, authLoading, authUser?.id]);

  useEffect(() => {
    typingExpireRef.current = setInterval(() => {
      const now = Date.now();
      const expireMs = 4000;
      setTypingByChatId((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [chatId, entry] of Object.entries(next)) {
          if (entry?.sinceTs && now - entry.sinceTs > expireMs) {
            delete next[chatId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (typingExpireRef.current) clearInterval(typingExpireRef.current);
    };
  }, []);

  /** Phase 1: Timeout pending SENDING messages so spinner does not run forever (e.g. after reconnect). */
  const SENDING_TIMEOUT_MS = 15000;
  useEffect(() => {
    const t = setInterval(() => {
      setMessagesByConversation((prev) => {
        const now = Date.now();
        let next = prev;
        for (const [chatId, list] of Object.entries(prev)) {
          const updated = list.map((m) => {
            if ((m.status === "sending" || m.state === "sending") && m.createdAt) {
              const created = typeof m.createdAt === "number" ? m.createdAt : new Date(m.createdAt).getTime();
              if (now - created >= SENDING_TIMEOUT_MS) {
                return { ...m, status: "failed", errorMessage: "No response. Tap to retry." };
              }
            }
            return m;
          });
          if (updated.some((m, i) => m !== list[i])) {
            next = { ...next, [chatId]: updated };
          }
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => [], []);
  const roomsList = useMemo(() => roomIds.map((id) => ({ id, ...roomsById[id] })).filter((r) => r.id), [roomIds, roomsById]);
  const connectionStatus = wsConnectionStatus;
  const presenceUsers = useMemo(() => presenceByUserId, [presenceByUserId]);

  /**
   * Phase 3: Check if we should notify for a conversation (cooldown: 1 notification per 500ms per chat).
   * @param {string} conversationId
   * @returns {boolean}
   */
  const NOTIFY_COOLDOWN_MS = 500;
  function shouldNotify(conversationId) {
    const now = Date.now();
    const last = notifyCooldownRef.current[conversationId] || 0;
    if (now - last < NOTIFY_COOLDOWN_MS) return false;
    notifyCooldownRef.current[conversationId] = now;
    return true;
  }

  const mergeMessageReceiveRef = useRef((msg) => {
    // Phase 3: Deterministic DM merge - single source of truth
    const senderId = String(msg.senderId || "");
    const recipientId = String(msg.recipientId || "");
    if (!senderId || !recipientId) {
      return;
    }

    // Compute chatId ONLY as: direct:<min>:<max> — PHASE D: WS always writes to direct:*, never dm-*
    const [minId, maxId] = [senderId, recipientId].sort();
    const chatId = `direct:${minId}:${maxId}`;

    const me = getAuthState().user;
    const meId = me?.id ? String(me.id) : null;
    if (!meId) {
      return; // Cannot process without current user
    }

    // Determine otherUserId for apiChats injection
    const otherUserId = senderId === meId ? recipientId : senderId;

    // Client ACK for DM (only if we are recipient and not replay)
    if (!msg.isReplay && recipientId === meId) {
      const mid = msg.messageId;
      if (mid && !clientAckSentRef.current.has(mid)) {
        clientAckSentRef.current.add(mid);
        wsClient.sendMessageDeliveredConfirm(mid);
      }
    }

    updateLastSeenMessageId(msg.messageId);

    const isActiveConversation = activeConversationIdRef.current === chatId;
    const timestamp = msg.timestamp ?? Date.now();

    // Upsert by identity: replace existing (e.g. optimistic by clientMessageId) or append; then sort by createdAt
    setMessagesByConversation((prev) => {
      const list = prev[chatId] || [];
      const incoming = normalizeMessage({
        id: msg.messageId,
        messageId: msg.messageId,
        clientMessageId: msg.clientMessageId,
        senderId: msg.senderId,
        recipientId,
        content: msg.content,
        createdAt: timestamp,
        state: msg.state,
      });
      
      // PROMPT 1: Dedupe by messageId/clientMessageId - merge fields instead of replacing
      const idx = list.findIndex((m) => sameMessageIdentity(m, incoming));
      const wasReplaced = idx >= 0;
      
      let nextList;
      if (idx >= 0) {
        // Merge existing message with incoming (preserve existing fields, prefer server fields)
        const existing = list[idx];
        const serverId = incoming.messageId ?? incoming.id ?? existing.messageId ?? existing.id;
        const merged = { ...existing, ...incoming, id: serverId, messageId: serverId };
        nextList = list.map((m, i) => i === idx ? merged : m);
      } else {
        // Append new message (no duplicate found)
        nextList = [...list, incoming];
      }
      
      const ts = (m) => m.createdAt ?? m.timestamp ?? 0;
      nextList.sort((a, b) => ts(a) - ts(b));
      
      // Hard deduplication: remove ALL duplicates by messageId/clientMessageId (newest wins)
      const seenServerIds = new Set();
      const seenClientIds = new Set();
      const dedupedList = [];
      const droppedDuplicates = [];
      
      // Iterate from end to start so newest messages win
      for (let i = nextList.length - 1; i >= 0; i--) {
        const m = nextList[i];
        const serverId = m.messageId || m.id || m.roomMessageId;
        const clientId = m.clientMessageId || m.clientMsgId;
        
        // Check if this message is a duplicate by serverId (strongest) or clientId
        let shouldDrop = false;
        if (serverId && seenServerIds.has(String(serverId))) {
          shouldDrop = true;
        } else if (clientId && seenClientIds.has(String(clientId))) {
          shouldDrop = true;
        }
        
        if (shouldDrop) {
          droppedDuplicates.push({ serverId: serverId || null, clientId: clientId || null, index: i });
        } else {
          // Mark both IDs as seen to catch future duplicates
          if (serverId) seenServerIds.add(String(serverId));
          if (clientId) seenClientIds.add(String(clientId));
          dedupedList.unshift(m); // Prepend to maintain order
        }
      }
      
      nextList = dedupedList;
      return { ...prev, [chatId]: nextList };
    });

    // Phase 3: Notifications for incoming DM messages (not replay, not from self)
    // Policy: play sound when incoming + shouldNotify, and (conversation not active OR (active and tab focused)).
    if (!msg.isReplay) {
      const isIncoming = recipientId === meId && senderId !== meId;
      if (isIncoming) {
        const isActive = activeConversationIdRef.current === chatId;
        const prefs = getUiPrefs();
        const text = (msg.content ?? "").toString().trim();
        const hasText = text.length > 0;
        const messageType = (msg.messageType || "text").toLowerCase();
        const isNonTextMessage = messageType !== "text";
        const canNotifyContent = hasText || isNonTextMessage;
        const notifTitle = hasText ? text.slice(0, 120) : "New message";
        const notifBody = hasText ? "" : "You received a message";
        const cooldownOk = shouldNotify(chatId);
        const tabFocused = isTabFocused();
        const notifMode = prefs.desktopNotificationMode ?? "background_only";
        const desktopModeOk =
          notifMode === "always" ||
          (notifMode === "when_not_active" && !isActive) ||
          (notifMode === "background_only" && isBackgrounded());

        const allowSound =
          prefs.soundNotifications &&
          (!isActive || tabFocused) &&
          cooldownOk;

        if (allowSound) {
          playMessageSound();
        }
        if (cooldownOk && prefs.desktopNotifications && canNotifyContent && desktopModeOk) {
          showDesktopNotification({
            title: notifTitle,
            body: notifBody,
            tag: chatId,
            data: { chatId },
            onClick: () => {
              window.location.href = "/chat";
            },
          });
        }
      }
    }

    // Phase 4: Update history cursor separately so loadMessages does not overwrite newer realtime messages
    setHistoryCursor((prevCursor) => {
      const current = prevCursor[chatId];
      return {
        ...prevCursor,
        [chatId]: {
          ...current,
          latestKnownMessageId: msg.messageId,
        },
      };
    });

    // Always update lastMessagePreviews and lastActivityTimestamps
    setLastMessagePreviews((prev) => ({
      ...prev,
      [chatId]: {
        content: msg.content || "",
        timestamp: timestamp,
        senderId: msg.senderId,
      },
    }));

    setLastActivityTimestamps((prev) => ({
      ...prev,
      [chatId]: timestamp,
    }));

    // Invariant: active conversation unread must stay 0; do not increment when conversationId === activeConversationId. Dedupe by messageId to avoid duplicate increments.
    const isRecipient = recipientId === meId;
    const isReplayMsg = !!msg.isReplay;
    const unreadKey = msg.messageId ? `${chatId}:${msg.messageId}` : null;
    const alreadyCounted = unreadKey != null && unreadIncrementedForRef.current.has(unreadKey);
    const shouldIncrementUnread = !isActiveConversation && isRecipient && !isReplayMsg && !alreadyCounted;
    if (shouldIncrementUnread && unreadKey) unreadIncrementedForRef.current.add(unreadKey);
    setUnreadCounts((prevUnread) => {
      const currentUnread = Math.max(0, prevUnread[chatId] || 0);
      const newUnreadCount = isActiveConversation ? 0 : (shouldIncrementUnread ? currentUnread + 1 : currentUnread);
      return { ...prevUnread, [chatId]: Math.max(0, newUnreadCount) };
    });
    // Optimistic update only: inject minimal chat row if apiChats doesn't include this chatId. No refetch — we already updated unreadCounts, lastMessagePreviews, lastActivityTimestamps above.
    setApiChats((prevChats) => {
      const exists = prevChats.some((c) => c.chatId === chatId);
      if (exists) return prevChats;
      return [
        ...prevChats,
        {
          chatId,
          type: "direct",
          participants: [otherUserId],
          unreadCount: shouldIncrementUnread ? 1 : 0,
          fromApi: false,
          lastMessage: {
            content: msg.content || "",
            timestamp: timestamp,
            senderId: msg.senderId,
          },
        },
      ];
    });
    // Ensure the other user is in usersById so the new DM row appears in the sidebar (directChats filters by usersById).
    ensureUserInStoreRef.current?.(otherUserId);

    // When active conversation is open and a new message arrives: schedule mark-read (debounced) so backend stays in sync; local unread already 0.
    if (isActiveConversation && isRecipient && !msg.isReplay && msg.messageId && scheduleMarkConversationReadRef.current) {
      scheduleMarkConversationReadRef.current(chatId, msg.messageId);
    }
  });

  /** WS: React effect owns connect/disconnect on auth boundary. Connect only when isAuthenticated && !authLoading; cleanup disconnects (deferred so remount doesn't thrash). */
  useEffect(() => {
    const authReady = isAuthenticated === true && authLoading === false;
    if (!authReady) return;
    const wsEnabled = import.meta.env.VITE_ENABLE_WS !== "false";
    if (!wsEnabled) return;
    wsEffectRunIdRef.current += 1;
    const thisEffectRunId = wsEffectRunIdRef.current;
    if (wsSubRef.current) {
      wsSubRef.current();
      wsSubRef.current = null;
    }
    wsClient.clearShutdown?.(); // Phase 5: allow connect() after previous logout
    wsSubRef.current = wsClient.subscribe({
      onStatus: (s) => {
        setWsConnectionStatus(s);
        if (s === "disconnected") {
          setWsReady(false);
          // Phase 3: Do NOT clear roomsById, apiChats, lastMessagePreviews, unreadCounts, roomUnreadCounts
          // so the sidebar does not flicker (disappear/reappear). Only wsReady/connectionStatus change.
        }
      },
      handleMessage: (msg) => {
        if (msg.type === "DM_MESSAGE" || msg.type === "MESSAGE") msg.type = "MESSAGE_RECEIVE";
        if (msg.type === "WS_AUTH_FAILED") {
          if (wsClient.isShutdown?.()) return; // Phase 5: already logged out, no toast
          if (!getAuthState().user) return; // already logged out
          showToast(TOAST_KIND.CRITICAL, { title: "WebSocket auth failed", description: "Please login again" });
          return;
        }
        if (msg.type === "WS_DISCONNECTED_RECONNECTING") {
          const now = Date.now();
          if (now - lastReconnectingToastAtRef.current >= RECONNECTING_TOAST_DEBOUNCE_MS) {
            lastReconnectingToastAtRef.current = now;
            toast({ title: "Disconnected", description: "Reconnecting...", variant: "default" });
          }
          return;
        }
        if (msg.type === "WS_ACCOUNT_SUSPENDED" || (msg.type === "ERROR" && msg.code === "ACCOUNT_SUSPENDED")) {
          if (wsClient.isShutdown?.()) return; // already handling
          showToast(TOAST_KIND.CRITICAL, { title: "Account suspended", description: "Your account has been suspended." });
          wsClient.shutdown?.("account_suspended");
          if (typeof authLogout === "function") authLogout();
          return;
        }
        if (msg.type === "HELLO_ACK") {
          invalidLastSeenRecoveredRef.current = false;
          setWsReady(true);
          setIsDirectoryHydrating(true);
          wsClient.sendRoomList(false);
          const lastSeen = getLastSeenMessageId();
          wsClient.sendResume(lastSeen);
          if (wsClient.sendPresencePing) wsClient.sendPresencePing({ status: "online" });
          if (typeof flushPendingOutboxRef.current === "function") flushPendingOutboxRef.current();
          return;
        }
        if (msg.type === "ROOMS_SNAPSHOT" && Array.isArray(msg.rooms)) {
          setIsDirectoryHydrating(false);
          const byId = {};
          const ids = [];
          msg.rooms.forEach((r) => {
            const id = r?.id ?? r?.roomId;
            if (id) {
              byId[id] = { id, name: r.name, thumbnailUrl: r.thumbnailUrl, memberCount: r.memberCount, myRole: r.myRole, version: r.version ?? 0, updatedAt: r.updatedAt ?? 0 };
              ids.push(id);
            }
          });
          setRoomsById(byId);
          setRoomIds(ids);
          setRolesByRoom(() => {
            const next = {};
            ids.forEach((rid) => { next[rid] = byId[rid]?.myRole ?? "MEMBER"; });
            return next;
          });
          setMembersByRoomId((prev) => {
            const next = { ...prev };
            ids.forEach((rid) => { if (!(rid in next)) next[rid] = { members: [], roles: {} }; });
            Object.keys(next).forEach((rid) => { if (!ids.includes(rid)) delete next[rid]; });
            return next;
          });
          return;
        }
        if (msg.type === "RESYNC_START") {
          setIsReplaying(true);
          return;
        }
        if (msg.type === "RESYNC_COMPLETE" || msg.type === "MESSAGE_REPLAY_COMPLETE") {
          setIsReplaying(false);
          return;
        }
        if (msg.type === "STATE_SYNC_RESPONSE") {
          const deliveredIds = msg.deliveredMessageIds ?? msg.deliveredIds ?? [];
          const readIds = msg.readMessageIds ?? msg.readIds ?? [];
          if (Array.isArray(deliveredIds) && deliveredIds.length > 0) {
            deliveredIds.forEach((id) => updateMessageStatusRef.current(id, "delivered", true));
          }
          if (Array.isArray(readIds) && readIds.length > 0) {
            readIds.forEach((id) => updateMessageStatusRef.current(id, "read", true));
          }
          if (msg.presence != null) {
            const p = msg.presence;
            const me = getAuthState().user?.id;
            if (me && typeof p === "object" && p !== null) {
              const ts = p.lastSeen ?? p.timestamp ?? Date.now();
              setPresenceByUserId((prev) => {
                const existing = prev[me];
                const existingTs = existing?.updatedAt ?? existing?.lastSeen ?? 0;
                if (existing && ts < existingTs) return prev; // don't let initial/sync overwrite newer realtime
                return {
                  ...prev,
                  [me]: { status: p.status ?? "offline", lastSeen: p.lastSeen ?? null, online: (p.status ?? "offline") === "online", updatedAt: ts },
                };
              });
            }
          }
          if (msg.hasMoreMessages && msg.undeliveredCount > 0) {
            wsClient.sendMessageReplay(getLastSeenMessageId());
          }
          return;
        }
        if (msg.type === "MESSAGE_ACK" && (msg.clientMessageId != null || msg.clientMsgId != null) && msg.message) {
          const cid = msg.clientMessageId ?? msg.clientMsgId;
          const m = msg.message;
          const chatId = toDirectIdFromUsers(m.senderId, m.recipientId);
          if (chatId) replaceMessageRef.current(chatId, cid, { ...m, status: m.state ?? "sent" });
        } else if (msg.type === "MESSAGE_ACK" && (msg.clientMessageId != null || msg.clientMsgId != null) && !msg.message) {
          const cid = msg.clientMessageId ?? msg.clientMsgId;
          setMessagesByConversation((prev) => {
            const next = { ...prev };
            for (const [chatId, list] of Object.entries(next)) {
              const idx = list.findIndex((m) => String(m.id) === String(cid));
              if (idx >= 0) {
                next[chatId] = list.map((m, i) => i === idx ? { ...m, id: msg.messageId ?? m.id, status: "sent" } : m);
                break;
              }
            }
            return next;
          });
        } else if (msg.type === "MESSAGE_ACK" && msg.messageId != null && msg.state != null) {
          updateMessageStatusRef.current(msg.messageId, msg.state);
        } else if (msg.type === "DELIVERY_STATUS" && msg.messageId != null) {
          const status = msg.status;
          if (status === "DELIVERED") {
            updateMessageStatusRef.current(msg.messageId, "delivered", true);
          } else if (status === "SEEN") {
            updateMessageStatusRef.current(msg.messageId, "read", true);
          } else if (status === "RECIPIENT_OFFLINE") {
            setMessagesByConversation((prev) => {
              const next = { ...prev };
              const mid = String(msg.messageId);
              for (const [chatId, list] of Object.entries(next)) {
                const found = list.some((m) => String(m.id) === mid || String(m.messageId) === mid);
                if (found) {
                  next[chatId] = list.map((m) =>
                    String(m.id) === mid || String(m.messageId) === mid ? { ...m, deliveryStatus: "offline" } : m
                  );
                  break;
                }
              }
              return next;
            });
          }
        } else if (msg.type === "MESSAGE_STATE_UPDATE" && (msg.messageId != null || msg.roomMessageId != null) && msg.state != null) {
          const id = msg.messageId ?? msg.roomMessageId;
          const status = normalizeMessageState(msg.state) ?? msg.state;
          updateMessageStatusRef.current(id, status, false, msg.roomMessageId ?? msg.messageId);
        } else if (msg.type === "ROOM_DELIVERY_UPDATE" && msg.roomMessageId != null) {
          const rid = String(msg.roomMessageId);
          const deliveredCount = msg.deliveredCount ?? 0;
          const totalCount = msg.totalCount ?? 0;
          setRoomDeliveryByRoomMessageId((prev) => ({
            ...prev,
            [rid]: {
              deliveredCount,
              totalCount,
            },
          }));
        } else if (msg.type === "ACK_RESPONSE" && (msg.messageId != null || msg.roomMessageId != null) && msg.state != null) {
          const id = msg.messageId ?? msg.roomMessageId;
          updateMessageStatusRef.current(id, msg.state, false, msg.roomMessageId ?? msg.messageId);
        } else if (msg.type === "MESSAGE_READ" && (msg.messageId != null || msg.roomMessageId != null)) {
          const readState = msg.state || "read";
          const id = msg.messageId ?? msg.roomMessageId;
          updateMessageStatusRef.current(id, readState, false, msg.roomMessageId ?? msg.messageId);
          
          // PHASE 3: Confirm lastReadMessageId when backend acknowledges MESSAGE_READ
          if (msg.messageId && !msg.roomMessageId) {
            // DM only (not room)
            const chatId = msg.chatId || (msg.senderId && msg.recipientId ? toDirectIdFromUsers(msg.senderId, msg.recipientId) : null);
            if (chatId) {
              setLastReadMessageIdByConversation((prev) => {
                const current = prev[chatId];
                // Never reset backwards - only update if new messageId is >= current
                if (!current) {
                  return { ...prev, [chatId]: msg.messageId };
                }
                // Check message order in current conversation
                const list = messagesByConversation[chatId] || [];
                const currentIndex = list.findIndex((m) => {
                  const msgId = m.messageId || m.id;
                  return msgId && String(msgId) === String(current);
                });
                const newIndex = list.findIndex((m) => {
                  const msgId = m.messageId || m.id;
                  return msgId && String(msgId) === String(msg.messageId);
                });
                if (newIndex >= currentIndex || currentIndex === -1) {
                  return { ...prev, [chatId]: msg.messageId };
                }
                return prev;
              });
            }
          }
        } else if (msg.type === "MESSAGE_RECEIVE") {
          mergeMessageReceiveRef.current(msg);
        } else if (msg.type === "MESSAGE_MUTATION" && msg.messageId) {
          const messageId = msg.messageId;
          const action = msg.action;
          const incomingEditedAt = msg.editedAt != null ? Number(msg.editedAt) : null;
          const incomingDeletedAt = msg.deletedAt != null ? Number(msg.deletedAt) : null;
          let patch = {};
          if (action === "edit") {
            patch = {
              content: msg.content ?? undefined,
              editedAt: msg.editedAt ?? null,
              deleted: false,
              deletedAt: null,
            };
          } else if (action === "delete") {
            patch = {
              deleted: true,
              deletedAt: msg.deletedAt ?? Date.now(),
            };
          }
          if (Object.keys(patch).length > 0) {
            setMessagesByConversation((prev) => {
              const next = { ...prev };
              for (const [chatId, list] of Object.entries(next)) {
                const match = (m) =>
                  String(m.id) === String(messageId) || String(m.messageId) === String(messageId);
                if (!list.some(match)) continue;
                next[chatId] = list.map((m) => {
                  if (!match(m)) return m;
                  if (action === "edit") {
                    const existingEditedAt = m.editedAt != null ? Number(m.editedAt) : null;
                    if (existingEditedAt != null && incomingEditedAt != null && incomingEditedAt < existingEditedAt) return m;
                  }
                  if (action === "delete") {
                    if (m.deleted === true && m.deletedAt != null && incomingDeletedAt != null && incomingDeletedAt < m.deletedAt) return m;
                  }
                  return { ...m, ...patch };
                });
              }
              return next;
            });
          }
        } else if (msg.type === "MESSAGE_MUTATION_ACK" && msg.success === false) {
          const messageId = msg.messageId;
          const code = msg.code || "UNKNOWN";
          showToast(TOAST_KIND.ERROR, {
            title: msg.action === "edit" ? "Edit failed" : "Delete failed",
            description: code === "FORBIDDEN" ? "Not allowed" : code === "NOT_FOUND" ? "Message not found" : code,
          });
          setMessagesByConversation((prev) => {
            let chatIdToReload = null;
            for (const [chatId, list] of Object.entries(prev)) {
              const match = (m) =>
                String(m.id) === String(messageId) || String(m.messageId) === String(messageId);
              if (list.some(match)) {
                chatIdToReload = chatId;
                break;
              }
            }
            if (chatIdToReload) setTimeout(() => loadMessagesRef.current?.(chatIdToReload), 0);
            return prev;
          });
        } else if (msg.type === "MESSAGE_ERROR" || msg.type === "MESSAGE_NACK" || msg.type === "ERROR") {
          const normalized = normalizeBackendError({ code: msg.code, error: msg.error, message: msg.message, details: msg.details });
          const code = normalized.code || "";
          if (code === "INVALID_LAST_MESSAGE_ID") {
            clearLastSeenMessageId();
            invalidLastSeenRecoveredRef.current = true;
            return;
          }
          const errMsg = normalized.message ?? msg.message ?? msg.error ?? "Request failed";
          if (code === "INVALID_TRANSITION" && msg.messageId) {
            scheduleReadRetryRef.current(msg.messageId);
            return;
          }
          const nackClientId = msg.clientMessageId ?? msg.clientMsgId;
          if (nackClientId) {
            setMessagesByConversation((prev) => {
              const next = { ...prev };
              for (const [chatId, list] of Object.entries(next)) {
                const found = list.some((m) => String(m.id) === String(nackClientId));
                if (found) {
                  next[chatId] = list.map((m) =>
                    String(m.id) === String(nackClientId) ? { ...m, status: "failed", errorCode: code || "UNKNOWN_ERROR", errorMessage: errMsg } : m
                  );
                  break;
                }
              }
              return next;
            });
          } else {
            const me = getAuthState().user?.id;
            if (me) {
              let latest = null;
              let latestChatId = null;
              setMessagesByConversation((prev) => {
                for (const [chatId, list] of Object.entries(prev)) {
                  const sending = list.filter((m) => (m.status === "sending" || m.state === "sending") && String(m.senderId) === String(me));
                  const last = sending[sending.length - 1];
                  if (last) {
                    const lastTs = last.createdAt ? new Date(last.createdAt).getTime() : 0;
                    const curTs = latest?.createdAt ? new Date(latest.createdAt).getTime() : 0;
                    if (!latest || lastTs >= curTs) {
                      latest = last;
                      latestChatId = chatId;
                    }
                  }
                }
                if (latest && latestChatId) {
                  const next = { ...prev };
                  next[latestChatId] = (prev[latestChatId] || []).map((m) =>
                    String(m.id) === String(latest.id) ? { ...m, status: "failed", errorCode: code || "UNKNOWN_ERROR", errorMessage: errMsg } : m
                  );
                  return next;
                }
                return prev;
              });
            }
          }
          if (normalized.severity === "auth") {
            showToast(TOAST_KIND.CRITICAL, { title: "Session expired", description: errMsg });
          } else if (code === "RATE_LIMIT_EXCEEDED" || code === "RATE_LIMITED") {
            const now = Date.now();
            if (now - lastRateLimitToastAtRef.current >= RATE_LIMIT_TOAST_DEBOUNCE_MS) {
              lastRateLimitToastAtRef.current = now;
              showToast(TOAST_KIND.WARNING, { title: "Rate limit", description: errMsg }, { variant: "default" });
            }
            rateLimitWarningUntilRef.current = Math.max(rateLimitWarningUntilRef.current, wsClient.getRateLimitUntil?.() ?? 0);
          } else if (code !== "INVALID_TRANSITION") {
            if (msg.messageId && !msg.clientMessageId && (code === "NOT_AUTHORIZED" || code === "ROOM_READ_NOT_SUPPORTED")) return;
            showToast(TOAST_KIND.ERROR, { title: "Error", description: errMsg });
          }
        } else if (msg.type === "RATE_LIMIT_WARNING") {
          rateLimitWarningUntilRef.current = Math.max(rateLimitWarningUntilRef.current, wsClient.getRateLimitUntil?.() ?? Date.now() + 10000);
          const now = Date.now();
          if (now - lastRateLimitToastAtRef.current >= RATE_LIMIT_TOAST_DEBOUNCE_MS) {
            lastRateLimitToastAtRef.current = now;
            const remaining = msg.remaining ?? "?";
            showToast(TOAST_KIND.WARNING, { title: "Rate limit", description: `Slow down. ${remaining} messages left in this minute.` });
          }
        } else if (msg.type === "TYPING_START" || msg.type === "TYPING_STOP") {
          const me = getAuthState().user?.id;
          const typistUserId = msg.userId;
          const ts = msg.timestamp ?? Date.now();
          if (!me || !typistUserId) return;
          if (msg.roomId) {
            const chatId = `room:${msg.roomId}`;
            if (msg.type === "TYPING_START") {
              setTypingByChatId((prev) => {
                const cur = prev[chatId] ?? { userIds: [], sinceTs: ts };
                const userIds = Array.isArray(cur.userIds) ? [...cur.userIds] : cur.userId ? [cur.userId] : [];
                if (!userIds.includes(typistUserId)) userIds.push(typistUserId);
                return { ...prev, [chatId]: { userIds, sinceTs: cur.sinceTs ?? ts } };
              });
            } else {
              setTypingByChatId((prev) => {
                const cur = prev[chatId];
                if (!cur) return prev;
                const userIds = Array.isArray(cur.userIds) ? cur.userIds.filter((u) => u !== typistUserId) : [];
                if (userIds.length === 0) {
                  const next = { ...prev };
                  delete next[chatId];
                  return next;
                }
                return { ...prev, [chatId]: { userIds, sinceTs: cur.sinceTs } };
              });
            }
          } else {
            const chatId = toDirectIdFromUsers(me, typistUserId);
            if (!chatId) return;
            if (msg.type === "TYPING_START") {
              setTypingByChatId((prev) => ({
                ...prev,
                [chatId]: { userId: typistUserId, userIds: [typistUserId], sinceTs: ts },
              }));
            } else {
              setTypingByChatId((prev) => {
                const next = { ...prev };
                delete next[chatId];
                return next;
              });
            }
          }
        } else if (msg.type === "PRESENCE_SNAPSHOT" && msg.users) {
          setPresenceByUserId((prev) => {
            const next = { ...prev };
            for (const [uid, p] of Object.entries(msg.users)) {
              const snapshotTs = p?.timestamp ?? msg?.timestamp ?? Date.now();
              const existing = prev[uid];
              const existingTs = existing?.updatedAt ?? existing?.lastSeen ?? 0;
              if (existing && snapshotTs < existingTs) continue; // don't overwrite newer realtime with older snapshot
              const status = p?.status ?? "offline";
              next[uid] = { status, lastSeen: p?.lastSeen ?? snapshotTs, online: status === "online", updatedAt: snapshotTs };
            }
            return next;
          });
        } else if (msg.type === "PRESENCE_UPDATE" && msg.userId) {
          const ts = msg.timestamp ?? Date.now();
          const status = msg.status ?? "offline";
          setPresenceByUserId((prev) => {
            const existing = prev[msg.userId];
            const existingTs = existing?.updatedAt ?? existing?.lastSeen ?? 0;
            if (existing && ts < existingTs) return prev; // ignore older event (e.g. stale OFFLINE after ONLINE)
            return {
              ...prev,
              [msg.userId]: { status, lastSeen: ts, online: status === "online", updatedAt: ts },
            };
          });
        } else if (msg.type === "PRESENCE_PONG" && msg.userId) {
          const ts = msg.timestamp ?? Date.now();
          const status = msg.status ?? "online";
          setPresenceByUserId((prev) => {
            const existing = prev[msg.userId];
            const existingTs = existing?.updatedAt ?? existing?.lastSeen ?? 0;
            if (existing && ts < existingTs) return prev;
            return {
              ...prev,
              [msg.userId]: { status, lastSeen: ts, online: status === "online", updatedAt: ts },
            };
          });
        } else if (msg.type === "USER_UPDATED" && msg.userId) {
          const userId = msg.userId;
          const displayName = msg.displayName ?? undefined;
          setUsersById((prev) => {
            const existing = prev[userId];
            const next = { ...prev };
            next[userId] = {
              ...existing,
              id: userId,
              username: existing?.username ?? userId,
              displayName: displayName !== undefined ? displayName : (existing?.displayName ?? userId),
              avatarUrl: msg.avatarUrl === null ? null : (msg.avatarUrl ?? existing?.avatarUrl ?? null),
              avatarInitials: ((displayName !== undefined ? displayName : existing?.displayName) || existing?.username || userId).slice(0, 2).toUpperCase(),
              avatarColor: existing?.avatarColor ?? "bg-primary/10 text-primary",
              updatedAt: msg.updatedAt ?? existing?.updatedAt ?? Date.now(),
            };
            return next;
          });
          setUsers((prev) =>
            prev.map((u) =>
              u.id === userId
                ? {
                    ...u,
                    displayName: displayName !== undefined ? displayName : u.displayName,
                    avatarUrl: msg.avatarUrl === null ? null : (msg.avatarUrl ?? u.avatarUrl ?? null),
                    avatarInitials: ((displayName !== undefined ? displayName : u.displayName) || u.username || userId).slice(0, 2).toUpperCase(),
                    updatedAt: msg.updatedAt ?? u.updatedAt ?? Date.now(),
                  }
                : u
            )
          );
        } else if (msg.type === "SYSTEM_CAPABILITIES" || msg.type === "CONNECTION_ESTABLISHED") {
          // no-op (capabilities/connection established)
        } else if (msg.type === "ROOM_LIST_RESPONSE" && msg.success && Array.isArray(msg.rooms)) {
          setIsDirectoryHydrating(false);
          const byId = {};
          const ids = [];
          msg.rooms.forEach((r) => {
            const id = r?.id ?? r?.roomId;
            if (id) {
              byId[id] = { id, name: r.name, thumbnailUrl: r.thumbnailUrl, memberCount: r.memberCount, myRole: r.myRole, version: r.version ?? 0, updatedAt: r.updatedAt ?? 0 };
              ids.push(id);
            }
          });
          setRoomsById(byId);
          setRoomIds(ids);
          setRolesByRoom((prev) => {
            const next = { ...prev };
            ids.forEach((rid) => { next[rid] = byId[rid]?.myRole ?? "MEMBER"; });
            return next;
          });
        } else if (msg.type === "ROOM_CREATED" && msg.room) {
          const room = msg.room;
          const id = room.id ?? room.roomId;
          if (id) {
            const meta = room.meta ?? {};
            setRoomsById((prev) => ({ ...prev, [id]: { id, name: meta.name, thumbnailUrl: meta.thumbnailUrl, memberCount: (room.members || []).length, members: room.members, roles: room.roles, version: room.version, updatedAt: room.updatedAt } }));
            setMembersByRoomId((prev) => ({ ...prev, [id]: { members: room.members ?? [], roles: room.roles ?? {} } }));
            setRoomIds((prev) => {
              if (prev.includes(id)) return prev;
              queueMicrotask(() => {
                setActiveConversationIdState(`room:${id}`);
                setActiveGroupIdState(id);
              });
              return [id, ...prev];
            });
          }
        } else if (msg.type === "ROOM_UPDATED" && msg.roomId) {
          const incomingVersion = msg.version ?? 0;
          setRoomsById((prev) => {
            const cur = prev[msg.roomId];
            if (cur != null && (cur.version ?? 0) >= incomingVersion) return prev;
            return { ...prev, [msg.roomId]: { ...(cur || {}), id: msg.roomId, ...msg.patch, version: incomingVersion, updatedAt: msg.updatedAt ?? 0 } };
          });
        } else if (msg.type === "ROOM_MEMBERS_UPDATED" && msg.roomId) {
          const incomingVersion = msg.version ?? 0;
          const me = getAuthState().user?.id;
          const membersList = msg.members ?? [];
          const iAmMember = me && Array.isArray(membersList) && membersList.some((id) => String(id) === String(me));
          if (!iAmMember) {
            setRoomIds((prev) => prev.filter((id) => id !== msg.roomId));
            setRoomsById((prev) => { const next = { ...prev }; delete next[msg.roomId]; return next; });
            setMembersByRoomId((prev) => { const next = { ...prev }; delete next[msg.roomId]; return next; });
            setRolesByRoom((prev) => { const next = { ...prev }; delete next[msg.roomId]; return next; });
            setActiveConversationIdState((prev) => (prev === `room:${msg.roomId}` ? null : prev));
            setActiveGroupIdState((prev) => (prev === msg.roomId ? null : prev));
            return;
          }
          setRoomsById((prev) => {
            const cur = prev[msg.roomId];
            if (cur != null && (cur.version ?? 0) >= incomingVersion) return prev;
            const meta = {
              ...(msg.name !== undefined && { name: msg.name }),
              ...(msg.thumbnailUrl !== undefined && { thumbnailUrl: msg.thumbnailUrl }),
            };
            return { ...prev, [msg.roomId]: { ...(cur || {}), id: msg.roomId, version: incomingVersion, updatedAt: msg.updatedAt ?? 0, ...meta } };
          });
          setMembersByRoomId((prev) => ({ ...prev, [msg.roomId]: { members: membersList, roles: msg.roles ?? {} } }));
          setRoomIds((prev) => (prev.includes(msg.roomId) ? prev : [...prev, msg.roomId]));
          setRolesByRoom((prev) => {
            const myRole = (msg.roles && me && msg.roles[me]) ? msg.roles[me] : (prev[msg.roomId] ?? "MEMBER");
            return { ...prev, [msg.roomId]: myRole };
          });
          // If payload had no room name (e.g. old backend), resolve meta immediately so name appears without refresh.
          if (msg.roomId && msg.name == null && !requestedRoomInfoRef.current.has(msg.roomId)) {
            requestedRoomInfoRef.current.add(msg.roomId);
            wsClient.sendRoomInfo(msg.roomId);
          }
        } else if (msg.type === "ROOM_DELETED" && msg.roomId) {
          setRoomIds((prev) => prev.filter((id) => id !== msg.roomId));
          setRoomsById((prev) => { const next = { ...prev }; delete next[msg.roomId]; return next; });
          setMembersByRoomId((prev) => { const next = { ...prev }; delete next[msg.roomId]; return next; });
          setRolesByRoom((prev) => { const next = { ...prev }; delete next[msg.roomId]; return next; });
          setActiveConversationIdState((prev) => (prev === `room:${msg.roomId}` ? null : prev));
          setActiveGroupIdState((prev) => (prev === msg.roomId ? null : prev));
        } else if (msg.type === "ROOM_INFO_RESPONSE" && msg.success && msg.roomId && msg.roomInfo) {
          setRoomsById((prev) => ({ ...prev, [msg.roomId]: { id: msg.roomId, ...msg.roomInfo } }));
          if (Array.isArray(msg.members)) {
            setMembersByRoomId((prev) => ({ ...prev, [msg.roomId]: msg.members }));
          }
        } else if (msg.type === "ROOM_MEMBERS_RESPONSE" && msg.success && msg.roomId && Array.isArray(msg.members)) {
          setMembersByRoomId((prev) => ({ ...prev, [msg.roomId]: msg.members }));
        } else if (msg.type === "ROOM_MEMBER_JOINED" && msg.roomId && msg.userId) {
          setMembersByRoomId((prev) => {
            const list = prev[msg.roomId] || [];
            if (list.includes(msg.userId)) return prev;
            return { ...prev, [msg.roomId]: [...list, msg.userId] };
          });
        } else if (msg.type === "ROOM_MEMBER_LEFT" && msg.roomId && msg.userId) {
          setMembersByRoomId((prev) => {
            const list = prev[msg.roomId] || [];
            const next = list.filter((id) => id !== msg.userId);
            return { ...prev, [msg.roomId]: next };
          });
        } else if (msg.type === "ROOM_MESSAGE" && msg.roomId && msg.roomMessageId && msg.senderId) {
          if (msg.messageId) updateLastSeenMessageId(msg.messageId);
          const roomConversationId = `room:${msg.roomId}`;
          const me = getAuthState().user?.id;
          const meId = me != null ? String(me) : "";
          // Unread: increment only once per NEW message, when room is NOT active and sender is NOT self (see "not exists" branch + roomUnreadPendingRef below).

          // Phase 3: Notifications for incoming room messages (not replay, not from self)
          // Policy: play sound when incoming + shouldNotify, and (conversation not active OR (active and tab focused)).
          if (!isReplayingRef.current) {
            const me = getAuthState().user?.id;
            const meId = me ? String(me) : "";
            const senderId = String(msg.senderId || "");
            const isIncoming = senderId !== meId;
            if (isIncoming) {
              const isActive = activeConversationIdRef.current === roomConversationId;
              const prefs = getUiPrefs();
              const text = (msg.content ?? "").toString().trim();
              const hasText = text.length > 0;
              const messageType = (msg.messageType || "text").toLowerCase();
              const isNonTextMessage = messageType !== "text";
              const canNotifyContent = hasText || isNonTextMessage;
              const notifTitle = hasText ? text.slice(0, 120) : "New message";
              const notifBody = hasText ? "" : "You received a message";
              const cooldownOk = shouldNotify(roomConversationId);
              const tabFocused = isTabFocused();
              const notifMode = prefs.desktopNotificationMode ?? "background_only";
              const desktopModeOk =
                notifMode === "always" ||
                (notifMode === "when_not_active" && !isActive) ||
                (notifMode === "background_only" && isBackgrounded());

              const allowSound =
                prefs.soundNotifications &&
                (!isActive || tabFocused) &&
                cooldownOk;

              if (allowSound) {
                playMessageSound();
              }
              if (cooldownOk && prefs.desktopNotifications && canNotifyContent && desktopModeOk) {
                showDesktopNotification({
                  title: notifTitle,
                  body: notifBody,
                  tag: roomConversationId,
                  data: { roomId: msg.roomId },
                  onClick: () => {
                    window.location.href = "/chat";
                  },
                });
              }
            }
          }

          setMessagesByConversation((prev) => {
            const list = prev[roomConversationId] || [];
            const exists = list.some((x) =>
              String(x.roomMessageId || x.id) === String(msg.roomMessageId) ||
              (msg.messageId && String(x.messageId || x.id) === String(msg.messageId))
            );
            if (exists) return prev;
            const isRoomActive = activeConversationIdRef.current === roomConversationId;
            const isFromOther = String(msg.senderId || "") !== meId;
            if (!isRoomActive && isFromOther) {
              roomUnreadPendingRef.current = { roomConversationId, roomMessageId: msg.roomMessageId ?? msg.messageId };
            }
            const messageType = (msg.messageType || "text").toLowerCase();
            let previewContent = "";
            if (messageType === "image") {
              previewContent = "[image]";
            } else if (messageType === "file") {
              previewContent = "[file]";
            } else if (messageType !== "text") {
              previewContent = "[message]";
            } else {
              const raw = msg.content != null ? String(msg.content).trim() : "";
              previewContent = raw || "New message";
            }
            if (previewContent.length > 200) previewContent = previewContent.slice(0, 200);
            roomPreviewPendingRef.current = {
              roomConversationId,
              content: previewContent,
              timestamp: msg.timestamp ?? Date.now(),
              senderId: msg.senderId ?? null,
            };
            const normalized = {
              id: msg.roomMessageId,
              roomMessageId: msg.roomMessageId,
              messageId: msg.messageId,
              roomId: msg.roomId,
              senderId: msg.senderId,
              content: msg.content,
              createdAt: msg.timestamp,
              status: "delivered",
              messageType: msg.messageType || "text",
            };
            return { ...prev, [roomConversationId]: [...list, normalized] };
          });
          if (roomPreviewPendingRef.current) {
            const pending = roomPreviewPendingRef.current;
            roomPreviewPendingRef.current = null;
            setLastMessagePreviews((prev) => ({
              ...prev,
              [pending.roomConversationId]: {
                content: pending.content,
                timestamp: pending.timestamp,
                senderId: pending.senderId,
              },
            }));
          }
          if (roomUnreadPendingRef.current) {
            const pending = roomUnreadPendingRef.current;
            roomUnreadPendingRef.current = null;
            const cid = pending.roomConversationId ?? pending;
            const roomMsgId = typeof pending === "object" && pending != null ? pending.roomMessageId : null;
            const roomUnreadKey = roomMsgId != null ? `${cid}:${roomMsgId}` : null;
            const roomAlreadyCounted = roomUnreadKey != null && unreadIncrementedForRef.current.has(roomUnreadKey);
            if (roomUnreadKey && !roomAlreadyCounted) unreadIncrementedForRef.current.add(roomUnreadKey);
            const shouldIncrementRoom = activeConversationIdRef.current !== cid && !roomAlreadyCounted;
            // Invariant: active conversation unread must stay 0. Guard: unread never negative. Dedupe by roomMessageId.
            setRoomUnreadCounts((prev) => ({ ...prev, [cid]: activeConversationIdRef.current === cid ? 0 : (shouldIncrementRoom ? Math.max(0, (prev[cid] || 0) + 1) : Math.max(0, prev[cid] || 0)) }));
          }
        } else if (msg.type === "ROOM_MESSAGE_RESPONSE" && msg.roomId) {
          const roomConversationId = `room:${msg.roomId}`;
          const pending = pendingRoomSendsRef.current[msg.roomId] || [];
          const head = pending[0];
          const clientMessageId = head?.clientMessageId;
          const roomMessageId = msg.roomMessageId;
          if (msg.success && roomMessageId && head) {
            pendingRoomSendsRef.current[msg.roomId] = pending.slice(1);
            setMessagesByConversation((prev) => {
              const list = prev[roomConversationId] || [];
              const optimisticIdx = list.findIndex((m) => String(m.id) === String(clientMessageId));
              const optimisticExists = optimisticIdx >= 0;
              // Dedupe: ROOM_MESSAGE broadcast may have already inserted server message. If so, remove optimistic only; do not convert (avoids duplicate id => key collision + +2 unread).
              const serverAlreadyExists = list.some(
                (m) =>
                  String(m.roomMessageId || m.id) === String(roomMessageId) ||
                  (m.messageId && msg.messageId && String(m.messageId) === String(msg.messageId))
              );
              if (serverAlreadyExists && optimisticExists) {
                return {
                  ...prev,
                  [roomConversationId]: list.filter((m) => String(m.id) !== String(clientMessageId)),
                };
              }
              if (!serverAlreadyExists && optimisticExists) {
                const existing = list[optimisticIdx];
                const reconciled = {
                  ...existing,
                  id: roomMessageId,
                  roomMessageId,
                  messageId: msg.messageId ?? existing.messageId,
                  roomId: msg.roomId,
                  content: msg.content ?? existing.content,
                  createdAt: msg.timestamp ?? existing.createdAt,
                  status: "sent",
                  messageType: existing.messageType || "text",
                };
                return {
                  ...prev,
                  [roomConversationId]: list.map((m) =>
                    String(m.id) === String(clientMessageId) ? reconciled : m
                  ),
                };
              }
              return prev;
            });
          } else if (!msg.success) {
            if (head) {
              pendingRoomSendsRef.current[msg.roomId] = pending.slice(1);
              setMessagesByConversation((prev) => {
                const list = prev[roomConversationId] || [];
                return {
                  ...prev,
                  [roomConversationId]: list.map((m) =>
                    String(m.id) === String(head.clientMessageId) ? { ...m, status: "failed" } : m
                  ),
                };
              });
            }
            const err = msg.error || toUserMessage(msg.code) || "Send failed";
            toast({ title: "Room message failed", description: err, variant: "destructive" });
          }
        } else if (msg.type === "ROOM_CREATE_RESPONSE") {
          if (msg.success && msg.roomId) {
            const room = { roomId: msg.roomId, name: msg.name ?? msg.roomId, memberCount: 1 };
            setRoomsById((prev) => ({ ...prev, [msg.roomId]: room }));
            setRoomIds((prev) => (prev.includes(msg.roomId) ? prev : [...prev, msg.roomId]));
            setActiveConversationIdState(`room:${msg.roomId}`);
            setActiveGroupIdState(msg.roomId);
            wsClient.sendRoomMembers(msg.roomId);
          } else {
            const err = msg.error || toUserMessage(msg.code) || "Create failed";
            toast({ title: "Room create failed", description: err, variant: "destructive" });
          }
        } else if (msg.type === "ROOM_JOIN_RESPONSE") {
          if (msg.success && msg.roomId) {
            if (msg.roomInfo) {
              setRoomsById((prev) => ({ ...prev, [msg.roomId]: { ...msg.roomInfo } }));
            }
            if (Array.isArray(msg.members)) {
              setMembersByRoomId((prev) => ({ ...prev, [msg.roomId]: [...msg.members] }));
            }
            setRoomIds((prev) => (prev.includes(msg.roomId) ? prev : [...prev, msg.roomId]));
            setActiveConversationIdState(`room:${msg.roomId}`);
            setActiveGroupIdState(msg.roomId);
            wsClient.sendRoomList();
          } else {
            const err = msg.error || toUserMessage(msg.code) || "Join failed";
            toast({ title: "Join room failed", description: err, variant: "destructive" });
          }
        } else if (msg.type === "ROOM_LEAVE_RESPONSE") {
          if (msg.success && msg.roomId) {
            setRoomIds((prev) => prev.filter((id) => id !== msg.roomId));
            setRoomsById((prev) => {
              const next = { ...prev };
              delete next[msg.roomId];
              return next;
            });
            setMembersByRoomId((prev) => {
              const next = { ...prev };
              delete next[msg.roomId];
              return next;
            });
            setActiveConversationIdState((prev) => (prev === `room:${msg.roomId}` ? null : prev));
            setActiveGroupIdState((prev) => (prev === msg.roomId ? null : prev));
            wsClient.sendRoomList();
          } else {
            const err = msg.error || toUserMessage(msg.code) || "Leave failed";
            toast({ title: "Leave room failed", description: err, variant: "destructive" });
          }
        }
        // MESSAGE_REPLAY_COMPLETE, PONG, HELLO_ACK: no-op
      },
    });
    wsClient.connect();
    return () => {
      if (wsSubRef.current) wsSubRef.current();
      const effectRunIdAtCleanup = thisEffectRunId;
      setTimeout(() => {
        if (wsEffectRunIdRef.current === effectRunIdAtCleanup) wsClient.disconnect();
      }, 0);
    };
  }, [isAuthenticated, authLoading]);

  /** Phase 2: Safety net — if wsReady but roomIds still empty after 800ms, request ROOM_LIST again. */
  useEffect(() => {
    if (!wsReady) return;
    const t = setTimeout(() => {
      if ((roomIds?.length ?? 0) === 0) wsClient.sendRoomList(false);
    }, 800);
    return () => clearTimeout(t);
  }, [wsReady, roomIds?.length]);

  /** Phase 2: When selected group has no snapshot (e.g. after refresh), request ROOM_INFO + ROOM_MEMBERS so header has data. */
  useEffect(() => {
    if (!wsReady || !activeGroupId) return;
    if (roomsById[activeGroupId] != null) return;
    if (requestedRoomInfoRef.current.has(activeGroupId)) return;
    requestedRoomInfoRef.current.add(activeGroupId);
    wsClient.sendRoomInfo(activeGroupId);
    wsClient.sendRoomMembers(activeGroupId);
  }, [wsReady, activeGroupId, roomsById]);

  const setActiveGroupId = useCallback((id) => {
    setActiveGroupIdState(id);
    setActiveDmUserState(null);
    setActiveConversationIdState(null);
  }, []);
  /**
   * PHASE B: Set active DM user. Always uses canonical direct:<min>:<max> conversationId.
   * This ensures UI reads from the same bucket WS writes to (direct:*, never dm-*).
   */
  const setActiveDmUser = useCallback((userId) => {
    setActiveDmUserState(userId);
    setActiveGroupIdState(null);
    const me = authUser?.id ?? authUser?.userId ?? null;
    if (userId && me) {
      // PHASE B: Always use canonical direct:<min>:<max> format (matches WS merge key)
      const canonicalId = toDirectIdFromUsers(me, userId);
      setActiveConversationIdState(canonicalId);
    } else {
      setActiveConversationIdState(null);
    }
  }, [authUser?.id, authUser?.userId]);

  /** When active conversation is open and a new message arrives: schedule mark-read (WS + HTTP) with debounce 200–500ms so UI stays 0 and backend stays in sync across devices. */
  const MARK_READ_DEBOUNCE_MS = 300;
  const scheduleMarkConversationReadRef = useRef((conversationId, messageId) => {});
  const scheduleMarkConversationRead = useCallback((conversationId, messageId) => {
    if (!conversationId || messageId == null) return;
    const normalizedId = normalizeConversationId(conversationId);
    if (!normalizedId.startsWith("direct:")) return;
    const pending = markReadOnNewMessagePendingRef.current;
    if (pending.timer) clearTimeout(pending.timer);
    pending.conversationId = normalizedId;
    pending.messageId = messageId;
    pending.timer = setTimeout(() => {
      pending.timer = null;
      const cid = pending.conversationId;
      const mid = pending.messageId;
      pending.conversationId = null;
      pending.messageId = null;
      if (cid && mid && wsClient.isReady()) {
        wsClient.sendMessageRead(mid);
        void persistReadCursor(cid, mid);
      }
    }, MARK_READ_DEBOUNCE_MS);
  }, [persistReadCursor]);
  useEffect(() => {
    scheduleMarkConversationReadRef.current = scheduleMarkConversationRead;
  }, [scheduleMarkConversationRead]);

  /**
   * PHASE B: Set active conversation. Normalizes dm-* to direct:* for backward compatibility,
   * but DM selection should use setActiveDmUser() or pass canonical direct:* IDs directly.
   */
  /** setActiveConversation(id): sets activeConversationId and enforces invariant (unreadCount[id] = 0 for open conversation). */
  const setActiveConversationId = useCallback((chatId) => {
    if (typeof chatId !== "string") return;
    // PHASE B: Normalize dm-* to canonical direct:* (backward compat, but prefer canonical IDs)
    const normalizedId = normalizeConversationId(chatId);
    const prefix = normalizedId + ":";
    const toDelete = [];
    unreadIncrementedForRef.current.forEach((key) => { if (key.startsWith(prefix)) toDelete.push(key); });
    toDelete.forEach((key) => unreadIncrementedForRef.current.delete(key));
    if (normalizedId.startsWith("room:")) {
      // Invariant: set active conversation unread to 0 when opening (setActiveConversation).
      setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
      setActiveConversationIdState(normalizedId);
      setActiveGroupIdState(normalizedId.slice(5));
      setActiveDmUserState(null);
      return;
    }
    if (normalizedId.startsWith("direct:")) {
      const me = authUser?.id ?? authUser?.userId ?? null;
      const parts = normalizedId.slice(7).split(":");
      const other = parts.length >= 2 && me ? (parts[0] === String(me) ? parts[1] : parts[0]) : null;
      
      // PHASE 3: Optimistically set lastReadMessageId to latest visible message when opening conversation
      const list = messagesByConversation[normalizedId] || [];
      if (list.length > 0 && me) {
        // Find latest message from other user (or latest overall if no messages from others)
        const fromOther = list.filter((m) => m.senderId && String(m.senderId) !== String(me));
        const latestMessage = fromOther.length > 0 ? fromOther[fromOther.length - 1] : list[list.length - 1];
        const latestMessageId = latestMessage?.messageId || latestMessage?.id;
        
        if (latestMessageId) {
          setLastReadMessageIdByConversation((prev) => {
            const current = prev[normalizedId];
            // PHASE 3: Never reset lastRead backwards (edge case: history loading)
            if (current) {
              // Check if new messageId is actually newer (by position in sorted list)
              const currentIndex = list.findIndex((m) => {
                const msgId = m.messageId || m.id;
                return msgId && String(msgId) === String(current);
              });
              const newIndex = list.findIndex((m) => {
                const msgId = m.messageId || m.id;
                return msgId && String(msgId) === String(latestMessageId);
              });
              // Only update if new index is >= current index (not backwards)
              if (newIndex >= currentIndex) {
                return { ...prev, [normalizedId]: latestMessageId };
              }
              return prev;
            }
            return { ...prev, [normalizedId]: latestMessageId };
          });
          
          // Invariant: set active conversation unread to 0 when opening (setActiveConversation).
          if (normalizedId.startsWith("direct:")) {
            setUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
          } else if (normalizedId.startsWith("room:")) {
            setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
          }
          
          // PHASE 3: Send MESSAGE_READ WS message to confirm
          if (wsClient.isReady() && latestMessageId) {
            wsClient.sendMessageRead(latestMessageId);
            void persistReadCursor(normalizedId, latestMessageId);
          }
        }
      } else {
        // Invariant: active conversation unread must be 0 when opening (no messages yet).
        if (normalizedId.startsWith("direct:")) {
          setUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
          pendingReadAfterHydrationRef.current = normalizedId;
        } else if (normalizedId.startsWith("room:")) {
          setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
        }
      }

      // PHASE B: Store canonical direct:* ID (matches WS merge key)
      setActiveConversationIdState(normalizedId);
      setActiveDmUserState(other || null);
      setActiveGroupIdState(null);
      return;
    }
    setActiveConversationIdState(normalizedId);
    setActiveGroupIdState(null);
    setActiveDmUserState(null);
  }, [authUser?.id, authUser?.userId, persistReadCursor]);
  const clearUnread = useCallback((chatId) => {
    const normalizedId = normalizeConversationId(chatId);
    const prefix = normalizedId + ":";
    const toDelete = [];
    unreadIncrementedForRef.current.forEach((key) => { if (key.startsWith(prefix)) toDelete.push(key); });
    toDelete.forEach((key) => unreadIncrementedForRef.current.delete(key));
    setUnreadCounts((prev) => {
      const next = { ...prev };
      delete next[normalizedId];
      return next;
    });
    if (normalizedId?.startsWith("room:")) {
      setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
    }
  }, []);
  const updateLastActivity = useCallback((chatId) => {
    const normalizedId = normalizeConversationId(chatId);
    setLastActivityTimestamps((prev) => ({ ...prev, [normalizedId]: Date.now() }));
  }, []);
  /**
   * lastMessagePreviews[chatId] = { content, timestamp, senderId }
   * Never store strings here.
   */
  const setLastMessagePreview = useCallback((chatId, previewObj) => {
    const normalizedId = normalizeConversationId(chatId);
    setLastMessagePreviews((prev) => {
      const incoming = previewObj && typeof previewObj === "object" ? previewObj : null;
      const incomingContent = incoming?.content;
      if (typeof incomingContent !== "string" || incomingContent.trim() === "") return prev;

      const existing = prev?.[normalizedId];
      const existingObj = existing && typeof existing === "object" ? existing : null;

      const nextPreview = {
        content: incomingContent,
        timestamp: incoming?.timestamp ?? existingObj?.timestamp ?? 0,
        senderId: incoming?.senderId ?? existingObj?.senderId ?? null,
      };

      // Avoid churn if nothing changed.
      if (
        existingObj &&
        existingObj.content === nextPreview.content &&
        existingObj.timestamp === nextPreview.timestamp &&
        existingObj.senderId === nextPreview.senderId
      ) {
        return prev;
      }

      return { ...prev, [normalizedId]: nextPreview };
    });
  }, []);
  const setDummyUserOnline = useCallback((userId, online) => {
    setDummyUserOnlineOverrides((prev) => ({ ...prev, [userId]: online }));
  }, []);
  /**
   * PHASE 3: Compute unread count dynamically from messages and lastReadMessageId.
   * Unread = messages from other users after lastReadMessageId.
   * If lastReadMessageId is null, all messages from others are unread.
   */
  const computeUnreadCount = useCallback((conversationId, messages, myUserId, lastReadMessageId) => {
    if (!conversationId || !messages || !Array.isArray(messages) || messages.length === 0) return 0;
    if (!myUserId) return 0;
    
    // Find index of lastReadMessageId in messages (sorted by createdAt)
    let lastReadIndex = -1;
    if (lastReadMessageId) {
      lastReadIndex = messages.findIndex((m) => {
        const msgId = m.messageId || m.id;
        return msgId && String(msgId) === String(lastReadMessageId);
      });
    }
    
    // Count messages from others after lastReadMessageId
    let unread = 0;
    for (let i = lastReadIndex + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.senderId && String(msg.senderId) !== String(myUserId)) {
        unread++;
      }
    }
    
    return unread;
  }, []);

  const incrementUnread = useCallback((chatId) => {
    const normalizedId = normalizeConversationId(chatId);
    setUnreadCounts((prev) => ({ ...prev, [normalizedId]: (prev[normalizedId] || 0) + 1 }));
  }, []);
  const resetAllState = useCallback(() => {
    setActiveGroupIdState(null);
    setActiveDmUserState(null);
    setActiveConversationIdState(null);
    setUnreadCounts({});
    setRoomUnreadCounts({});
    setLastReadMessageIdByConversation({}); // PHASE 3: Reset lastReadMessageId
    setLastActivityTimestamps({});
    setLastMessagePreviews({});
    setDummyUserOnlineOverrides({});
    setSimulatedTypingUser(null);
    setTypingByChatId({});
    setPresenceByUserId({});
    setMessagesByConversation({});
    setApiChats([]);
    setApiChatsError(null);
    setHistoryCursor({});
    setRoomsById({});
    setRoomIds([]);
    setMembersByRoomId({});
    setRolesByRoom({});
    setRoomDeliveryByRoomMessageId({});
    setIsDirectoryHydrating(false);
    clearLastSeenMessageId();
  }, []);

  /** Merge server search results into users/usersById (immutable). Used by sidebar search. */
  const mergeUsersFromSearch = useCallback((usersList) => {
    if (!Array.isArray(usersList) || usersList.length === 0) return;
    const normalized = usersList.map((u) => {
      const id = u.id ?? u.userId;
      const displayName = u.displayName ?? u.username ?? String(id).slice(0, 8);
      const username = u.username ?? "";
      return {
        id,
        username,
        displayName,
        avatarUrl: u.avatarUrl ?? null,
        avatarInitials: (displayName || username || id).slice(0, 2).toUpperCase(),
        avatarColor: u.avatarColor ?? "bg-primary/10 text-primary",
      };
    });
    setUsersById((prev) => {
      const next = { ...prev };
      normalized.forEach((u) => { next[u.id] = u; });
      return next;
    });
    setUsers((prev) => {
      const byId = new Map(prev.map((u) => [u.id, u]));
      normalized.forEach((u) => byId.set(u.id, u));
      return Array.from(byId.values());
    });
  }, []);

  /** Fetch a user by id and merge into usersById so DM rows can show in sidebar. No-op if already present. */
  const ensureUserInStore = useCallback(
    async (userId) => {
      if (!userId || String(userId).startsWith("room_")) return;
      if (usersByIdRef.current[userId]) return;
      try {
        const res = await apiFetch(`/api/users/${encodeURIComponent(userId)}`);
        const data = res?.data ?? res;
        if (data && (data.id || data.userId)) {
          const user = {
            id: data.id ?? data.userId,
            username: data.username ?? "",
            displayName: data.displayName ?? data.username ?? String(data.id ?? data.userId).slice(0, 8),
            avatarUrl: data.avatarUrl ?? null,
            avatarInitials: ((data.displayName ?? data.username ?? String(data.id ?? data.userId)) || "").slice(0, 2).toUpperCase(),
            avatarColor: "bg-primary/10 text-primary",
          };
          mergeUsersFromSearch([user]);
        }
      } catch (_) {
        // ignore; user row may still show after next loadChats
      }
    },
    [mergeUsersFromSearch]
  );
  const ensureUserInStoreRef = useRef(ensureUserInStore);
  ensureUserInStoreRef.current = ensureUserInStore;

  /** Add a direct chat to the list and ensure the other user is in usersById so the sidebar shows it without refresh. */
  const addDirectChat = useCallback(
    (chatId, otherUser) => {
      if (!otherUser || !(otherUser.id ?? otherUser.userId)) return;
      const id = otherUser.id ?? otherUser.userId;
      mergeUsersFromSearch([{ ...otherUser, id: id ?? otherUser.id ?? otherUser.userId }]);
      setApiChats((prev) => {
        if (prev.some((c) => c.chatId === chatId)) return prev;
        return [
          ...prev,
          {
            chatId,
            type: "direct",
            participants: [id],
            fromApi: false,
            lastMessage: null,
          },
        ];
      });
    },
    [mergeUsersFromSearch]
  );

  const loadChats = useCallback(async () => {
    if (!isAuthenticated) return;
    if (loadChatsInFlightRef.current) return;
    loadChatsInFlightRef.current = true;
    const reqId = ++loadChatsReqIdRef.current;
    loadChatsHydrationRequestedRef.current.clear();
    setApiChatsLoading(true);
    setApiChatsError(null);
    try {
      const chats = await getChatsApi();
      if (reqId !== loadChatsReqIdRef.current) return;
      const list = Array.isArray(chats) ? chats : [];
      // PHASE D: Normalize each chat's chatId to direct:* so sidebar unread/preview lookups use same key as store.
      setApiChats(list.map((c) => {
        const canonicalChatId = c.chatId != null ? normalizeConversationId(c.chatId) : c.chatId;
        return { ...c, fromApi: true, chatId: canonicalChatId ?? c.chatId };
      }));
      setUnreadCounts((prev) => {
        const next = { ...prev };
        list.forEach((c) => {
          if (c.chatId != null && typeof c.unreadCount === "number") {
            const normalizedId = normalizeConversationId(c.chatId);
            next[normalizedId] = Math.max(0, c.unreadCount);
            // Don't re-inflate: we already persisted read for this chat this session.
            if (lastPersistedReadCursorRef.current[normalizedId]) next[normalizedId] = 0;
          }
        });
        // Invariant: active conversation unread must stay 0 (e.g. after refresh do not overwrite with API value). Guard: unread never negative.
        const activeId = activeConversationIdRef.current;
        if (activeId) next[activeId] = 0;
        const pendingId = pendingReadAfterHydrationRef.current;
        if (pendingId) next[pendingId] = 0;
        return next;
      });
      setLastMessagePreviews((prev) => {
        let same = true;
        const next = { ...prev };
        list.forEach((c) => {
          const lm = c.lastMessage;
          const content = lm?.content;
          if (c.chatId != null && typeof content === "string" && content.trim() !== "") {
            const normalizedId = normalizeConversationId(c.chatId);
            const isDirectChat =
              typeof normalizedId === "string" &&
              normalizedId.startsWith("direct:") &&
              (c.type === undefined || c.type === "direct");
            if (!isDirectChat) return;
            const incoming = {
              content,
              timestamp: lm?.timestamp ?? 0,
              senderId: lm?.senderId ?? null,
            };
            const existing = next[normalizedId];
            const existingObj = existing && typeof existing === "object" ? existing : null;
            if (
              !existingObj ||
              existingObj.content !== incoming.content ||
              existingObj.timestamp !== incoming.timestamp ||
              existingObj.senderId !== incoming.senderId
            ) {
              next[normalizedId] = incoming;
              same = false;
            }
          }
        });
        return same ? prev : next;
      });
      setLastActivityTimestamps((prev) => {
        let same = true;
        const next = { ...prev };
        list.forEach((c) => {
          const ts = c.lastMessage?.timestamp ?? 0;
          if (c.chatId != null && ts > 0) {
            const normalizedId = normalizeConversationId(c.chatId);
            if ((next[normalizedId] ?? 0) < ts) {
              next[normalizedId] = ts;
              same = false;
            }
          }
        });
        return same ? prev : next;
      });

      // Phase 4: Fetch missing user profiles — only real user IDs, never room_*
      if (reqId !== loadChatsReqIdRef.current) return;
      const me = getAuthState().user?.id ?? getAuthState().user?.userId ?? null;
      const participantIds = new Set();
      list.forEach((c) => {
        if (c.chatId && String(c.chatId).startsWith("direct:")) {
          const parts = String(c.chatId).split(":");
          if (parts.length >= 3 && me) {
            const a = parts[1];
            const b = parts[2];
            const otherId = a === String(me) ? b : a;
            if (otherId && !String(otherId).startsWith("room_")) participantIds.add(otherId);
          }
        }
        if (Array.isArray(c.participants)) {
          c.participants.forEach((id) => {
            if (id && typeof id === "string" && !String(id).startsWith("room_")) participantIds.add(id);
          });
        }
      });
      const currentUsersById = usersByIdRef.current;
      const hydrationRequested = loadChatsHydrationRequestedRef.current;
      const missingIds = Array.from(participantIds).filter(
        (id) => !currentUsersById[id] && !hydrationRequested.has(id)
      );
      missingIds.forEach((id) => hydrationRequested.add(id));
      if (missingIds.length > 0) {
        const fetchPromises = missingIds.slice(0, 20).map(async (userId) => {
          if (!userId) return null;
          if (String(userId).startsWith("room_")) {
            if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
              console.error("[BUG] attempted to fetch user for room id", { someId: userId, context: "ChatAdapterContext user hydration" });
            }
            return null;
          }
          try {
            const res = await apiFetch(`/api/users/${encodeURIComponent(userId)}`);
            const data = res?.data ?? res;
            if (data && (data.id || data.userId)) {
              return {
                id: data.id ?? data.userId,
                username: data.username ?? "",
                displayName: data.displayName ?? data.username ?? String(data.id ?? data.userId).slice(0, 8),
                avatarUrl: data.avatarUrl ?? null,
                avatarInitials: ((data.displayName ?? data.username ?? String(data.id ?? data.userId)) || "").slice(0, 2).toUpperCase(),
                avatarColor: "bg-primary/10 text-primary",
              };
            }
            return null;
          } catch (err) {
            const status = err?.status ?? err?.code;
            if (status !== 404 && import.meta.env.DEV) {
              console.warn(`[loadChats] Failed to fetch user ${userId}:`, err?.message || "Unknown error");
            }
            return null;
          }
        });
        const fetchedUsers = (await Promise.all(fetchPromises)).filter(Boolean);
        if (reqId === loadChatsReqIdRef.current && fetchedUsers.length > 0) {
          mergeUsersFromSearch(fetchedUsers);
        }
      }
    } catch (e) {
      if (reqId === loadChatsReqIdRef.current) {
        setApiChatsError(e?.message || "Failed to load chats");
        setApiChats([]);
        const status = e?.status ?? e?.code;
        if (status === 401 || status === 403) {
          console.error("[loadChats] Auth error:", e?.message);
          toast({ title: "Failed to load chats", description: "Please login again", variant: "destructive" });
        }
      }
    } finally {
      loadChatsInFlightRef.current = false;
      setApiChatsLoading(false);
    }
  }, [isAuthenticated, mergeUsersFromSearch]);

  useEffect(() => {
    loadChatsRef.current = loadChats;
  }, [loadChats]);

  const loadRooms = useCallback(async () => {
    if (!wsClient.isReady()) return;
    try {
      const list = await roomsApi.listRooms();
      const byId = {};
      const ids = [];
      (list || []).forEach((r) => {
        const id = r?.id ?? r?.roomId;
        if (id) {
          byId[id] = { id, name: r.name, thumbnailUrl: r.thumbnailUrl, memberCount: r.memberCount, myRole: r.myRole, version: r.version, updatedAt: r.updatedAt };
          ids.push(id);
        }
      });
      setRoomsById(byId);
      setRoomIds(ids);
      setRolesByRoom((prev) => {
        const next = { ...prev };
        ids.forEach((rid) => { next[rid] = byId[rid]?.myRole ?? "MEMBER"; });
        return next;
      });
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[rooms] loadRooms failed", e?.message || e);
    }
  }, []);

  const requestRoomMembers = useCallback((roomId) => {
    if (!roomId || !wsClient.isReady()) return;
    roomsApi.getRoomInfo(roomId).catch(() => {});
    roomsApi.getRoomMembers(roomId).catch(() => {});
  }, []);

  const createRoom = useCallback(async (payload) => {
    if (!wsClient.isReady()) return null;
    try {
      const room = await roomsApi.createRoom(payload);
      return room;
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[rooms] createRoom failed", e?.message || e);
      return null;
    }
  }, []);

  const joinRoom = useCallback((payload) => {
    if (!wsClient.isReady()) return false;
    return wsClient.sendRoomJoin(payload);
  }, []);

  /** Optimistic upsert: add room to sidebar and set as active (for create/join before server response). */
  const upsertRoomOptimistic = useCallback((roomId, name) => {
    if (!roomId) return;
    const displayName = name ?? roomId;
    setRoomsById((prev) => ({ ...prev, [roomId]: { roomId, name: displayName, memberCount: 1 } }));
    setRoomIds((prev) => (prev.includes(roomId) ? prev : [...prev, roomId]));
    setActiveConversationIdState(`room:${roomId}`);
    setActiveGroupIdState(roomId);
  }, []);

  const leaveRoom = useCallback(async (payload) => {
    if (!wsClient.isReady()) return false;
    try {
      await roomsApi.leaveRoom(payload?.roomId);
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[rooms] leaveRoom failed", e?.message || e);
      return false;
    }
  }, []);

  const sendRoomMessageViaWs = useCallback((roomId, content, clientMessageId) => {
    if (!wsClient.isReady()) return false;
    const sent = wsClient.sendRoomMessage({ roomId, content, clientMessageId, messageType: "text" });
    if (sent) {
      const pending = pendingRoomSendsRef.current[roomId] || [];
      pendingRoomSendsRef.current[roomId] = [...pending, { clientMessageId }];
    }
    return sent;
  }, []);

  const sendOrQueueMessage = useCallback((conversationId, content, clientMessageId, { roomId = null, recipientId = null } = {}) => {
    const rawRoomId = roomId && typeof roomId === "string" ? (roomId.startsWith("room:") ? roomId.slice(5) : roomId.startsWith("group-") ? roomId.slice(7) : roomId) : roomId;
    const isRoom = rawRoomId != null && rawRoomId !== "";
    const isDm = recipientId != null && recipientId !== "";
    let sent = false;
    if (isRoom) {
      sent = sendRoomMessageViaWs(rawRoomId, content, clientMessageId);
    } else if (isDm) {
      if (wsClient.isReady()) {
        sent = wsClient.sendMessage(recipientId, content, clientMessageId);
      }
    } else {
      return false;
    }
    if (sent) return true;
    const item = {
      conversationId,
      clientMessageId,
      content,
      roomId: isRoom ? rawRoomId : null,
      recipientId: isDm ? recipientId : null,
      retryCount: 0,
      addedAt: Date.now(),
    };
    pendingOutboxRef.current = [...pendingOutboxRef.current, item];
    toast({ title: "Message queued", description: "Will send when connected.", variant: "default" });
    return true;
  }, [sendRoomMessageViaWs]);

  const loadMessages = useCallback(async (conversationId, { limit = 50, beforeId } = {}) => {
    // PHASE A3: Normalize to canonical format at message boundary
    const me = getAuthState().user?.id;
    const canonicalId = toCanonicalChatId(conversationId, me);
    assertCanonicalId(canonicalId, `loadMessages(${conversationId})`);
    
    if (canonicalId?.startsWith("room:")) {
      const roomId = canonicalId.slice(5);
      if (!roomsById?.[roomId]) {
        return;
      }
    }
    const serverChatId = getServerConversationId(canonicalId, me);
    setHistoryLoading((prev) => ({ ...prev, [canonicalId]: true }));
    try {
      const { messages, nextCursor, hasMore } = await getHistoryApi(serverChatId, { limit, beforeId });
      // Room: apply deliverySummary from history so refresh reconstructs roomDeliveryByRoomMessageId
      const rawMessages = messages || [];
      const deliverySummariesFromHistory = {};
      rawMessages.forEach((m) => {
        if (m.deliverySummary && typeof m.deliverySummary === 'object' && (m.roomMessageId || m.messageId)) {
          const rid = String(m.roomMessageId || m.messageId);
          deliverySummariesFromHistory[rid] = {
            deliveredCount: m.deliverySummary.deliveredCount ?? 0,
            totalCount: m.deliverySummary.totalCount ?? 0,
          };
        }
      });
      if (Object.keys(deliverySummariesFromHistory).length > 0) {
        setRoomDeliveryByRoomMessageId((prev) => ({ ...prev, ...deliverySummariesFromHistory }));
      }
      const normalized = rawMessages.map(normalizeMessage).filter(Boolean);
      // lastSeen must be canonical messageId because replay uses getMessage(messageId).
      normalized.forEach((m) => m?.messageId && updateLastSeenMessageId(m.messageId));
      // Phase 4 (root-stability): Idempotent merge with stable dedupe key; prefer existing message to preserve delivery state; no unread from history.
      // Stable dedupe key: roomMessageId || messageId || id (same shape for rooms and DMs).
      const getDedupeKey = (m, fallback) => {
        const k = String(m.roomMessageId || m.messageId || m.id || m.clientMessageId || "");
        return k || fallback;
      };
      const mergeMessageState = (existing, incoming) => {
        const exDeleted = existing.deleted === true;
        const inDeleted = incoming.deleted === true;
        if (exDeleted && !inDeleted) return existing;
        if (!exDeleted && inDeleted) return incoming;
        if (exDeleted && inDeleted) {
          const exAt = existing.deletedAt != null ? Number(existing.deletedAt) : 0;
          const inAt = incoming.deletedAt != null ? Number(incoming.deletedAt) : 0;
          return exAt >= inAt ? existing : incoming;
        }
        const exEdit = existing.editedAt != null ? Number(existing.editedAt) : 0;
        const inEdit = incoming.editedAt != null ? Number(incoming.editedAt) : 0;
        return exEdit >= inEdit ? existing : incoming;
      };
      const ts = (x) => (x.createdAt != null && x.createdAt !== "") ? Number(x.createdAt) : (x.timestamp != null ? Number(x.timestamp) : 0);
      setMessagesByConversation((prev) => {
        const existing = prev[canonicalId] || [];
        const byKey = new Map();
        existing.forEach((m, i) => byKey.set(getDedupeKey(m, `e-${i}`), m));
        normalized.forEach((m, i) => {
          const k = getDedupeKey(m, `n-${i}`);
          if (byKey.has(k)) {
            byKey.set(k, mergeMessageState(byKey.get(k), m));
          } else {
            byKey.set(k, m);
          }
        });
        const merged = Array.from(byKey.values());
        merged.sort((a, b) => {
          const ta = ts(a);
          const tb = ts(b);
          if (ta !== tb) return ta - tb;
          const ka = getDedupeKey(a, "");
          const kb = getDedupeKey(b, "");
          return ka.localeCompare(kb, "en");
        });
        return { ...prev, [canonicalId]: merged };
      });
      
      // Phase 4: Preserve latestKnownMessageId when updating cursor
      setHistoryCursor((prev) => {
        const current = prev[canonicalId];
        const latestKnownId = current?.latestKnownMessageId;
        return {
          ...prev,
          [canonicalId]: {
            nextCursor,
            hasMore,
            ...(latestKnownId ? { latestKnownMessageId: latestKnownId } : {}),
          },
        };
      });
    } catch (e) {
      const status = e?.status ?? e?.statusCode;
      const code = e?.data?.code ?? e?.code;
      throw e;
    } finally {
      setHistoryLoading((prev) => ({ ...prev, [canonicalId]: false }));
    }
  }, [roomsById]);

  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);

  /**
   * PHASE 2: Upsert message - if messageId or clientMessageId exists, replace; else append.
   * Prevents duplicate optimistic messages when user sends multiple times quickly.
   */
  const addMessage = useCallback((conversationId, message) => {
    // PHASE A3: Normalize to canonical format at message write boundary
    const me = getAuthState().user?.id;
    const canonicalId = toCanonicalChatId(conversationId, me);
    assertCanonicalId(canonicalId, `addMessage(${conversationId})`);
    setMessagesByConversation((prev) => {
      const list = prev[canonicalId] || [];
      
      // PHASE 2: Check for existing message by messageId or clientMessageId
      const msgId = message.messageId || message.id;
      const clientId = message.clientMessageId;
      const existingIdx = list.findIndex((m) => {
        const mId = m.messageId || m.id;
        const mClientId = m.clientMessageId;
        // Match by server ID or client ID
        return (msgId && mId && String(msgId) === String(mId)) ||
               (clientId && mClientId && String(clientId) === String(mClientId)) ||
               (msgId && mClientId && String(msgId) === String(mClientId)) ||
               (clientId && mId && String(clientId) === String(mId));
      });
      
      if (existingIdx >= 0) {
        // PHASE 2: Replace existing message (optimistic reconciliation)
        const existing = list[existingIdx];
        const merged = {
          ...existing,
          ...message,
          // Preserve server-assigned IDs if they exist
          messageId: message.messageId ?? existing.messageId ?? null,
          id: message.messageId ?? message.id ?? existing.id,
          clientMessageId: clientId ?? existing.clientMessageId,
          // Prefer newer status if both exist
          status: message.status || existing.status,
        };
        return {
          ...prev,
          [canonicalId]: list.map((m, i) => i === existingIdx ? merged : m),
        };
      } else {
        // PHASE 2: Append new message (no duplicate found)
        return { ...prev, [canonicalId]: [...list, message] };
      }
    });
  }, []);

  const editMessage = useCallback((conversationId, messageId, content) => {
    const me = getAuthState().user?.id;
    const canonicalId = toCanonicalChatId(conversationId, me);
    assertCanonicalId(canonicalId, `editMessage(${conversationId})`);
    if (!messageId || content == null) {
      showToast(TOAST_KIND.ERROR, { title: "Edit failed", description: "Message or content missing." });
      return;
    }
    setMessagesByConversation((prev) => {
      const list = prev[canonicalId] || [];
      return {
        ...prev,
        [canonicalId]: list.map((m) =>
          String(m.id) === String(messageId) || String(m.messageId) === String(messageId)
            ? { ...m, content, editedAt: m.editedAt ?? Date.now() }
            : m
        ),
      };
    });
    if (!wsClient.isReady()) {
      showToast(TOAST_KIND.WARNING, { title: "Offline", description: "Edit will sync when connected." });
      loadMessagesRef.current?.(canonicalId);
      return;
    }
    const sent = wsClient.sendMessageEdit(messageId, content);
    if (!sent) {
      showToast(TOAST_KIND.ERROR, { title: "Edit failed", description: "Could not send. Restoring." });
      loadMessagesRef.current?.(canonicalId);
    }
  }, []);

  // B2: Replace optimistic (clientId) with server message; match by id or clientMessageId to prevent duplicates.
  // PHASE A3: Normalize to canonical format at message write boundary
  const replaceMessage = useCallback((conversationId, oldMessageId, newMessage) => {
    const me = getAuthState().user?.id;
    const canonicalId = toCanonicalChatId(conversationId, me);
    assertCanonicalId(canonicalId, `replaceMessage(${conversationId})`);
    const normalized = normalizeMessage(newMessage) || newMessage;
    const serverId = normalized.id ?? newMessage?.messageId ?? newMessage?.id;
    const oldId = String(oldMessageId);
    setMessagesByConversation((prev) => {
      const list = prev[canonicalId] || [];
      return {
        ...prev,
        [canonicalId]: list.map((m) =>
          String(m.id) === oldId || String(m.clientMessageId) === oldId
            ? { ...m, ...normalized, id: serverId ?? m.id, messageId: serverId, status: normalized.status ?? m.status }
            : m
        ),
      };
    });
  }, []);

  const deleteMessage = useCallback((conversationId, messageId) => {
    const me = getAuthState().user?.id;
    const canonicalId = toCanonicalChatId(conversationId, me);
    assertCanonicalId(canonicalId, `deleteMessage(${conversationId})`);
    if (!messageId) {
      showToast(TOAST_KIND.ERROR, { title: "Delete failed", description: "Message missing." });
      return;
    }
    setMessagesByConversation((prev) => {
      const list = prev[canonicalId] || [];
      return {
        ...prev,
        [canonicalId]: list.map((m) =>
          String(m.id) === String(messageId) || String(m.messageId) === String(messageId)
            ? { ...m, deleted: true, deletedAt: m.deletedAt ?? Date.now() }
            : m
        ),
      };
    });
    if (!wsClient.isReady()) {
      showToast(TOAST_KIND.WARNING, { title: "Offline", description: "Delete will sync when connected." });
      loadMessagesRef.current?.(canonicalId);
      return;
    }
    const sent = wsClient.sendMessageDelete(messageId);
    if (!sent) {
      showToast(TOAST_KIND.ERROR, { title: "Delete failed", description: "Could not send. Restoring." });
      loadMessagesRef.current?.(canonicalId);
    }
  }, []);

  const updateMessageStatusByMessageId = useCallback((messageId, status, forceSync = false, alternateId = null) => {
    if (!messageId || !status) return;
    const mid = String(messageId);
    const alt = alternateId != null ? String(alternateId) : null;
    const match = (m) =>
      String(m.id) === mid || String(m.messageId) === mid ||
      (alt && (String(m.id) === alt || String(m.messageId) === alt));
    setMessagesByConversation((prev) => {
      const next = { ...prev };
      let foundChatId = null;
      for (const [chatId, list] of Object.entries(next)) {
        const found = list.some(match);
        if (found) {
          foundChatId = chatId;
          const beforeStatus = list.find(match)?.status;
          const newStatus = forceSync ? status : applyStateUpdateFsm(
            beforeStatus,
            status
          );
          if (!newStatus) return prev;
          next[chatId] = list.map((m) => (match(m) ? { ...m, status: newStatus } : m));
          break;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    replaceMessageRef.current = replaceMessage;
  }, [replaceMessage]);
  useEffect(() => {
    updateMessageStatusRef.current = updateMessageStatusByMessageId;
  }, [updateMessageStatusByMessageId]);

  function flushPendingOutbox() {
    if (!wsClient.isReady()) {
      if (pendingOutboxRef.current.length > 0) {
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushPendingOutboxRef.current();
        }, 500);
      }
      return;
    }
    if (wsClient.isRateLimited?.()) {
      const until = wsClient.getRateLimitUntil?.() ?? 0;
      const delay = Math.max(50, until - Date.now() + 50);
      if (pendingOutboxRef.current.length > 0 && delay < 60000) {
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushPendingOutboxRef.current();
        }, delay);
      }
      return;
    }
    const queue = pendingOutboxRef.current;
    if (!queue.length) return;
    const item = queue[0];
    const delay =
      Date.now() < rateLimitWarningUntilRef.current ? OUTBOX_SLOW_DELAY_MS : OUTBOX_DELAY_MS;
    const backoffMs = Math.min(2000, OUTBOX_DELAY_MS * Math.pow(2, item.retryCount ?? 0));
    const sent = item.roomId
      ? wsClient.sendRoomMessage({
          roomId: item.roomId,
          content: item.content,
          clientMessageId: item.clientMessageId,
          messageType: "text",
        })
      : wsClient.sendMessage(item.recipientId, item.content, item.clientMessageId);
    if (sent) {
      if (item.roomId) {
        const pending = pendingRoomSendsRef.current[item.roomId] || [];
        pendingRoomSendsRef.current[item.roomId] = [...pending, { clientMessageId: item.clientMessageId }];
      }
      pendingOutboxRef.current = queue.slice(1);
    } else {
      item.retryCount = (item.retryCount ?? 0) + 1;
      if (item.retryCount >= OUTBOX_MAX_RETRIES) {
        replaceMessageRef.current(item.conversationId, item.clientMessageId, { status: "failed" });
        pendingOutboxRef.current = queue.slice(1);
      }
    }
    const nextDelay = sent ? delay : backoffMs;
    if (pendingOutboxRef.current.length > 0) {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushPendingOutboxRef.current();
      }, nextDelay);
    }
  }
  useEffect(() => {
    flushPendingOutboxRef.current = flushPendingOutbox;
  });

  const READ_RETRY_DELAYS = [300, 600, 900, 1200, 2000];
  const markAsReadForConversationRef = useRef({
    timer: null,
    lastSent: null,
    lastPersistedByChat: {},
    readRetry: { messageId: null, failures: 0, timer: null },
  });

  const isDeliveredOrRead = useCallback((status) => isDeliveredOrReadFsm(status), []);

  const scheduleReadRetryRef = useRef((messageId) => {
    const r = markAsReadForConversationRef.current.readRetry;
    if (r.timer) clearTimeout(r.timer);
    const failures = r.messageId === messageId ? r.failures + 1 : 0;
    if (failures >= 5) return;
    const delay = READ_RETRY_DELAYS[Math.min(failures, READ_RETRY_DELAYS.length - 1)];
    markAsReadForConversationRef.current.readRetry = {
      messageId,
      failures,
      timer: setTimeout(() => {
        markAsReadForConversationRef.current.readRetry.timer = null;
        wsClient.sendMessageRead(messageId);
      }, delay),
    };
  });

  const markAsReadForConversation = useCallback((conversationId) => {
    // Only DMs: MESSAGE_READ is for DM read receipts; backend requires message.recipientId === userId.
    if (!conversationId || !wsClient.isReady()) return;
    const normalizedId = normalizeConversationId(conversationId);
    if (normalizedId.startsWith("room:")) return;
    const isDm = normalizedId.startsWith("direct:");
    if (!isDm) return;
    const me = getAuthState().user;
    if (!me?.id) return;
    const list = messagesByConversation[normalizedId] || [];
    const fromOther = list.filter((m) => m.senderId !== me.id);
    // PHASE 3: Find latest message from other user (not just unread ones)
    const latest = fromOther.length > 0 ? fromOther[fromOther.length - 1] : null;
    if (!latest?.id) return;
    const latestMessageId = latest.messageId || latest.id;
    const { timer, lastSent } = markAsReadForConversationRef.current;
    if (lastSent === latestMessageId) return;
    if (timer) clearTimeout(timer);

    markAsReadForConversationRef.current.timer = setTimeout(() => {
      markAsReadForConversationRef.current.timer = null;
      const msg = list.find((m) => {
        const msgId = m.messageId || m.id;
        return msgId && String(msgId) === String(latestMessageId);
      });
      if (!msg) return;
      // Never send read for own message; only when we are the recipient (DM). Applies to both WS and POST /read.
      if (String(msg.senderId) === String(me.id)) return;
      if (msg.recipientId != null && String(msg.recipientId) !== String(me.id)) return;
      if (msg.roomId != null || msg.roomMessageId != null) return;

      // Cursor persistence: always call when we have latestMessageId (user has seen chat). Not gated by msg.status.
      const lastPersisted = markAsReadForConversationRef.current.lastPersistedByChat?.[normalizedId];
      if (lastPersisted !== latestMessageId) {
        markAsReadForConversationRef.current.lastPersistedByChat = {
          ...markAsReadForConversationRef.current.lastPersistedByChat,
          [normalizedId]: latestMessageId,
        };
        void persistReadCursor(normalizedId, latestMessageId);
      }
      // WS MESSAGE_READ: only when message is delivered/read (protocol gating unchanged).
      if (isDeliveredOrRead(msg.status)) {
        markAsReadForConversationRef.current.lastSent = latestMessageId;
        wsClient.sendMessageRead(latestMessageId);
      }

      // PHASE 3: Set lastReadMessageId optimistically
      setLastReadMessageIdByConversation((prev) => {
        const current = prev[normalizedId];
        // Never reset backwards
        if (current) {
          const currentIndex = list.findIndex((m) => {
            const msgId = m.messageId || m.id;
            return msgId && String(msgId) === String(current);
          });
          const newIndex = list.findIndex((m) => {
            const msgId = m.messageId || m.id;
            return msgId && String(msgId) === String(latestMessageId);
          });
          if (newIndex >= currentIndex) {
            return { ...prev, [normalizedId]: latestMessageId };
          }
          return prev;
        }
        return { ...prev, [normalizedId]: latestMessageId };
      });

      // PROMPT 2 PART A: Clear unread count when marking as read
      // For DMs: clear unreadCounts
      if (normalizedId.startsWith("direct:")) {
        setUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
      }
      // For rooms: clear roomUnreadCounts (though this function only handles DMs, keeping for consistency)
      if (normalizedId.startsWith("room:")) {
        setRoomUnreadCounts((prev) => ({ ...prev, [normalizedId]: 0 }));
      }
    }, 400);
  }, [messagesByConversation, isDeliveredOrRead, persistReadCursor]);

  /**
   * PHASE 1: Hard dedupe guard - ensures no duplicate messageId in returned list.
   * Deduplicates by messageId (or id as fallback), keeping the most complete version.
   * Prefers messages with delivery/read status, then most recent createdAt.
   */
  const getMessages = useCallback(
    (conversationId) => {
      // PHASE A3: Normalize to canonical format at message read boundary
      const me = getAuthState().user?.id;
      const canonicalId = toCanonicalChatId(conversationId, me);
      assertCanonicalId(canonicalId, `getMessages(${conversationId})`);
      const list = messagesByConversation[canonicalId] || [];
      
      // PHASE 1: Hard dedupe by messageId to prevent React key warnings
      const dedupeMap = new Map();
      let duplicateCount = 0;
      for (const msg of list) {
        const msgId = msg.messageId || msg.id;
        if (!msgId) continue; // Skip messages without ID
        
        const existing = dedupeMap.get(msgId);
        if (!existing) {
          dedupeMap.set(msgId, msg);
        } else {
          duplicateCount++;
          // Merge duplicates: prefer version with more complete status (read > delivered > sent > pending)
          const existingStatus = (existing.status || existing.state || 'pending').toLowerCase();
          const newStatus = (msg.status || msg.state || 'pending').toLowerCase();
          const statusPriority = { read: 3, delivered: 2, sent: 1, pending: 0 };
          const existingPriority = statusPriority[existingStatus] ?? 0;
          const newPriority = statusPriority[newStatus] ?? 0;
          
          let merged;
          if (newPriority > existingPriority) {
            // New has better status -> use new as base, merge any missing fields from existing
            merged = { ...existing, ...msg, messageId: msgId, id: msgId };
          } else if (existingPriority > newPriority) {
            // Existing has better status -> keep existing as base, merge any new fields
            merged = { ...msg, ...existing, messageId: msgId, id: msgId };
          } else {
            // Same status priority -> prefer more recent, merge fields
            const existingTs = existing.createdAt || existing.timestamp || 0;
            const newTs = msg.createdAt || msg.timestamp || 0;
            if (newTs >= existingTs) {
              merged = { ...existing, ...msg, messageId: msgId, id: msgId };
            } else {
              merged = { ...msg, ...existing, messageId: msgId, id: msgId };
            }
          }
          dedupeMap.set(msgId, merged);
        }
      }

      const deduplicated = Array.from(dedupeMap.values());
      return deduplicated.sort((a, b) => {
        const aTs = a.createdAt ? new Date(a.createdAt).getTime() : (a.timestamp || 0);
        const bTs = b.createdAt ? new Date(b.createdAt).getTime() : (b.timestamp || 0);
        return aTs - bTs;
      });
    },
    [messagesByConversation]
  );

  const getRecipientIdFromConversation = useCallback((conversationId) => {
    const me = getAuthState().user?.id;
    if (!me || !conversationId) return null;
    if (conversationId.startsWith("dm-")) return conversationId.replace("dm-", "");
    if (conversationId.startsWith("direct:")) {
      const parts = conversationId.split(":");
      if (parts.length !== 3) return null;
      const a = String(parts[1]);
      const b = String(parts[2]);
      const meStr = String(me);
      return a === meStr ? b : a;
    }
    return null;
  }, []);

  const TYPING_THROTTLE_MS = 400; // P5: min interval between any TYPING_* send per conversation
  const sendTypingIndicator = useCallback((conversationId, isTyping) => {
    if (!wsClient.isReady()) return; // WS-5: do not fire when WS not ready
    // PHASE A3: Normalize to canonical format at typing event boundary
    const me = getAuthState().user?.id;
    const canonicalId = toCanonicalChatId(conversationId, me);
    assertCanonicalId(canonicalId, `sendTypingIndicator(${conversationId})`);
    
    const now = Date.now();
    const r = typingSendRef.current;
    const lastSentAt = r.lastSentAt[canonicalId] ?? 0;
    const lastState = r.lastSentState[canonicalId];
    const state = isTyping ? "start" : "stop";
    if (now - lastSentAt < TYPING_THROTTLE_MS) return; // throttle: no send within 400ms
    if (lastState === state) return; // do not send same typing state twice consecutively

    const rawRoomId = canonicalId?.startsWith("room:") ? canonicalId.slice(5) : null;
    const isRoom = rawRoomId != null && roomIds.includes(rawRoomId);
    if (isRoom) {
      if (r.stopTimer) {
        clearTimeout(r.stopTimer);
        r.stopTimer = null;
      }
      if (isTyping) {
        r.lastStartTs = now;
        wsClient.sendTypingStart({ roomId: rawRoomId });
        r.lastSentState[canonicalId] = "start";
        r.lastSentAt[canonicalId] = now;
        r.stopTimer = setTimeout(() => {
          r.stopTimer = null;
          if (now - (r.lastSentAt[canonicalId] ?? 0) >= TYPING_THROTTLE_MS && r.lastSentState[canonicalId] !== "stop") {
            wsClient.sendTypingStop({ roomId: rawRoomId });
            r.lastSentState[canonicalId] = "stop";
            r.lastSentAt[canonicalId] = Date.now();
          }
        }, 1500);
      } else {
        wsClient.sendTypingStop({ roomId: rawRoomId });
        r.lastSentState[canonicalId] = "stop";
        r.lastSentAt[canonicalId] = now;
      }
      return;
    }
    const recipientId = getRecipientIdFromConversation(canonicalId);
    if (!recipientId) return;
    if (r.stopTimer) {
      clearTimeout(r.stopTimer);
      r.stopTimer = null;
    }
    if (isTyping) {
      r.lastStartTs = now;
      wsClient.sendTypingStart({ targetUserId: recipientId });
      r.lastSentState[canonicalId] = "start";
      r.lastSentAt[canonicalId] = now;
      r.stopTimer = setTimeout(() => {
        r.stopTimer = null;
        const t = Date.now();
        if (t - (r.lastSentAt[canonicalId] ?? 0) >= TYPING_THROTTLE_MS && r.lastSentState[canonicalId] !== "stop") {
          wsClient.sendTypingStop({ targetUserId: recipientId });
          r.lastSentState[canonicalId] = "stop";
          r.lastSentAt[canonicalId] = t;
        }
      }, 1500);
    } else {
      wsClient.sendTypingStop({ targetUserId: recipientId });
      r.lastSentState[canonicalId] = "stop";
      r.lastSentAt[canonicalId] = now;
    }
  }, [roomIds, getRecipientIdFromConversation]);

  const getTypingUserForChat = useCallback(
    (chatId) => {
      const me = getAuthState().user?.id;
      if (!me || !chatId) return null;
      const lookup = isDmId(chatId)
        ? toDirectIdFromUsers(me, chatId.replace("dm-", ""))
        : chatId;
      const entry = typingByChatId[lookup];
      if (!entry) return null;
      if (Array.isArray(entry.userIds) && entry.userIds.length > 0) return entry.userIds[0];
      return entry.userId ?? null;
    },
    [simulatedTypingUser, typingByChatId]
  );

  const getTypingUsersForChat = useCallback(
    (chatId) => {
      const me = getAuthState().user?.id;
      if (!me || !chatId) return [];
      const lookup = isDmId(chatId)
        ? toDirectIdFromUsers(me, chatId.replace("dm-", ""))
        : chatId;
      const entry = typingByChatId[lookup];
      if (!entry) return [];
      if (Array.isArray(entry.userIds) && entry.userIds.length > 0) return entry.userIds;
      if (entry.userId) return [entry.userId];
      return [];
    },
    [typingByChatId]
  );

  const value = useMemo(
    () => ({
      groups,
      connectionStatus,
      presenceUsers,
      messagesByConversation,
      getMessages,
      activeGroupId,
      activeDmUser,
      activeConversationId,
      onlineUsers: new Set(Object.keys(presenceUsers).filter((id) => presenceUsers[id]?.online === true)),
      typingUsers: new Set(),
      simulatedTypingUser,
      typingByChatId,
      getTypingUserForChat,
      getTypingUsersForChat,
      sendTypingIndicator,
      unreadCounts,
      roomUnreadCounts,
      lastReadMessageIdByConversation, // PHASE 3: Export for Sidebar unread computation
      computeUnreadCount, // PHASE 3: Export for Sidebar unread computation
      lastActivityTimestamps,
      lastMessagePreviews,
      dummyUserOnlineOverrides,
      apiChats,
      apiChatsLoading,
      apiChatsError,
      users,
      usersById,
      roomsById,
      roomIds,
      roomsList,
      membersByRoomId,
      rolesByRoom,
      roomDeliveryByRoomMessageId,
      applyRoomDeliverySummaries,
      roomsApi,
      loadRooms,
      requestRoomMembers,
      createRoom,
      joinRoom,
      upsertRoomOptimistic,
      leaveRoom,
      sendRoomMessageViaWs,
      sendOrQueueMessage,
      historyCursor,
      historyLoading,
      isReplaying,
      isDirectoryHydrating,
      setActiveGroupId,
      setActiveDmUser,
      setActiveConversationId,
      scrollToMessageId,
      setScrollToMessageId,
      clearUnread,
      updateLastActivity,
      setLastMessagePreview,
      setDummyUserOnline,
      setSimulatedTypingUser,
      incrementUnread,
      resetAllState,
      loadChats,
      loadMessages,
      mergeUsersFromSearch,
      addDirectChat,
      markAsReadForConversation,
      setMessages: noop,
      addMessage,
      editMessage,
      replaceMessage,
      deleteMessage,
      isWsReady: wsReady,
      sendMessageViaWs: wsClient.sendMessage.bind(wsClient),
      clearMessages: noop,
      pagination: {},
      dispatch: noop,
    }),
    [
      groups,
      presenceUsers,
      messagesByConversation,
      getMessages,
      activeGroupId,
      activeDmUser,
      activeConversationId,
      simulatedTypingUser,
      typingByChatId,
      getTypingUserForChat,
      getTypingUsersForChat,
      sendTypingIndicator,
      unreadCounts,
      roomUnreadCounts,
      lastReadMessageIdByConversation, // PHASE 3: Export for Sidebar unread computation
      computeUnreadCount, // PHASE 3: Export for Sidebar unread computation
      lastActivityTimestamps,
      lastMessagePreviews,
      dummyUserOnlineOverrides,
      apiChats,
      apiChatsLoading,
      apiChatsError,
      users,
      usersById,
      roomsById,
      roomIds,
      roomsList,
      membersByRoomId,
      rolesByRoom,
      roomDeliveryByRoomMessageId,
      applyRoomDeliverySummaries,
      roomsApi,
      loadRooms,
      requestRoomMembers,
      createRoom,
      joinRoom,
      upsertRoomOptimistic,
      leaveRoom,
      sendRoomMessageViaWs,
      sendOrQueueMessage,
      historyCursor,
      historyLoading,
      isReplaying,
      wsReady,
      isDirectoryHydrating,
      setActiveGroupId,
      setActiveDmUser,
      setActiveConversationId,
      scrollToMessageId,
      setScrollToMessageId,
      clearUnread,
      updateLastActivity,
      setLastMessagePreview,
      setDummyUserOnline,
      incrementUnread,
      resetAllState,
    loadChats,
    loadMessages,
    mergeUsersFromSearch,
    addDirectChat,
    loadRooms,
    requestRoomMembers,
      createRoom,
      joinRoom,
      upsertRoomOptimistic,
      leaveRoom,
      sendRoomMessageViaWs,
      markAsReadForConversation,
    addMessage,
      editMessage,
      replaceMessage,
      deleteMessage,
    ]
  );

  return <ChatAdapterContext.Provider value={value}>{children}</ChatAdapterContext.Provider>;
}

export function useChatContext() {
  const ctx = useContext(ChatAdapterContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within ChatAdapterProvider");
  }
  return ctx;
}

/** useChatStore-compatible hook (same API as source + groups/connection/presence/messages for UI). */
export function useChatStore() {
  const ctx = useChatContext();
  return {
    onlineUsers: ctx.onlineUsers,
    getTypingUserForChat: ctx.getTypingUserForChat,
    getTypingUsersForChat: ctx.getTypingUsersForChat,
    sendTypingIndicator: ctx.sendTypingIndicator,
    activeGroupId: ctx.activeGroupId,
    activeDmUser: ctx.activeDmUser,
    activeConversationId: ctx.activeConversationId,
    setActiveGroupId: ctx.setActiveGroupId,
    setActiveDmUser: ctx.setActiveDmUser,
    setActiveConversationId: ctx.setActiveConversationId,
    scrollToMessageId: ctx.scrollToMessageId,
    setScrollToMessageId: ctx.setScrollToMessageId,
    unreadCounts: ctx.unreadCounts,
    roomUnreadCounts: ctx.roomUnreadCounts,
    clearUnread: ctx.clearUnread,
    lastActivityTimestamps: ctx.lastActivityTimestamps,
    lastMessagePreviews: ctx.lastMessagePreviews,
    dummyUserOnlineOverrides: ctx.dummyUserOnlineOverrides,
    setLastMessagePreview: ctx.setLastMessagePreview,
    updateLastActivity: ctx.updateLastActivity,
    setDummyUserOnline: ctx.setDummyUserOnline,
    simulatedTypingUser: ctx.simulatedTypingUser,
    setSimulatedTypingUser: ctx.setSimulatedTypingUser,
    resetAllState: ctx.resetAllState,
    incrementUnread: ctx.incrementUnread,
    setMessages: ctx.setMessages,
    groups: ctx.groups,
    connectionStatus: ctx.connectionStatus,
    presenceUsers: ctx.presenceUsers,
    messagesByConversation: ctx.messagesByConversation,
    apiChats: ctx.apiChats,
    apiChatsLoading: ctx.apiChatsLoading,
    apiChatsError: ctx.apiChatsError,
    users: ctx.users,
    usersById: ctx.usersById,
    roomsById: ctx.roomsById,
    roomIds: ctx.roomIds,
    roomsList: ctx.roomsList,
    membersByRoomId: ctx.membersByRoomId,
    rolesByRoom: ctx.rolesByRoom,
    roomDeliveryByRoomMessageId: ctx.roomDeliveryByRoomMessageId,
    applyRoomDeliverySummaries: ctx.applyRoomDeliverySummaries,
    roomsApi: ctx.roomsApi,
    loadChats: ctx.loadChats,
    loadMessages: ctx.loadMessages,
    mergeUsersFromSearch: ctx.mergeUsersFromSearch,
    addDirectChat: ctx.addDirectChat,
    loadRooms: ctx.loadRooms,
    requestRoomMembers: ctx.requestRoomMembers,
    createRoom: ctx.createRoom,
    joinRoom: ctx.joinRoom,
    upsertRoomOptimistic: ctx.upsertRoomOptimistic,
    leaveRoom: ctx.leaveRoom,
    sendRoomMessageViaWs: ctx.sendRoomMessageViaWs,
    sendOrQueueMessage: ctx.sendOrQueueMessage,
    markAsReadForConversation: ctx.markAsReadForConversation,
    historyCursor: ctx.historyCursor,
    historyLoading: ctx.historyLoading,
    isReplaying: ctx.isReplaying,
    isDirectoryHydrating: ctx.isDirectoryHydrating,
    addMessage: ctx.addMessage,
    editMessage: ctx.editMessage,
    replaceMessage: ctx.replaceMessage,
    deleteMessage: ctx.deleteMessage,
    isWsReady: ctx.isWsReady,
    sendMessageViaWs: ctx.sendMessageViaWs,
  };
}

/** useMessages(conversationId) - returns messages for that conversation. */
export function useMessages(conversationId) {
  const ctx = useChatContext();
  return ctx.getMessages(conversationId);
}
