import { useState, useEffect } from "react";
import { useChatStore, useSettingsStore } from "../adapters";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "../utils/utils";
import { useToast } from "@/hooks/useToast";

export function JoinRoomPopup({ open, onClose, anchorRef }) {
  const { reducedMotion } = useSettingsStore();
  const { joinRoom, upsertRoomOptimistic, isWsReady } = useChatStore();
  const { toast } = useToast();
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const handleClose = () => {
    setRoomId("");
    setIsJoining(false);
    onClose();
  };

  const handleJoin = () => {
    const trimmedId = roomId.trim();
    if (!trimmedId) {
      toast({ title: "Room ID required", description: "Please enter a room ID to join.", variant: "destructive" });
      return;
    }
    if (!isWsReady) {
      toast({ title: "Not connected", description: "Please wait for connection.", variant: "destructive" });
      return;
    }
    setIsJoining(true);
    const sent = joinRoom({ roomId: trimmedId });
    if (!sent) {
      setIsJoining(false);
      toast({ title: "Send failed", description: "Could not send ROOM_JOIN.", variant: "destructive" });
      return;
    }
    upsertRoomOptimistic(trimmedId);
    handleClose();
  };

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={handleClose}>
      <div
        className={cn("bg-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden", !reducedMotion && "animate-in fade-in zoom-in-95 duration-200")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-border">
          <h3 className="font-bold text-lg">Join room</h3>
          <Button variant="ghost" size="icon" onClick={handleClose} data-testid="button-close-join-room">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4">
          <label className="block text-sm font-medium mb-1">Room ID <span className="text-destructive">*</span></label>
          <input
            type="text"
            placeholder="e.g. general, room-1"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full px-4 py-2 bg-muted/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            data-testid="input-join-room-id"
          />
          <p className="text-xs text-muted-foreground mt-1">Enter the room ID to join</p>
        </div>

        <div className="p-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleJoin} disabled={isJoining || !roomId.trim()} data-testid="button-join-room">
            {isJoining ? "Joining…" : "Join room"}
          </Button>
        </div>
      </div>
    </div>
  );
}
