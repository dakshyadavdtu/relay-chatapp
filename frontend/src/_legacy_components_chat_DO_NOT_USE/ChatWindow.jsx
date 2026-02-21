import { useState, useRef, useEffect } from "react";
import { SendHorizontal, Paperclip, Smile, Settings, CheckCheck, MoreVertical, Edit2, Trash2, X, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/utils/utils";
import { GroupInfoPanel } from "./GroupInfoPanel";
import { EmojiPicker } from "./EmojiPicker";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useMessages } from "@/hooks/useMessages";
import { useChatStore } from "@/hooks/useChat";
import { getConversationId } from "@/utils/conversation";

/**
 * NOT used by /chat route. /chat uses features/chat/ui/ChatWindow.jsx.
 * Local stub only — no import of useWebSocket or @/websocket.
 */
function useWebSocketStub() {
  return { sendMessage: () => {}, isConnected: false };
}
function displayNameFor(id) {
  return id ? `User ${String(id).slice(0, 4)}` : "User";
}

export function ChatWindow({ activeGroupId = 1, activeDmUser = null }) {
  const { user } = useAuth();
  const { sendMessage, isConnected } = useWebSocketStub();
  const { groups, addMessage, setLastMessagePreview, updateLastActivity, updateMessageContent, deleteMessageLocal } = useChatStore();
  const conversationId = getConversationId(activeGroupId, activeDmUser);
  const messages = useMessages(conversationId);

  const [inputValue, setInputValue] = useState("");
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [menuOpenForId, setMenuOpenForId] = useState(null);
  const [showReportModal, setShowReportModal] = useState(null);
  const [showReportUserModal, setShowReportUserModal] = useState(false);
  const { toast } = useToast();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const editTextareaRef = useRef(null);

  const currentUserId = user?.id || "me";
  const dmUser = activeDmUser ? { displayName: displayNameFor(activeDmUser), avatarInitials: "U" } : null;
  const group = (groups || []).find((g) => g.id === activeGroupId);
  const headerName = dmUser ? dmUser.displayName : (group?.name || `Group ${activeGroupId}`);
  const headerInitials = headerName.slice(0, 2).toUpperCase();

  const handleSend = () => {
    if (!inputValue.trim() || !conversationId) return;
    if (!isConnected) {
      toast({ title: "Connection not ready", description: "WebSocket not ready. Try again.", variant: "destructive" });
      return;
    }
    const content = inputValue.trim();
    setInputValue("");
    const chatId = activeDmUser ? `dm-${activeDmUser}` : `group-${activeGroupId}`;
    setLastMessagePreview(chatId, content);
    updateLastActivity(chatId);
    sendMessage(content);
  };

  const handleEmojiSelect = (emoji) => {
    setInputValue((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleStartEdit = (msgId, content) => {
    setMenuOpenForId(null);
    setEditingMessageId(msgId);
    setEditingContent(content || "");
  };

  const handleSaveEdit = () => {
    if (editingMessageId == null || !editingContent.trim() || !conversationId) return;
    updateMessageContent(conversationId, editingMessageId, editingContent.trim());
    setEditingMessageId(null);
    setEditingContent("");
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent("");
    setMenuOpenForId(null);
  };

  const handleDeleteMessage = (messageId) => {
    setMenuOpenForId(null);
    if (!conversationId) return;
    deleteMessageLocal(conversationId, messageId);
  };

  useEffect(() => {
    if (editingMessageId != null && editTextareaRef.current) {
      editTextareaRef.current.focus();
    }
  }, [editingMessageId]);

  useEffect(() => {
    if (menuOpenForId == null) return;
    const close = () => setMenuOpenForId(null);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [menuOpenForId]);

  const formatTime = (d) => {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const sortedMessages = [...(messages ?? [])].sort(
    (a, b) => new Date(a.createdAt || a.timestamp) - new Date(b.createdAt || b.timestamp)
  );

  return (
    <div className="flex flex-col h-full bg-[#EFEAE2] dark:bg-[#0f172a] relative flex-1">
      <div className="absolute inset-0 chat-bg-pattern opacity-40 pointer-events-none" />

      <div className="h-[60px] px-4 bg-card/95 backdrop-blur-sm border-b border-border/50 flex items-center justify-between z-10 shadow-sm">
        <div
          className="flex items-center gap-3 cursor-pointer p-1 rounded-lg"
          onClick={() => !activeDmUser && setShowGroupInfo(true)}
        >
          <Avatar className="h-10 w-10 ring-1 ring-border shadow-sm">
            <AvatarFallback className="bg-primary/10 text-primary font-bold">{headerInitials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold leading-none">{headerName}</h2>
            <p className="text-xs text-muted-foreground mt-1">2 members · 1 online</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {dmUser && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground rounded-full"
              onClick={() => setShowReportUserModal(true)}
            >
              <Flag className="w-5 h-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="text-muted-foreground rounded-full" onClick={() => setShowSettings(true)}>
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar relative">
        <div className="space-y-3">
          {sortedMessages.map((msg) => {
            const isMe = msg.senderId === currentUserId;
            const senderUser = msg.senderId ? { displayName: displayNameFor(msg.senderId) } : undefined;
            return (
              <div
                key={msg.id || msg.clientId || msg.content}
                className={cn(
                  "flex w-full max-w-3xl",
                  isMe ? "ml-auto justify-end" : "justify-start"
                )}
              >
                {!isMe && (
                  <div className="w-8 mr-2 flex-shrink-0 flex flex-col justify-end">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className={cn("text-[10px] border border-border text-white", senderUser?.avatarColor || "bg-secondary")}>
                        {senderUser?.avatarInitials || String(msg.senderId).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[75%] sm:max-w-[60%] shadow-sm relative text-sm group rounded-2xl",
                    isMe
                      ? "bg-[#D9FDD3] dark:bg-primary/20 dark:border dark:border-border text-foreground message-bubble-sent"
                      : "bg-white dark:bg-card text-foreground message-bubble-received"
                  )}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setMenuOpenForId(menuOpenForId === (msg.id ?? msg.clientId) ? null : (msg.id ?? msg.clientId))}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </div>
                  {menuOpenForId === (msg.id ?? msg.clientId) && (
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] bg-card border border-border shadow-lg rounded-lg overflow-hidden">
                      {isMe && (
                        <>
                          <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-[11px] hover-elevate flex items-center gap-2"
                            onClick={() => handleStartEdit(msg.id ?? msg.clientId, msg.content)}
                          >
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-[11px] hover-elevate text-destructive flex items-center gap-2"
                            onClick={() => handleDeleteMessage(msg.id ?? msg.clientId)}
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </>
                      )}
                      {!isMe && (
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left text-[11px] hover-elevate flex items-center gap-2"
                          onClick={() => {
                            setMenuOpenForId(null);
                            setShowReportModal(msg.id ?? msg.clientId);
                          }}
                        >
                          <Flag className="w-3 h-3" /> Report
                        </button>
                      )}
                    </div>
                  )}
                  {!isMe && (
                    <p className="text-[10px] font-bold mb-1 leading-none opacity-80 text-primary px-3 pt-2">
                      {senderUser?.displayName || `User ${String(msg.senderId).slice(0, 4)}`}
                    </p>
                  )}
                  {editingMessageId === (msg.id ?? msg.clientId) ? (
                    <div className="px-3 py-2 space-y-2">
                      <textarea
                        ref={editTextareaRef}
                        className="w-full min-h-[60px] rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                      />
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                          <X className="w-3 h-3 mr-1" /> Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveEdit} disabled={!editingContent.trim()}>
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap leading-relaxed break-words px-3 py-2">{msg.content}</p>
                      <div className={cn("text-[10px] px-3 pb-2 flex items-center gap-1 opacity-60", isMe ? "justify-end" : "justify-start")}>
                        {formatTime(new Date(msg.createdAt || msg.timestamp))}
                        {isMe && <CheckCheck className="w-3 h-3 ml-1" />}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showGroupInfo && activeGroupId !== null && (
        <GroupInfoPanel groupId={activeGroupId} open={showGroupInfo} onClose={() => setShowGroupInfo(false)} />
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowReportModal(null)}>
          <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">Report Message</h3>
            <p className="text-sm text-muted-foreground mb-4">Why are you reporting this message?</p>
            <div className="space-y-2 mb-6">
              {["Spam", "Abuse", "Harassment", "Other"].map((type) => (
                <button
                  key={type}
                  type="button"
                  className="w-full p-3 text-left hover-elevate rounded-lg text-sm font-medium border border-border"
                  onClick={() => {
                    setShowReportModal(null);
                    toast({ title: "Message reported", description: "Our team will review this message." });
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowReportModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {showReportUserModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowReportUserModal(false)}>
          <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-1">Report {dmUser ? dmUser.displayName || "User" : "User"}</h3>
            <p className="text-sm text-muted-foreground mb-4">Why are you reporting this user?</p>
            <div className="space-y-2 mb-6">
              {["Spam", "Abuse", "Harassment", "Other"].map((type) => (
                <button
                  key={type}
                  type="button"
                  className="w-full p-3 text-left hover-elevate rounded-lg text-sm font-medium border border-border"
                  onClick={() => {
                    toast({ title: "User reported", description: `Report submitted for ${type.toLowerCase()}.` });
                    setShowReportUserModal(false);
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setShowReportUserModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="p-3 bg-card/95 backdrop-blur-sm border-t border-border z-10 relative">
        {showEmojiPicker && (
          <div className="absolute bottom-full left-3 mb-1 z-50">
            <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
          </div>
        )}
        <div className="max-w-4xl mx-auto flex items-end gap-2 bg-muted/30 p-1.5 rounded-3xl border border-border/50 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full text-muted-foreground shrink-0"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            <Smile className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-muted-foreground shrink-0 opacity-50">
            <Paperclip className="w-5 h-5" />
          </Button>
          <textarea
            ref={inputRef}
            className="flex-1 bg-transparent py-3 px-2 min-h-[44px] max-h-[120px] focus:outline-none text-sm placeholder:text-muted-foreground/70 resize-none"
            placeholder="Type a message"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            size="icon"
            className={cn(
              "h-10 w-10 rounded-full shrink-0",
              inputValue.trim() ? "bg-primary text-primary-foreground shadow-md" : "bg-muted text-muted-foreground opacity-50"
            )}
          >
            <SendHorizontal className="w-5 h-5 ml-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
