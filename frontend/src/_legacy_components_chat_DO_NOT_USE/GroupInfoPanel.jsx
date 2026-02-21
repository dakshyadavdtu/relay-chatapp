import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, X, Shield, ShieldOff, UserMinus, Crown } from "lucide-react";
import { cn } from "@/utils/utils";

const PLACEHOLDER_MEMBERS = [
  { id: "1", displayName: "Alice", role: "admin", online: true },
  { id: "2", displayName: "Bob", role: "member", online: false },
  { id: "3", displayName: "Charlie", role: "member", online: true },
];

export function GroupInfoPanel({ groupId, open, onClose }) {
  const [groupName, setGroupName] = useState("Placeholder Group");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmRemoveUser, setConfirmRemoveUser] = useState(null);
  const currentUserId = "1";

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const members = PLACEHOLDER_MEMBERS;
  const filteredAdmins = members.filter((m) => m.role === "admin");
  const filteredMembers = members.filter((m) => m.role !== "admin");
  const filtered = (list) =>
    list.filter((m) =>
      (m.displayName || "").toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className={cn("relative bg-card w-full max-w-md max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="font-bold text-lg">Group Info</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4 custom-scrollbar">
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 bg-muted/50 rounded-lg text-base font-semibold border border-border"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <Button size="sm">Save</Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              className="w-full pl-9 pr-4 py-2 bg-muted/50 rounded-lg text-sm"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {[
            { title: "ADMINS", list: filtered(filteredAdmins) },
            { title: "MEMBERS", list: filtered(filteredMembers) },
          ].map(
            (s) =>
              s.list.length > 0 && (
                <div key={s.title}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    {s.title} ({s.list.length})
                  </h4>
                  <div className="space-y-1">
                    {s.list.map((m) => {
                      const isMe = m.id === currentUserId;
                      const isAdmin = m.role === "admin";
                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30"
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarFallback>{(m.displayName || "??").slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium truncate">{m.displayName}</span>
                              {isMe && <span className="text-xs text-muted-foreground">(Me)</span>}
                              {isAdmin && <Crown className="w-3.5 h-3.5 text-yellow-500" />}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {m.online ? "Active now" : "Offline"}
                            </span>
                          </div>
                          {!isMe && (
                            <div className="flex items-center gap-1">
                              <Button variant="secondary" size="icon" className="h-7 w-7">
                                <Shield className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="secondary"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => setConfirmRemoveUser(m.id)}
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
          )}
          <div className="pt-2">
            <Button variant="destructive" className="w-full gap-2">
              Exit Group
            </Button>
          </div>
        </div>
        {confirmRemoveUser && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 p-4">
            <div className="bg-card rounded-xl shadow-xl p-5 max-w-[280px] w-full">
              <p className="text-sm font-medium mb-4">Remove this user?</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveUser(null)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={() => setConfirmRemoveUser(null)}>Remove</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
