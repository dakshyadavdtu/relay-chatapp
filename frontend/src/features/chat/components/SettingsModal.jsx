import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "../utils/utils";

export function SettingsModal({ open, onClose }) {
  if (!open) return null;

  const handleTestNotification = () => {
    // Stub: no-op for Phase 3
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className={cn("bg-card w-full max-w-md rounded-2xl shadow-2xl p-6")} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">Chat settings</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Notifications, appearance, and message options will be wired in a later phase.</p>
        <Button variant="outline" onClick={handleTestNotification}>Test notification (stub)</Button>
      </div>
    </div>
  );
}
