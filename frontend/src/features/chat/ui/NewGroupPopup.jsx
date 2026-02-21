// ============================================================================
// UI ONLY — copy7 layout; Phase 4 wired to users from store + createGroup compat.
// ============================================================================
import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth, useChatStore, useSettingsStore } from "../adapters";
import { createGroup } from "../api/groups.compat";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, X, Check, ArrowRight, Users } from "lucide-react";
import { cn } from "../utils/utils";

export function NewGroupPopup({ open, onClose, anchorRef }) {
  const { user } = useAuth();
  const { reducedMotion } = useSettingsStore();
  const { setActiveConversationId, loadMessages, users, isWsReady } = useChatStore();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [isCreatePending, setIsCreatePending] = useState(false);
  const popupRef = useRef(null);

  const allUsers = useMemo(() => Array.isArray(users) ? users : [], [users]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allUsers.filter((u) => {
      if (user?.id && u.id === user.id) return false;
      if (!q) return true;
      return (
        (u.username ?? "").toLowerCase().includes(q) ||
        (u.displayName ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [allUsers, searchQuery, user?.id]);

  const toggleUser = (u) => {
    setSelectedUsers((prev) =>
      prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u]
    );
  };

  const handleClose = () => {
    setStep(1);
    setSearchQuery("");
    setSelectedUsers([]);
    setGroupName("");
    setThumbnailPreview(null);
    setThumbnailFile(null);
    onClose();
  };

  const handleCreate = async () => {
    if (!isWsReady) {
      toast({ title: "Connecting…", description: "Please wait for the connection before creating a group.", variant: "destructive" });
      return;
    }
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      toast({ title: "Invalid group name", description: "Please enter a group name.", variant: "destructive" });
      return;
    }
    const memberIdsSet = new Set(selectedUsers.map((u) => u.id));
    if (user?.id && !memberIdsSet.has(user.id)) memberIdsSet.add(user.id);
    const memberIds = Array.from(memberIdsSet);
    if (memberIds.length === 0) {
      toast({ title: "No members selected", description: "Please select at least one member for the group.", variant: "destructive" });
      return;
    }
    setIsCreatePending(true);
    let res;
    try {
      res = await createGroup({
        name: trimmedName,
        ...(thumbnailFile ? { file: thumbnailFile } : {}),
        memberIds,
      });
    } catch (err) {
      setIsCreatePending(false);
      toast({ title: "Failed to create group", description: err?.message ?? "Please try again.", variant: "destructive" });
      return;
    }
    setIsCreatePending(false);
    if (res.ok && res.data) {
      const id = res.data.id ?? res.data?.data?.id;
      handleClose();
      if (id != null) {
        const conversationId = `room:${id}`;
        setActiveConversationId?.(conversationId);
        loadMessages(conversationId, { limit: 50 }).catch(() => {});
      }
      toast({ title: "Group created", description: `"${trimmedName}" has been created.` });
    } else {
      toast({ title: "Failed to create group", description: res.error ?? "Please try again.", variant: "destructive" });
    }
  };

  const handleThumbnailUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setThumbnailFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setThumbnailPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target) && anchorRef?.current && !anchorRef.current.contains(e.target)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[90]" onClick={handleClose} />
      <div
        ref={popupRef}
        className={cn(
          "absolute left-3 right-3 z-[100] bg-card border border-border rounded-lg shadow-lg overflow-hidden",
          !reducedMotion && "animate-in slide-in-from-top-2 duration-150"
        )}
        style={{ top: anchorRef?.current ? anchorRef.current.offsetTop + anchorRef.current.offsetHeight + 4 : 0 }}
        data-testid="popup-new-group"
      >
        {step === 1 ? (
          <div className="flex flex-col max-h-[400px]">
            <div className="p-3 border-b border-border flex items-center justify-between gap-1">
              <h3 className="text-sm font-bold">Select Members</h3>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search users..."
                  className="w-full pl-9 pr-4 py-2 bg-muted/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="input-search-users"
                />
              </div>
            </div>

            {selectedUsers.length > 0 && (
              <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                {selectedUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-1 rounded-full"
                  >
                    {u.displayName || u.username}
                    <button type="button" onClick={() => toggleUser(u)} className="ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-2 pb-2 custom-scrollbar" style={{ maxHeight: "220px" }}>
              {filteredUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No users found</p>
              ) : (
                filteredUsers.map((u) => {
                  const isSelected = selectedUsers.some((s) => s.id === u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-3 p-2 rounded-lg text-left hover-elevate",
                        isSelected && "bg-primary/5"
                      )}
                      onClick={() => toggleUser(u)}
                      data-testid={`button-select-user-${u.id}`}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-[10px] bg-secondary border border-border">
                          {(u.displayName || u.username || "??").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.displayName || u.username}</p>
                        {u.email && String(u.email).trim() && (
                          <p className="text-[10px] text-muted-foreground truncate">{u.email.trim()}</p>
                        )}
                      </div>
                      {isSelected && (
                        <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="p-3 border-t border-border flex justify-end">
              <Button
                size="sm"
                disabled={selectedUsers.length === 0}
                onClick={() => setStep(2)}
                className="gap-1"
                data-testid="button-proceed-group"
              >
                Proceed
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col max-h-[400px]">
            <div className="p-3 border-b border-border flex items-center justify-between gap-1">
              <h3 className="text-sm font-bold">Group Details</h3>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Group Name</label>
                <input
                  type="text"
                  placeholder="Enter group name"
                  className="w-full px-3 py-2 bg-muted/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 border border-border"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  autoFocus
                  data-testid="input-group-name"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Thumbnail</label>
                <div className="flex items-center gap-3">
                  {thumbnailPreview ? (
                    <Avatar className="h-12 w-12">
                      <img src={thumbnailPreview} alt="Group" className="h-12 w-12 rounded-full object-cover" />
                    </Avatar>
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <Users className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleThumbnailUpload}
                      data-testid="input-thumbnail-upload"
                    />
                    <span className="text-xs font-medium text-primary hover:underline">Upload image</span>
                  </label>
                </div>
              </div>

              {groupName && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Preview</label>
                  <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border">
                    {thumbnailPreview ? (
                      <Avatar className="h-10 w-10">
                        <img src={thumbnailPreview} alt="" className="h-10 w-10 rounded-full object-cover" />
                      </Avatar>
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Users className="w-5 h-5" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold">{groupName}</p>
                      <p className="text-[10px] text-muted-foreground">{selectedUsers.length + 1} members</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border flex justify-between gap-1">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} data-testid="button-back-step">
                Back
              </Button>
              <Button
                size="sm"
                disabled={!isWsReady || !groupName.trim() || isCreatePending}
                onClick={handleCreate}
                data-testid="button-create-group"
              >
                {!isWsReady ? "Connecting…" : isCreatePending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
