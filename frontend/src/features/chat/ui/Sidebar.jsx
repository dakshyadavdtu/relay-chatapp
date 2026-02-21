// ============================================================================
// UI ONLY — copy7 layout; Phase 4 wired to compat + groupRoomMapper.
// ============================================================================
import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useAuth, useChatStore, useSettingsStore } from "../adapters";
import { roomsToGroups } from "../adapters/groupRoomMapper";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarSrc, resolveThumbnailUrl } from "../utils/avatarUrl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogOut, Users, Search, BarChart3, Plus, X } from "lucide-react";
import { cn } from "../utils/utils";
import { resolveUserPrimary, resolveUserSecondary } from "../utils/userDisplay";
import { formatDistanceToNow } from "../utils/time";
import { NewGroupPopup } from "./NewGroupPopup";
import { wsClient } from "@/transport/wsClient";
import { RequireRole } from "@/components/auth/RequireRole";
import { searchUsers as searchUsersApi } from "../api/users.api";
import { globalSearch } from "../api/search.api";
import { toDirectIdFromUsers, toCanonicalChatId } from "../utils/chatId.js";

export function Sidebar() {
  const { user, logout } = useAuth();
  const {
    activeGroupId,
    activeDmUser,
    activeConversationId,
    setActiveConversationId,
    setScrollToMessageId,
    unreadCounts,
    roomUnreadCounts,
    lastReadMessageIdByConversation, // PHASE 3: For unread computation
    computeUnreadCount, // PHASE 3: For unread computation
    messagesByConversation, // PHASE 3: For unread computation
    clearUnread,
    lastActivityTimestamps,
    lastMessagePreviews,
    resetAllState,
    connectionStatus,
    presenceUsers,
    roomIds,
    roomsById,
    membersByRoomId,
    usersById,
    apiChats,
    apiChatsLoading,
    isDirectoryHydrating,
    isWsReady,
    loadMessages,
    mergeUsersFromSearch,
    addDirectChat,
  } = useChatStore();
  const { reducedMotion } = useSettingsStore();
  const myUserId = user?.id ?? user?.userId ?? null;

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [searchResultUsers, setSearchResultUsers] = useState([]);
  const [searchResults, setSearchResults] = useState({ groups: [], contacts: [], messages: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [failedGroupThumbnailIds, setFailedGroupThumbnailIds] = useState(() => new Set());
  const searchTimeoutRef = useRef(null);
  const newGroupBtnRef = useRef(null);
  const didRestoreAfterHydrationRef = useRef(false);
  const prevHydratingRef = useRef(true);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  useEffect(() => {
    const q = debouncedSearchQuery.trim();
    if (q.length < 2) {
      setSearchResultUsers([]);
      setSearchResults({ groups: [], contacts: [], messages: [] });
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    let cancelled = false;
    globalSearch(q)
      .then((data) => {
        if (cancelled) return;
        setSearchResults({
          groups: data.groups ?? [],
          contacts: data.contacts ?? [],
          messages: data.messages ?? [],
        });
        const contacts = data.contacts ?? [];
        const normalized = contacts.map((u) => ({
          id: u.id ?? u.userId,
          username: u.username ?? "",
          displayName: u.displayName ?? u.username ?? String(u.id ?? u.userId).slice(0, 8),
          avatarUrl: u.avatarUrl ?? null,
          avatarInitials: ((u.displayName ?? u.username) || String(u.id ?? u.userId)).slice(0, 2).toUpperCase(),
          avatarColor: "bg-primary/10 text-primary",
        }));
        const filtered = normalized.filter((u) => u.id && String(u.id) !== String(myUserId));
        setSearchResultUsers(filtered);
        mergeUsersFromSearch(filtered);
      })
      .catch(() => {
        if (!cancelled) setSearchResults({ groups: [], contacts: [], messages: [] });
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedSearchQuery, myUserId, mergeUsersFromSearch]);

  const groups = useMemo(() => {
    const mapped = roomsToGroups(
      roomIds ?? [],
      roomsById ?? {},
      membersByRoomId ?? {},
      usersById ?? {},
      myUserId
    );
    return mapped.map((g) => ({ id: g.id, name: g.title, thumbnailUrl: g.photo }));
  }, [roomIds, roomsById, membersByRoomId, usersById, myUserId]);

  // PROMPT 3: UUID validation helper
  const isUuidLike = (s) => {
    if (typeof s !== "string") return false;
    // Basic UUID format check: 8-4-4-4-12 hex digits
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  };

  // PROMPT 3: Only show DMs that are from API, have valid other participant, AND user exists in usersById
  const directChats = useMemo(() => {
    const raw = Array.isArray(apiChats) ? apiChats : [];
    return raw.filter((c) => {
      const otherId = (c.participants || []).find((id) => id !== myUserId);
      const hasOther = !!otherId;
      const fromApi = c.fromApi !== false;
      
      // PROMPT 3: Require otherId exists, is UUID-like, AND user exists in usersById
      if (!hasOther || !fromApi) return false;
      if (!otherId || String(otherId) === String(myUserId)) return false;
      if (!isUuidLike(String(otherId))) return false;
      if (!usersById || !usersById[otherId]) return false;
      
      return true;
    });
  }, [apiChats, myUserId, usersById]);

  const handleSelectChat = (id) => {
    const cid = `room:${id}`;
    setActiveConversationId(cid);
    clearUnread(cid);
    try {
      localStorage.setItem("lastConversationId", cid);
    } catch (_) {}
  };

  const handleSelectDirectChat = (chatId) => {
    // PHASE A2: Normalize to canonical before storing (ensure localStorage also stores canonical)
    const canonicalId = toCanonicalChatId(chatId, myUserId);
    setActiveConversationId(canonicalId);
    clearUnread(canonicalId);
    try {
      localStorage.setItem("lastConversationId", canonicalId);
    } catch (_) {}
    loadMessages(canonicalId, { limit: 50 }).catch(() => {});
  };

  const handleSelectUserForDm = (otherUserId, otherUser) => {
    if (!myUserId || !otherUserId) return;
    const [a, b] = [String(myUserId), String(otherUserId)].sort();
    const chatId = `direct:${a}:${b}`;
    if (otherUser && addDirectChat) {
      addDirectChat(chatId, otherUser);
    }
    setActiveConversationId(chatId);
    clearUnread(chatId);
    try {
      localStorage.setItem("lastConversationId", chatId);
    } catch (_) {}
    loadMessages(chatId, { limit: 50 }).catch(() => {});
  };

  const handleLogout = () => {
    try {
      wsClient.shutdown?.('logout'); // Phase 5: close WS cleanly before clearing state
      wsClient.reset?.();
    } catch (_) {}
    didRestoreAfterHydrationRef.current = false;
    prevHydratingRef.current = true;
    resetAllState();
    logout();
  };

  useEffect(() => {
    const hydrating = isDirectoryHydrating || apiChatsLoading;
    if (hydrating) {
      prevHydratingRef.current = true;
      return;
    }
    if (!prevHydratingRef.current) return;
    prevHydratingRef.current = false;
    if (didRestoreAfterHydrationRef.current) return;
    const hasDirectory = (roomIds?.length ?? 0) > 0 || (directChats?.length ?? 0) > 0;
    if (!hasDirectory) return;
    let last = null;
    try {
      last = localStorage.getItem("lastConversationId");
    } catch (_) {}
    if (!last || typeof last !== "string") return;
    if (last.startsWith("room:")) {
      const roomId = last.slice(5);
      if (roomIds?.includes(roomId)) {
        didRestoreAfterHydrationRef.current = true;
        setActiveConversationId(last);
        loadMessages(last, { limit: 50 }).catch(() => {});
      }
    } else if (last.startsWith("direct:")) {
      const hasChat = directChats?.some((c) => c.chatId === last);
      if (hasChat) {
        didRestoreAfterHydrationRef.current = true;
        setActiveConversationId(last);
        loadMessages(last, { limit: 50 }).catch(() => {});
      }
    } else if (last.startsWith("dm-")) {
      // PHASE A2: Normalize legacy dm-* from localStorage to canonical direct:*
      const canonicalId = toCanonicalChatId(last, myUserId);
      if (canonicalId && canonicalId.startsWith("direct:")) {
        const hasChat = directChats?.some((c) => c.chatId === canonicalId);
        if (hasChat) {
          didRestoreAfterHydrationRef.current = true;
          setActiveConversationId(canonicalId);
          // Update localStorage to canonical format for future loads
          try {
            localStorage.setItem("lastConversationId", canonicalId);
          } catch (_) {}
          loadMessages(canonicalId, { limit: 50 }).catch(() => {});
        }
      }
    }
  }, [isDirectoryHydrating, apiChatsLoading, roomIds, directChats, setActiveConversationId, loadMessages]);

  const sortedItems = useMemo(() => {
    const timestamps = lastActivityTimestamps ?? {};
    const roomItems = (groups || []).map((g) => ({
      type: "room",
      chatId: `room:${g.id}`,
      roomId: g.id,
      group: g,
      lastActivityAt: timestamps[`room:${g.id}`] ?? 0,
    }));
    // PHASE D: Use canonical direct:* key so unread/preview lookups match store (never dm-*).
    // PROMPT 3: Defensive check - don't build DM row if otherId missing or user doesn't exist
    const dmItems = directChats
      .map((c) => {
        const otherId = (c.participants || []).find((id) => id !== myUserId);
        // PROMPT 3: Return null if otherId is missing or user doesn't exist
        if (!otherId || !myUserId || !usersById || !usersById[otherId]) {
          return null;
        }
        const canonicalId = toDirectIdFromUsers(myUserId, otherId);
        if (!canonicalId) return null;
        
        return {
          type: "direct",
          chatId: canonicalId,
          directChat: c,
          lastActivityAt: c.lastMessage?.timestamp ?? (canonicalId ? (timestamps[canonicalId] ?? 0) : 0),
        };
      })
      .filter(Boolean); // PROMPT 3: Remove null entries
    const combined = [...roomItems, ...dmItems];
    combined.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return combined;
  }, [groups, directChats, lastActivityTimestamps, myUserId, usersById]);

  useEffect(() => {
    if (sortedItems.length === 0 || didRestoreAfterHydrationRef.current) return;
    if (activeConversationId != null) return;
    const first = sortedItems[0];
    const cid = first.type === "room" ? `room:${first.roomId}` : first.chatId;
    // PHASE A2: Ensure canonical (sortedItems already uses canonical, but normalize for safety)
    const canonicalId = toCanonicalChatId(cid, myUserId);
    setActiveConversationId(canonicalId);
    if (first.type === "direct") loadMessages(canonicalId, { limit: 50 }).catch(() => {});
  }, [sortedItems, activeConversationId, setActiveConversationId, loadMessages, myUserId]);

  const getPreviewTime = (ts) => {
    if (!ts) return "";
    try {
      return formatDistanceToNow(typeof ts === "number" ? new Date(ts) : new Date(ts), { addSuffix: false });
    } catch {
      return "";
    }
  };

  const getPreviewContent = (preview) => {
    if (!preview) return "";
    if (typeof preview === "string") return preview; // legacy safety
    if (typeof preview === "object" && typeof preview.content === "string") return preview.content;
    return "";
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border/50 relative">
      <div className="p-4 bg-muted/30 border-b border-border/50 flex items-center justify-between gap-1 h-[60px] chat-header">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 ring-2 ring-background shadow-sm">
            {user?.avatarUrl && <AvatarImage src={avatarSrc(user.avatarUrl, user.updatedAt)} alt="" />}
            <AvatarFallback className="bg-primary/10 text-primary font-bold">
              {user?.displayName?.[0] || user?.username?.[0] || "U"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold leading-none">{user?.displayName || user?.username}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  connectionStatus === "connected"
                    ? "bg-green-500"
                    : connectionStatus === "connecting" || connectionStatus === "reconnecting" || connectionStatus === "syncing"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
                )}
              />
              <span className="text-[10px] text-muted-foreground font-medium">
                {connectionStatus === "connected"
                  ? "Online"
                  : connectionStatus === "connecting"
                  ? "Connecting..."
                  : connectionStatus === "reconnecting"
                  ? "Reconnecting..."
                  : connectionStatus === "syncing"
                  ? "Syncing messages..."
                  : "Offline"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground rounded-full h-8 w-8" data-testid="button-logout">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-muted/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
            data-testid="input-search-chat"
          />
          {searchQuery && (
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery("")}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button ref={newGroupBtnRef} variant="outline" className="w-full justify-start gap-2 text-sm" onClick={() => setShowNewGroup(true)} data-testid="button-new-group">
          <Plus className="w-4 h-4" />
          New Group
        </Button>
      </div>

      <NewGroupPopup open={showNewGroup} onClose={() => setShowNewGroup(false)} anchorRef={newGroupBtnRef} />

      <ScrollArea className="flex-1">
        {debouncedSearchQuery.trim() ? (
          <SearchResults
            searchQuery={debouncedSearchQuery.trim()}
            activeConversationId={activeConversationId}
            activeGroupId={activeGroupId}
            onSelectChat={handleSelectChat}
            onSelectDirectChat={handleSelectDirectChat}
            onSelectUserForDm={handleSelectUserForDm}
            onSelectMessageResult={({ chatId, chatType, groupId, messageId }) => {
              if (chatType === "room" && groupId) {
                handleSelectChat(groupId);
              } else if (chatId) {
                handleSelectDirectChat(chatId);
              }
              if (messageId) setScrollToMessageId(messageId);
            }}
            searchResultUsers={searchResultUsers}
            searchResultGroups={searchResults.groups}
            searchResultContacts={searchResults.contacts}
            searchResultMessages={searchResults.messages}
            searchLoading={searchLoading}
            groups={groups ?? []}
            directChats={directChats}
            usersById={usersById ?? {}}
            myUserId={myUserId}
            unreadCounts={unreadCounts ?? {}}
            roomUnreadCounts={roomUnreadCounts ?? {}}
            lastMessagePreviews={lastMessagePreviews ?? {}}
            presenceUsers={presenceUsers ?? {}}
            messagesByConversation={messagesByConversation ?? {}}
            computeUnreadCount={computeUnreadCount}
            lastReadMessageIdByConversation={lastReadMessageIdByConversation ?? {}}
            getPreviewContent={getPreviewContent}
            failedGroupThumbnailIds={failedGroupThumbnailIds}
            setFailedGroupThumbnailIds={setFailedGroupThumbnailIds}
          />
        ) : isDirectoryHydrating || apiChatsLoading || !isWsReady ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground" data-testid="sidebar-loading">
            Connecting…
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground" data-testid="sidebar-no-chats">
            No groups or chats yet. Create a group or start a DM.
          </div>
        ) : (
          <div className="px-2 py-2 space-y-1">
            {sortedItems.map((item) => {
              const chatId = item.chatId;
              const messages = messagesByConversation?.[chatId] || [];
              const lastReadMessageId = lastReadMessageIdByConversation?.[chatId] || null;
              
              // Single-source fallback logic: prefer backend unreadCounts when frontend cannot reliably compute
              let unread = 0;
              
              if (item.type === "direct") {
                const fallbackUnread = (unreadCounts || {})[chatId] || 0;
                
                // CASE 1 — messages not loaded yet
                if (!Array.isArray(messages) || messages.length === 0) {
                  unread = fallbackUnread;
                }
                // CASE 2 — lastRead pointer not known yet
                else if (!lastReadMessageId) {
                  unread = fallbackUnread;
                }
                // CASE 3 — compute unread from loaded messages
                else if (computeUnreadCount && myUserId) {
                  const computed = computeUnreadCount(chatId, messages, myUserId, lastReadMessageId);
                  // safety: if computed is zero but backend says unread exists,
                  // prefer backend value (frontend state not synced yet)
                  unread = computed === 0 && fallbackUnread > 0 ? fallbackUnread : computed;
                } else {
                  unread = fallbackUnread;
                }
              } else if (item.type === "room") {
                const fallbackUnread = ((unreadCounts || {})[chatId] || 0) + ((roomUnreadCounts || {})[chatId] || 0);
                
                // CASE 1 — messages not loaded yet
                if (!Array.isArray(messages) || messages.length === 0) {
                  unread = fallbackUnread;
                }
                // CASE 2 — lastRead pointer not known yet
                else if (!lastReadMessageId) {
                  unread = fallbackUnread;
                }
                // CASE 3 — compute unread from loaded messages
                else if (computeUnreadCount && myUserId) {
                  const computed = computeUnreadCount(chatId, messages, myUserId, lastReadMessageId);
                  // safety: if computed is zero but backend says unread exists,
                  // prefer backend value (frontend state not synced yet)
                  unread = computed === 0 && fallbackUnread > 0 ? fallbackUnread : computed;
                } else {
                  unread = fallbackUnread;
                }
              }
              
              const preview = (lastMessagePreviews || {})[chatId];

              if (item.type === "room") {
                const group = item.group;
                if (!group) return null;
                const previewText = getPreviewContent(preview) || "Group chat";
                return (
                  <button
                    key={chatId}
                    type="button"
                    className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover-elevate sidebar-item", activeGroupId === group.id && "bg-accent/50")}
                    onClick={() => handleSelectChat(group.id)}
                    data-testid={`button-group-${group.id}`}
                  >
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary overflow-hidden flex-shrink-0">
                      {resolveThumbnailUrl(group.thumbnailUrl) && !failedGroupThumbnailIds.has(group.id) ? (
                        <img src={resolveThumbnailUrl(group.thumbnailUrl)} alt="" className="h-12 w-12 rounded-full object-cover" onError={() => setFailedGroupThumbnailIds((prev) => new Set(prev).add(group.id))} />
                      ) : (
                        <Users className="w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex justify-between items-center gap-1">
                        <span className="font-semibold text-sm truncate">{group.name}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {item.lastActivityAt > 0 && <span className="text-[10px] text-muted-foreground">{getPreviewTime(item.lastActivityAt)}</span>}
                          {unread > 0 && (
                            <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full" data-testid={`badge-unread-room-${group.id}`}>
                              {unread}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {previewText}
                      </p>
                    </div>
                  </button>
                );
              }
              if (item.type === "direct") {
                const dc = item.directChat;
                const otherId = dc?.participants?.[0];
                const du = otherId ? (usersById || {})[otherId] : null;
                if (!dc?.chatId) return null;
                const presence = otherId ? (presenceUsers || {})[otherId] : undefined;
                const isOnline = presence?.online === true;
                const presenceLabel = isOnline ? "Online" : presence != null && presence.status === "offline" ? "Offline" : "—";
                const primary = du ? resolveUserPrimary(du) : "—";
                const secondary = du ? resolveUserSecondary(du) : "";
                const avatarColor = du?.avatarColor ?? "bg-muted";
                const avatarInitials = du?.avatarInitials ?? primary.slice(0, 2).toUpperCase();
                const previewText = getPreviewContent(preview) || dc?.lastMessage?.content || "";
                return (
                  <button
                    key={chatId}
                    type="button"
                    className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover-elevate sidebar-item", activeConversationId === chatId && "bg-accent/50")}
                    onClick={() => handleSelectDirectChat(chatId)}
                    data-testid={`button-dm-${du?.username ?? otherId ?? chatId}`}
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar className="h-12 w-12 border border-border">
                        {du?.avatarUrl && <AvatarImage src={avatarSrc(du.avatarUrl, du.updatedAt)} alt="" />}
                        <AvatarFallback className={cn("text-sm text-white", avatarColor)}>{avatarInitials}</AvatarFallback>
                      </Avatar>
                      <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-card", isOnline ? "bg-green-500" : "bg-muted-foreground/30")} title={presenceLabel} />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex justify-between items-center gap-1">
                        <span className="font-semibold text-sm truncate">{primary}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {item.lastActivityAt > 0 && <span className="text-[10px] text-muted-foreground">{getPreviewTime(item.lastActivityAt)}</span>}
                          {unread > 0 && (
                            <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full" data-testid={`badge-unread-dm-${du?.username ?? otherId}`}>
                              {unread}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {previewText || secondary}
                      </p>
                    </div>
                  </button>
                );
              }
              return null;
            })}
          </div>
        )}
      </ScrollArea>

      <div className="p-3 border-t border-border/50">
        <RequireRole role="ADMIN" fallback={null}>
          <Link
            href="/admin"
            className="flex w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            data-testid="button-admin-panel"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Admin Panel</span>
          </Link>
        </RequireRole>
      </div>
    </div>
  );
}

/** Wrap matching substrings in <mark> for snippet highlight (case-insensitive). */
function highlightSnippet(text, query) {
  if (!query || !text) return text;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${q})`, "gi");
  const parts = String(text).split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i} className="bg-primary/20 rounded px-0.5 font-medium">{part}</mark> : part
  );
}

function SearchResults({
  searchQuery,
  activeConversationId,
  activeGroupId,
  onSelectChat,
  onSelectDirectChat,
  onSelectUserForDm,
  onSelectMessageResult,
  searchResultUsers = [],
  searchResultGroups = null,
  searchResultContacts = null,
  searchResultMessages = null,
  searchLoading = false,
  groups = [],
  directChats = [],
  usersById = {},
  myUserId = null,
  unreadCounts = {},
  roomUnreadCounts = {},
  lastMessagePreviews = {},
  presenceUsers = {},
  messagesByConversation = {},
  computeUnreadCount = null,
  lastReadMessageIdByConversation = {},
  getPreviewContent = (preview) => {
    if (!preview) return "";
    if (typeof preview === "string") return preview;
    if (typeof preview === "object" && typeof preview?.content === "string") return preview.content;
    return "";
  },
  failedGroupThumbnailIds = new Set(),
  setFailedGroupThumbnailIds = () => {},
}) {
  const q = searchQuery.toLowerCase().trim();
  const usersToShow = useMemo(() => {
    if (Array.isArray(searchResultContacts) && searchResultContacts.length > 0) {
      return searchResultContacts
        .filter((u) => u.id && String(u.id) !== String(myUserId))
        .map((u) => ({
          id: u.id ?? u.userId,
          username: u.username ?? "",
          displayName: u.displayName ?? u.username ?? String(u.id ?? u.userId).slice(0, 8),
          avatarUrl: u.avatarUrl ?? null,
          avatarInitials: ((u.displayName ?? u.username) || String(u.id ?? u.userId)).slice(0, 2).toUpperCase(),
          avatarColor: "bg-primary/10 text-primary",
          email: u.email ?? null,
        }));
    }
    if (!Array.isArray(searchResultUsers) || searchResultUsers.length === 0) return [];
    return searchResultUsers.filter((u) => u.id && String(u.id) !== String(myUserId));
  }, [searchResultUsers, searchResultContacts, myUserId]);

  const matchedDirectChats = useMemo(() => {
    if (!q) return directChats;
    return directChats.filter((c) => {
      const otherId = (c.participants || []).find((id) => String(id) !== String(myUserId));
      const u = otherId ? usersById[otherId] : null;
      if (!u) return false;
      return (u.displayName ?? "").toLowerCase().includes(q) || (u.username ?? "").toLowerCase().includes(q);
    });
  }, [q, directChats, usersById, myUserId]);

  const matchedGroups = useMemo(() => {
    if (!q) return groups;
    return groups.filter((g) => (g.name || "").toLowerCase().includes(q));
  }, [groups, q]);

  const matchedMessages = useMemo(() => {
    if (!q || q.length < 2) return [];
    const results = [];
    const queryLower = q.toLowerCase();
    Object.keys(messagesByConversation).forEach((conversationId) => {
      const messages = messagesByConversation[conversationId] || [];
      messages.forEach((msg) => {
        const content = (msg.content || msg.text || "").toLowerCase();
        if (content.includes(queryLower)) {
          let conversationName = "";
          let conversationType = "";
          let groupId = null;
          let chatId = null;
          if (conversationId.startsWith("room:")) {
            groupId = conversationId.slice(5);
            const group = groups.find((g) => String(g.id) === groupId);
            conversationName = group?.name || `Group ${groupId}`;
            conversationType = "group";
          } else if (conversationId.startsWith("direct:") || conversationId.startsWith("dm-")) {
            chatId = conversationId.startsWith("direct:") ? conversationId : null;
            if (!chatId) {
              const userId = conversationId.replace("dm-", "");
              const directChat = directChats.find((c) => c.participants?.includes(userId));
              chatId = directChat?.chatId ?? conversationId;
            }
            const otherId = conversationId.startsWith("direct:") ? conversationId.slice(7).split(":").find((id) => id !== msg.senderId) : conversationId.replace("dm-", "");
            const u = usersById[otherId];
            conversationName = u ? resolveUserPrimary(u) : "—";
            conversationType = "dm";
          }
          const sender = usersById[msg.senderId];
          const senderName = sender ? resolveUserPrimary(sender) : "—";
          results.push({
            id: msg.id,
            content: msg.content || msg.text || "",
            senderId: msg.senderId,
            senderName,
            conversationId: chatId ?? conversationId,
            conversationName,
            conversationType,
            timestamp: msg.timestamp || msg.createdAt,
            groupId,
            chatId,
          });
        }
      });
    });
    results.sort((a, b) => {
      const timeA = a.timestamp ? (typeof a.timestamp === "string" ? new Date(a.timestamp).getTime() : a.timestamp) : 0;
      const timeB = b.timestamp ? (typeof b.timestamp === "string" ? new Date(b.timestamp).getTime() : b.timestamp) : 0;
      return timeB - timeA;
    });
    return results.slice(0, 20);
  }, [q, messagesByConversation, groups, directChats, usersById]);

  const formatTime = (ts) => {
    if (!ts) return "";
    try {
      return formatDistanceToNow(new Date(ts), { addSuffix: true });
    } catch {
      return "";
    }
  };

  const groupsToShow = Array.isArray(searchResultGroups) && searchResultGroups.length > 0 ? searchResultGroups : matchedGroups;
  // Read-after-write: merge server search results with local (sending) messages so just-sent messages appear immediately
  const messagesToShow = useMemo(() => {
    const server = Array.isArray(searchResultMessages) ? searchResultMessages : [];
    const byId = new Map();
    const contentKey = (chatId, content, senderId) => `${chatId}\0${(content || "").slice(0, 200)}\0${senderId || ""}`;
    const contentKeys = new Set();
    server.forEach((m) => {
      const k = m.messageId || m.id;
      if (k) byId.set(k, { ...m });
      const ck = contentKey(m.chatId, m.preview ?? m.content, m.senderId);
      contentKeys.add(ck);
    });
    (matchedMessages || []).forEach((m) => {
      const chatId = m.chatId ?? m.conversationId;
      const content = m.content || m.text || "";
      if (contentKeys.has(contentKey(chatId, content, m.senderId))) return;
      const k = m.id || m.messageId;
      if (k && byId.has(k)) return;
      const key = k || `local-${chatId}-${content.slice(0, 50)}-${m.senderId}`;
      byId.set(key, {
        messageId: m.id ?? m.messageId,
        chatId,
        chatType: m.conversationType === "group" ? "room" : "direct",
        senderId: m.senderId,
        preview: content.slice(0, 120),
        createdAt: m.timestamp ?? m.createdAt,
      });
    });
    const merged = Array.from(byId.values());
    merged.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return merged.slice(0, 20);
  }, [searchResultMessages, matchedMessages]);
  const hasAnyResults = groupsToShow.length > 0 || usersToShow.length > 0 || matchedDirectChats.length > 0 || messagesToShow.length > 0;

  return (
    <div className="px-2 py-2 space-y-1">
      {searchLoading && <p className="text-xs text-muted-foreground px-3 py-2">Searching…</p>}
      {/* Required order: 1) Groups, 2) Contacts, 3) Chats (DMs), 4) Messages. Each section only when it has results. */}
      {groupsToShow.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-1 pb-1">Groups</p>
          {groupsToShow.map((g) => {
            const chatId = `room:${g.id}`;
            const messagePreview = lastMessagePreviews[chatId];
            const roomMessages = messagesByConversation?.[chatId] || [];
            const lastReadMessageId = lastReadMessageIdByConversation?.[chatId] || null;
            const fallbackUnread = (unreadCounts[chatId] || 0) + (roomUnreadCounts[chatId] || 0);
            let groupUnread = 0;
            if (Array.isArray(roomMessages) && roomMessages.length > 0 && lastReadMessageId && computeUnreadCount && myUserId) {
              const computed = computeUnreadCount(chatId, roomMessages, myUserId, lastReadMessageId);
              groupUnread = computed === 0 && fallbackUnread > 0 ? fallbackUnread : computed;
            } else {
              groupUnread = fallbackUnread;
            }
            const previewText = getPreviewContent(messagePreview);
            return (
              <button
                key={g.id}
                type="button"
                className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover-elevate sidebar-item", activeGroupId === g.id && "bg-accent/50")}
                onClick={() => onSelectChat(g.id)}
                data-testid={`button-search-group-${g.id}`}
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                  {resolveThumbnailUrl(g.thumbnailUrl) && !failedGroupThumbnailIds.has(g.id) ? <img src={resolveThumbnailUrl(g.thumbnailUrl)} alt="" className="h-10 w-10 rounded-full object-cover" onError={() => setFailedGroupThumbnailIds((prev) => new Set(prev).add(g.id))} /> : <Users className="w-5 h-5" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate">{g.name}</span>
                    {groupUnread > 0 && <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full">{groupUnread}</Badge>}
                  </div>
                  {previewText && <span className="text-xs text-muted-foreground truncate block">{previewText}</span>}
                </div>
              </button>
            );
          })}
        </>
      )}

      {usersToShow.length > 0 && onSelectUserForDm && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-1 pb-1">Contacts</p>
          {usersToShow.map((u) => {
            const primary = u.displayName ?? u.username ?? String(u.id);
            const email = typeof u.email === "string" && u.email.trim() ? u.email.trim() : null;
            const avatarColor = u.avatarColor ?? "bg-muted";
            const avatarInitials = u.avatarInitials ?? primary.slice(0, 2).toUpperCase();
            const chatId = myUserId && u.id ? `direct:${[String(myUserId), String(u.id)].sort().join(":")}` : null;
            const isActive = activeConversationId === chatId;
            return (
              <button
                key={u.id}
                type="button"
                className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover-elevate sidebar-item", isActive && "bg-accent/50")}
                onClick={() => onSelectUserForDm(u.id, u)}
                data-testid={`button-search-user-${u.username ?? u.id}`}
              >
                <Avatar className="h-10 w-10 border border-border flex-shrink-0">
                  {u.avatarUrl && <AvatarImage src={avatarSrc(u.avatarUrl, u.updatedAt)} alt="" />}
                  <AvatarFallback className={cn("text-xs text-white", avatarColor)}>{avatarInitials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <span className="font-semibold text-sm truncate block">{primary}</span>
                  {email && <span className="text-xs text-muted-foreground truncate block">{email}</span>}
                </div>
              </button>
            );
          })}
        </>
      )}

      {matchedDirectChats.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-1 pb-1">Chats</p>
          {matchedDirectChats.map((c) => {
            const otherId = (c.participants || []).find((id) => String(id) !== String(myUserId));
            const du = otherId ? usersById[otherId] : null;
            const presence = otherId ? presenceUsers[otherId] : undefined;
            const isOnline = presence?.online === true;
            const presenceLabel = isOnline ? "Online" : presence != null && presence.status === "offline" ? "Offline" : "—";
            const displayPrimary = du ? resolveUserPrimary(du) : "—";
            const secondary = du ? resolveUserSecondary(du) : "";
            const avatarColor = du?.avatarColor ?? "bg-muted";
            const avatarInitials = du?.avatarInitials ?? displayPrimary.slice(0, 2).toUpperCase();
            const dmMessages = messagesByConversation?.[c.chatId] || [];
            const lastReadMessageId = lastReadMessageIdByConversation?.[c.chatId] || null;
            const fallbackUnread = unreadCounts[c.chatId] || 0;
            
            // Single-source fallback logic: prefer backend unreadCounts when frontend cannot reliably compute
            let dmUnread = 0;
            
            // CASE 1 — messages not loaded yet
            if (!Array.isArray(dmMessages) || dmMessages.length === 0) {
              dmUnread = fallbackUnread;
            }
            // CASE 2 — lastRead pointer not known yet
            else if (!lastReadMessageId) {
              dmUnread = fallbackUnread;
            }
            // CASE 3 — compute unread from loaded messages
            else if (computeUnreadCount && myUserId) {
              const computed = computeUnreadCount(c.chatId, dmMessages, myUserId, lastReadMessageId);
              // safety: if computed is zero but backend says unread exists,
              // prefer backend value (frontend state not synced yet)
              dmUnread = computed === 0 && fallbackUnread > 0 ? fallbackUnread : computed;
            } else {
              dmUnread = fallbackUnread;
            }
            
            const messagePreview = lastMessagePreviews[c.chatId];
            const previewText = getPreviewContent(messagePreview);
            return (
              <button
                key={c.chatId}
                type="button"
                className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover-elevate sidebar-item", activeConversationId === c.chatId && "bg-accent/50")}
                onClick={() => onSelectDirectChat(c.chatId)}
                data-testid={`button-search-dm-${du?.username ?? otherId}`}
              >
                <div className="relative flex-shrink-0">
                  <Avatar className="h-10 w-10 border border-border">
                    {du?.avatarUrl && <AvatarImage src={avatarSrc(du.avatarUrl, du.updatedAt)} alt="" />}
                    <AvatarFallback className={cn("text-xs text-white", avatarColor)}>{avatarInitials}</AvatarFallback>
                  </Avatar>
                  <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-card", isOnline ? "bg-green-500" : "bg-muted-foreground/30")} title={presenceLabel} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate block">{displayPrimary}</span>
                    {dmUnread > 0 && <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold rounded-full">{dmUnread}</Badge>}
                  </div>
                  {(previewText || secondary) && <span className="text-xs text-muted-foreground truncate block">{previewText || secondary}</span>}
                </div>
              </button>
            );
          })}
        </>
      )}

      {messagesToShow.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-1 pb-1">Messages</p>
          {messagesToShow.map((msg) => {
            const isApiMessage = msg.messageId != null && msg.chatId != null;
            const chatName = isApiMessage
              ? (msg.chatType === "room"
                ? (groups.find((g) => String(g.id) === (msg.chatId || "").replace(/^room:/, ""))?.name ?? `Group ${(msg.chatId || "").replace(/^room:/, "")}`)
                : (() => {
                    const parts = (msg.chatId || "").split(":");
                    const otherId = parts.length >= 3 && myUserId ? (parts[1] === String(myUserId) ? parts[2] : parts[1]) : null;
                    return otherId ? (resolveUserPrimary(usersById[otherId]) || "—") : "—";
                  })())
              : (msg.conversationName ?? "—");
            const senderName = isApiMessage
              ? (resolveUserPrimary(usersById[msg.senderId]) || "—")
              : (msg.senderName ?? "—");
            const timeStr = formatTime(msg.createdAt ?? msg.timestamp);
            const snippet = isApiMessage ? (msg.preview ?? "") : (msg.content?.length > 60 ? msg.content.substring(0, 60) + "..." : msg.content ?? "");
            const handleMessageClick = () => {
              if (onSelectMessageResult && isApiMessage) {
                const groupId = msg.chatType === "room" ? (msg.chatId || "").replace(/^room:/, "") : null;
                onSelectMessageResult({ chatId: msg.chatId, chatType: msg.chatType, groupId, messageId: msg.messageId });
                return;
              }
              if (msg.conversationType === "group" && msg.groupId) onSelectChat(msg.groupId);
              else if (msg.conversationType === "dm" && msg.chatId) onSelectDirectChat(msg.chatId);
            };
            return (
              <button
                key={isApiMessage ? msg.messageId : `${msg.conversationId}-${msg.id}`}
                type="button"
                className="w-full flex items-start gap-3 p-3 rounded-lg hover-elevate sidebar-item text-left"
                onClick={handleMessageClick}
                data-testid={`button-search-message-${msg.messageId ?? msg.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-xs">{senderName}</span>
                    <span className="text-[10px] text-muted-foreground">in</span>
                    <span className="text-xs text-primary font-medium truncate">{chatName}</span>
                    {timeStr && <span className="text-[10px] text-muted-foreground ml-auto">{timeStr}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {isApiMessage && q ? highlightSnippet(snippet, searchQuery.trim()) : snippet}
                  </p>
                </div>
              </button>
            );
          })}
        </>
      )}

      {!hasAnyResults && <p className="text-sm text-muted-foreground text-center py-6">No results found</p>}
    </div>
  );
}
