import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, X, Check, ArrowRight, Users } from "lucide-react";
import { cn } from "@/utils/utils";
import { useChatStore } from "@/hooks/useChat";

const PLACEHOLDER_USERS = [
  { id: "u1", displayName: "Alice", username: "alice" },
  { id: "u2", displayName: "Bob", username: "bob" },
  { id: "u3", displayName: "Charlie", username: "charlie" },
];

export function NewGroupPopup({ open, onClose, anchorRef }) {
  const { addGroup, setActiveGroupId } = useChatStore();
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const popupRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") { setStep(1); onClose(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) {
        setStep(1);
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const filtered = PLACEHOLDER_USERS.filter(
    (u) =>
      !searchQuery.trim() ||
      (u.displayName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.username || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleClose = () => {
    setStep(1);
    setSearchQuery("");
    setSelectedUsers([]);
    setGroupName("");
    setThumbnailPreview(null);
    setIsCreating(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const toggleUser = (u) => {
    setSelectedUsers((prev) =>
      prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u]
    );
  };

  const handleThumbnailUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setThumbnailPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = () => {
    const trimmed = groupName.trim();
    if (!trimmed || isCreating) return;

    setIsCreating(true);
    const newGroup = {
      id: Date.now(),
      name: trimmed,
      thumbnailUrl: thumbnailPreview || null,
      members: selectedUsers.map((u) => u.id),
    };
    addGroup(newGroup);
    setActiveGroupId(newGroup.id);
    handleClose();
    setIsCreating(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[90]" onClick={handleClose} />
      <div
        ref={popupRef}
        className={cn("absolute left-3 right-3 z-[100] bg-card border border-border rounded-lg shadow-lg overflow-hidden")}
        style={{ top: anchorRef?.current ? anchorRef.current.offsetTop + anchorRef.current.offsetHeight + 4 : 0 }}
      >
        {step === 1 ? (
          <div className="flex flex-col max-h-[400px]">
            <div className="p-3 border-b border-border flex items-center justify-between">
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
                  placeholder="Search user..."
                  className="w-full pl-9 pr-4 py-2 bg-muted/50 rounded-lg text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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
                    <button onClick={() => toggleUser(u)} className="ml-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ maxHeight: "220px" }}>
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No users found</p>
              ) : (
                filtered.map((u) => {
                  const isSelected = selectedUsers.some((s) => s.id === u.id);
                  return (
                    <button
                      key={u.id}
                      className={cn("w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted/50", isSelected && "bg-primary/5")}
                      onClick={() => toggleUser(u)}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-[10px]">{(u.displayName || u.username).slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.displayName || u.username}</p>
                        <p className="text-[10px] text-muted-foreground truncate">@{u.username}</p>
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
              <Button size="sm" disabled={selectedUsers.length === 0} onClick={() => setStep(2)} className="gap-1">
                Proceed <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col max-h-[400px]">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold">Group Details</h3>
              <Button variant="ghost" size="icon" onClick={handleClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">Group Name</label>
                <input
                  type="text"
                  placeholder="Enter group name"
                  className="w-full px-3 py-2 bg-muted/50 rounded-lg text-sm border border-border"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">Thumbnail</label>
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
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleThumbnailUpload}
                    />
                    <span className="text-xs font-medium text-primary hover:underline">Upload image</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="p-3 border-t border-border flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Back</Button>
              <Button
                size="sm"
                disabled={!groupName.trim() || isCreating}
                onClick={handleCreate}
              >
                Create
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
