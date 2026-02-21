import { useState, useRef } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import { LogOut, LogIn, Users, Search, BarChart3, Plus, X, Settings } from "lucide-react";
import { cn } from "@/utils/utils";
import { NewGroupPopup } from "./NewGroupPopup";
import { useAuth } from "@/hooks/useAuth";
import { useChatStore } from "@/hooks/useChat";
import { sortChatItems } from "@/utils/conversation";

export function Sidebar() {
  const { user, logout } = useAuth();
  const {
    activeGroupId,
    activeDmUser,
    groups,
    setActiveGroupId,
    setActiveDmUser,
    clearUnread,
    lastMessagePreviews,
    lastActivityTimestamps,
  } = useChatStore();
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const newGroupBtnRef = useRef(null);

  const sortedItems = sortChatItems(groups, [], lastActivityTimestamps);

  const handleSelectGroup = (id) => {
    setActiveGroupId(id);
    clearUnread(`group-${id}`);
  };
  const handleSelectDm = (userId) => {
    setActiveDmUser(userId);
    clearUnread(`dm-${userId}`);
  };

  const displayUser = user || { displayName: "Guest", username: "guest" };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border/50 w-[280px] shrink-0">
      <div className="p-4 bg-muted/30 border-b border-border/50 flex items-center justify-between gap-1 h-[60px]">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 ring-2 ring-background shadow-sm">
            <AvatarFallback className="bg-primary/10 text-primary font-bold">
              {displayUser?.displayName?.[0] || "U"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold leading-none">{displayUser?.displayName || "User"}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-[10px] text-muted-foreground font-medium">Online</span>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="text-muted-foreground rounded-full h-8 w-8" onClick={() => logout()}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-muted/50 rounded-lg text-sm"
          />
          {searchQuery && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearchQuery("")}>
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-2">
        <Button
          ref={newGroupBtnRef}
          variant="outline"
          className="w-full justify-start gap-2 text-sm"
          onClick={() => setShowNewGroup(true)}
        >
          <Plus className="w-4 h-4" />
          New Group
        </Button>
      </div>

      <NewGroupPopup
        open={showNewGroup}
        onClose={() => setShowNewGroup(false)}
        anchorRef={newGroupBtnRef}
      />

      <ScrollArea className="flex-1">
        <div className="px-2 py-2 space-y-1">
          {sortedItems.map((item) => {
            if (item.type === "group") {
              const g = item.group;
              if (!g) return null;
              return (
                <button
                  key={`group-${g.id}`}
                  className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50", activeGroupId === g.id && !activeDmUser && "bg-accent/50")}
                  onClick={() => handleSelectGroup(g.id)}
                >
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <span className="font-semibold text-sm truncate block">{g.name}</span>
                    <p className="text-xs text-muted-foreground truncate">
                      {lastMessagePreviews[`group-${g.id}`] || "Group chat"}
                    </p>
                  </div>
                </button>
              );
            }
            if (item.type === "dm") {
              const u = item.user;
              if (!u) return null;
              return (
                <button
                  key={`dm-${u.id}`}
                  className={cn("w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50", activeDmUser === u.id && "bg-accent/50")}
                  onClick={() => handleSelectDm(u.id)}
                >
                  <div className="relative flex-shrink-0">
                    <Avatar className="h-12 w-12 border border-border">
                      <AvatarFallback className={cn("text-sm text-white", u.avatarColor || "bg-secondary")}>
                        {u.avatarInitials || (u.displayName || u.username || "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className={cn("absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-card", u.isOnline ? "bg-green-500" : "bg-muted-foreground/30")} />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <span className="font-semibold text-sm truncate block">{u.displayName || u.username}</span>
                    <p className="text-xs text-muted-foreground truncate">
                      {lastMessagePreviews[`dm-${u.id}`] || (u.isOnline ? "Online" : "Offline")}
                    </p>
                  </div>
                </button>
              );
            }
            return null;
          })}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-border/50 space-y-1">
        <Link href="/login">
          <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
            <LogIn className="w-4 h-4" />
            <span className="text-sm">Login</span>
          </Button>
        </Link>
        <Link href="/settings">
          <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
            <Settings className="w-4 h-4" />
            <span className="text-sm">Settings</span>
          </Button>
        </Link>
        <Link href="/admin">
          <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
            <BarChart3 className="w-4 h-4" />
            <span className="text-sm">Admin Panel</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
