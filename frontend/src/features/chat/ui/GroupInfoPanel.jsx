// ============================================================================
// Group Info Panel — wired to groups.facade.js; no mock data.
// ============================================================================
import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth, useChatStore, useSettingsStore } from "../adapters";
/** Derive raw room id from groupId/activeGroupId/roomId (handles "group-xxx" and "room:xxx"). */
function toRawRoomId(v) {
  if (v == null || typeof v !== "string") return "";
  const s = String(v).trim();
  if (s.startsWith("group-")) return s.slice(7);
  if (s.startsWith("room:")) return s.slice(5);
  return s;
}
import {
  getGroupMembers,
  getGroupInfo,
  setGroupRole,
  removeGroupMember,
  addGroupMembers,
  leaveGroup,
  deleteGroup,
  updateGroupMeta,
} from "../api/groups.facade";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, X, Shield, ShieldOff, UserMinus, Crown, LogOut, UserPlus, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "../utils/utils";

const BACKEND_ROLES = { OWNER: "OWNER", ADMIN: "ADMIN", MEMBER: "MEMBER" };

function isForbidden(err) {
  const code = err?.code ?? err?.status;
  return code === "FORBIDDEN" || code === 403 || String(code).toUpperCase() === "FORBIDDEN";
}

export function GroupInfoPanel({ groupId, roomId, activeGroupId, open, onClose }) {
  const { user } = useAuth();
  const { reducedMotion } = useSettingsStore();
  const {
    setActiveGroupId,
    setActiveConversationId,
    presenceUsers,
    users,
    usersById,
  } = useChatStore();
  const { toast } = useToast();

  const roomIdRaw = toRawRoomId(roomId ?? activeGroupId ?? groupId);

  const [membersData, setMembersData] = useState({ members: [], roles: {} });
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmRemoveUser, setConfirmRemoveUser] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberSelected, setAddMemberSelected] = useState([]);
  const [actioning, setActioning] = useState(false);

  const currentUserId = user?.id ? String(user.id) : "";

  const onlineUsers = useMemo(() => {
    if (!presenceUsers || typeof presenceUsers !== "object") return new Set();
    return new Set(Object.keys(presenceUsers).filter((uid) => presenceUsers[uid]?.online));
  }, [presenceUsers]);

  const refetch = useCallback(async () => {
    if (!roomIdRaw) return;
    setLoading(true);
    try {
      const [membersRes, infoRes] = await Promise.all([
        getGroupMembers(roomIdRaw),
        getGroupInfo(roomIdRaw).catch(() => null),
      ]);
      const members = Array.isArray(membersRes?.members) ? membersRes.members : [];
      const roles = membersRes?.roles && typeof membersRes.roles === "object" ? membersRes.roles : {};
      setMembersData({ members, roles });
      const name = infoRes?.meta?.name ?? infoRes?.name ?? "";
      setGroupName(name || `Group ${roomIdRaw}`);
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Access denied", description: "You don't have permission to view this group.", variant: "destructive" });
      } else {
        toast({ title: "Could not load group", description: e?.message ?? "Request failed", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [roomIdRaw, toast]);

  useEffect(() => {
    if (!open || !roomIdRaw) return;
    refetch();
  }, [open, roomIdRaw, refetch]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setConfirmRemoveUser(null);
        setConfirmLeave(false);
        setConfirmDelete(false);
        setAddMemberOpen(false);
        onClose();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  const myRole = (membersData.roles[currentUserId] ?? BACKEND_ROLES.MEMBER).toUpperCase();
  const isOwner = myRole === BACKEND_ROLES.OWNER;
  const canManageMembers = myRole === BACKEND_ROLES.OWNER || myRole === BACKEND_ROLES.ADMIN;
  const canDelete = isOwner;

  const membersForDisplay = useMemo(() => {
    const uById = usersById ?? {};
    return (membersData.members || []).map((uid) => {
      const id = String(uid);
      const role = (membersData.roles[id] ?? BACKEND_ROLES.MEMBER).toUpperCase();
      const u = uById[id];
      const displayName = u?.displayName ?? u?.username ?? id.slice(0, 8);
      return {
        userId: id,
        id,
        role: role === BACKEND_ROLES.OWNER || role === BACKEND_ROLES.ADMIN ? "admin" : "member",
        backendRole: role,
        user: { displayName, username: u?.username ?? id },
      };
    });
  }, [membersData.members, membersData.roles, usersById]);

  const filteredMembers = useMemo(() => {
    const q = (searchQuery || "").toLowerCase();
    if (!q) return membersForDisplay;
    return membersForDisplay.filter(
      (m) =>
        (m.user?.displayName ?? "").toLowerCase().includes(q) ||
        (m.user?.username ?? "").toLowerCase().includes(q)
    );
  }, [membersForDisplay, searchQuery]);

  const admins = filteredMembers.filter((m) => m.role === "admin");
  const regulars = filteredMembers.filter((m) => m.role !== "admin");

  const handleSaveName = async () => {
    if (!groupName.trim() || !roomIdRaw) return;
    setSaving(true);
    try {
      await updateGroupMeta(roomIdRaw, { name: groupName.trim() });
      toast({ title: "Group updated", description: "Name saved." });
      const info = await getGroupInfo(roomIdRaw).catch(() => null);
      if (info?.meta?.name != null) setGroupName(info.meta.name);
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Not allowed", description: "You cannot edit this group.", variant: "destructive" });
      } else {
        toast({ title: "Update failed", description: e?.message ?? "Could not save.", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleChangeRole = async (memberId, isAdmin) => {
    if (!roomIdRaw || !memberId) return;
    setActioning(true);
    const newRole = isAdmin ? BACKEND_ROLES.MEMBER : BACKEND_ROLES.ADMIN;
    try {
      await setGroupRole(roomIdRaw, memberId, newRole);
      toast({ title: "Role updated", description: `User is now ${newRole}.` });
      await refetch();
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Not allowed", description: "You cannot change roles.", variant: "destructive" });
      } else {
        toast({ title: "Failed", description: e?.message ?? "Could not update role.", variant: "destructive" });
      }
    } finally {
      setActioning(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!roomIdRaw || !memberId) return;
    setConfirmRemoveUser(null);
    setActioning(true);
    try {
      await removeGroupMember(roomIdRaw, memberId);
      toast({ title: "Member removed", description: "User removed from group." });
      await refetch();
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Not allowed", description: "You cannot remove this member.", variant: "destructive" });
      } else {
        toast({ title: "Failed", description: e?.message ?? "Could not remove.", variant: "destructive" });
      }
    } finally {
      setActioning(false);
    }
  };

  const handleLeave = async () => {
    if (!roomIdRaw) return;
    setConfirmLeave(false);
    setActioning(true);
    try {
      await leaveGroup(roomIdRaw);
      setActiveConversationId(null);
      setActiveGroupId(null);
      onClose();
      toast({ title: "Left group", description: "You have left the group." });
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Not allowed", description: "You cannot leave.", variant: "destructive" });
      } else {
        toast({ title: "Failed", description: e?.message ?? "Could not leave.", variant: "destructive" });
      }
    } finally {
      setActioning(false);
    }
  };

  const handleDelete = async () => {
    if (!roomIdRaw) return;
    setConfirmDelete(false);
    setActioning(true);
    try {
      await deleteGroup(roomIdRaw);
      setActiveConversationId(null);
      setActiveGroupId(null);
      onClose();
      toast({ title: "Group deleted", description: "The group has been deleted." });
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Not allowed", description: "Only the owner can delete the group.", variant: "destructive" });
      } else {
        toast({ title: "Failed", description: e?.message ?? "Could not delete.", variant: "destructive" });
      }
    } finally {
      setActioning(false);
    }
  };

  const handleAddMembers = async () => {
    if (!roomIdRaw || addMemberSelected.length === 0) return;
    setActioning(true);
    try {
      await addGroupMembers(roomIdRaw, addMemberSelected);
      setAddMemberOpen(false);
      setAddMemberSelected([]);
      toast({ title: "Members added", description: `${addMemberSelected.length} member(s) added.` });
      await refetch();
    } catch (e) {
      if (isForbidden(e)) {
        toast({ title: "Not allowed", description: "You cannot add members.", variant: "destructive" });
      } else {
        toast({ title: "Failed", description: e?.message ?? "Could not add members.", variant: "destructive" });
      }
    } finally {
      setActioning(false);
    }
  };

  const usersNotInGroup = useMemo(() => {
    const inGroup = new Set(membersData.members.map(String));
    const list = Array.isArray(users) ? users : [];
    return list.filter((u) => {
      const id = u?.id ? String(u.id) : "";
      return id && !inGroup.has(id);
    });
  }, [users, membersData.members]);

  if (!open) return null;

  if (loading && membersData.members.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center text-white" data-testid="group-info-loading">
        Loading...
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose} data-testid="group-info-overlay">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className={cn(
          "relative bg-card w-full max-w-md max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col",
          !reducedMotion && "animate-in fade-in zoom-in-95 duration-200"
        )}
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
            <Button size="sm" onClick={handleSaveName} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
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

          {canManageMembers && (
            <div>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => setAddMemberOpen(true)}
                disabled={actioning || usersNotInGroup.length === 0}
              >
                <UserPlus className="w-4 h-4" /> Add member
              </Button>
            </div>
          )}

          {[
            { title: "ADMINS", list: admins },
            { title: "MEMBERS", list: regulars },
          ].map(
            (section) =>
              section.list.length > 0 && (
                <div key={section.title}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    {section.title} ({section.list.length})
                  </h4>
                  <div className="space-y-1">
                    {section.list.map((member) => {
                      const memberId = member.userId;
                      const isMe = memberId === currentUserId;
                      const isAdmin = member.role === "admin";
                      const isOwnerMember = member.backendRole === BACKEND_ROLES.OWNER;
                      return (
                        <div
                          key={memberId}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors"
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarFallback>{(member.user?.displayName || "??").slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium truncate">
                                {member.user?.displayName || member.user?.username}
                              </span>
                              {isMe && <span className="text-xs text-muted-foreground">(Me)</span>}
                              {(isAdmin || isOwnerMember) && (
                                <Crown className="w-3.5 h-3.5 text-yellow-500" />
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {onlineUsers.has(memberId) ? "Active now" : "Offline"}
                            </span>
                          </div>
                          {canManageMembers && !isMe && !isOwnerMember && (
                            <div className="flex items-center gap-1 shrink-0">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="secondary"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleChangeRole(memberId, isAdmin)}
                                      disabled={actioning}
                                    >
                                      {isAdmin ? (
                                        <ShieldOff className="w-3.5 h-3.5" />
                                      ) : (
                                        <Shield className="w-3.5 h-3.5" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isAdmin ? "Demote" : "Promote"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="secondary"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => setConfirmRemoveUser(memberId)}
                                      disabled={actioning}
                                    >
                                      <UserMinus className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Remove</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
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
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={() => (isOwner ? setConfirmDelete(true) : setConfirmLeave(true))}
              disabled={actioning}
            >
              {isOwner ? <Trash2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
              {isOwner ? "Delete group" : "Leave group"}
            </Button>
          </div>
        </div>

        {confirmRemoveUser && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 p-4">
            <div className="bg-card rounded-xl shadow-xl p-5 max-w-[280px] w-full animate-in fade-in zoom-in-95">
              <p className="text-sm font-medium mb-4">Remove this user from the group?</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveUser(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleRemoveMember(confirmRemoveUser)}>
                  Remove
                </Button>
              </div>
            </div>
          </div>
        )}

        {confirmLeave && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 p-4">
            <div className="bg-card rounded-xl shadow-xl p-5 max-w-[280px] w-full animate-in fade-in zoom-in-95">
              <p className="text-sm font-medium mb-4">Leave this group?</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={handleLeave}>
                  Leave
                </Button>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 p-4">
            <div className="bg-card rounded-xl shadow-xl p-5 max-w-[280px] w-full animate-in fade-in zoom-in-95">
              <p className="text-sm font-medium mb-4">Delete this group? This cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}

        {addMemberOpen && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10 p-4">
            <div className="bg-card rounded-xl shadow-xl p-5 max-w-[320px] w-full max-h-[70vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
              <p className="text-sm font-bold mb-2">Add members</p>
              <div className="flex-1 overflow-y-auto space-y-1 mb-4">
                {usersNotInGroup.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No one else to add.</p>
                ) : (
                  usersNotInGroup.map((u) => {
                    const id = String(u?.id ?? "");
                    const selected = addMemberSelected.includes(id);
                    return (
                      <div
                        key={id}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors",
                          selected ? "bg-primary/20" : "hover:bg-muted/50"
                        )}
                        onClick={() =>
                          setAddMemberSelected((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                          )
                        }
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>{(u?.displayName || id).slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm truncate flex-1">{u?.displayName || u?.username || id}</span>
                        {selected && <span className="text-xs text-muted-foreground">Selected</span>}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setAddMemberOpen(false); setAddMemberSelected([]); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddMembers} disabled={actioning || addMemberSelected.length === 0}>
                  Add {addMemberSelected.length ? `(${addMemberSelected.length})` : ""}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
