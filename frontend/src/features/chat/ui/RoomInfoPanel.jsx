/**
 * Room info panel: member list with role badges from backend schema.
 * Backend ROOM_MEMBERS_RESPONSE returns members: string[] (user IDs only).
 * roomInfo has createdBy - we show "Creator" badge for that user.
 * No admin mutation buttons: backend has no room admin endpoints.
 */
import { useEffect } from "react";
import { useChatStore, useSettingsStore } from "../adapters";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { X, Users } from "lucide-react";
import { cn } from "../utils/utils";

export function RoomInfoPanel({ roomId, open, onClose }) {
  const { reducedMotion, roomsById, membersByRoomId, presenceUsers } = useChatStore();

  const roomInfo = roomId ? roomsById[roomId] : null;
  const members = (roomId && membersByRoomId[roomId]) || [];
  const createdBy = roomInfo?.createdBy ?? null;

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const roomName = roomInfo?.name ?? roomId ?? "Room";

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-card border-l border-border shadow-xl flex flex-col">
      <div className={cn("p-4 border-b border-border", !reducedMotion && "animate-in slide-in-from-right duration-200")}>
        <div className="flex justify-between items-center gap-2">
          <h3 className="font-bold text-lg truncate">Room info</h3>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-room-info">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1 truncate">{roomName}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          Members ({members.length})
        </p>
        <div className="space-y-2">
          {members.map((userId) => {
            const isCreator = createdBy != null && String(userId) === String(createdBy);
            const displayName = userId;
            const shortId = String(userId).length > 12 ? `${String(userId).slice(0, 8)}…` : userId;
            const isOnline = presenceUsers[userId]?.online === true;
            return (
              <div
                key={userId}
                className="flex items-center gap-3 p-2 rounded-lg bg-muted/30"
                data-testid={`room-member-${userId}`}
              >
                <div className="relative flex-shrink-0">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {shortId[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  {isOnline && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-500 ring-2 ring-card" />
                  )}
                </div>
                <span className="text-sm font-medium truncate flex-1" title={displayName}>
                  {shortId}
                </span>
                {isCreator && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    Creator
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Member list updates when users join or leave. No admin actions — backend has no room mutation endpoints.
        </p>
      </div>
    </div>
  );
}
