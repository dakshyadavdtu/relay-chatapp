/**
 * Admin Users page.
 * Phase 8B: Wired to GET /api/admin/users.
 * B3: Ban / Unban / Revoke Sessions wired to POST /api/admin/users/:id/ban | unban | revoke-sessions.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  ShieldAlert,
  Clock,
  ShieldX,
  UserCheck,
  Laptop,
  Smartphone,
  Monitor,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { useAdminUsers, useAdminUserSessions } from "@/features/admin/adapters";
import { adminBanUser, adminUnbanUser, adminRevokeSessions, adminRevokeOneSession, setUserRole } from "@/features/admin/api/admin.api";

function sessionIcon(device) {
  const d = (device || "").toLowerCase();
  if (d.includes("iphone") || d.includes("ipad") || d.includes("android")) return Smartphone;
  if (d.includes("mac") || d.includes("linux")) return Laptop;
  return Monitor;
}

export default function AdminUsersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const timerRef = useRef(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQ(searchTerm), 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [searchTerm]);

  const { users: usersData, loading, error, forbidden, unauthorized, canRetry, refetch: refetchUsers } = useAdminUsers({ q: debouncedQ });
  const [selectedUserId, setSelectedUserId] = useState(null);
  const { user: viewer } = useAuth();
  // Exclude current user from directory so admin does not see themselves in the list
  const baseListUsers = (usersData ?? []).filter((u) => u.id !== viewer?.id);
  // Dev-only: ?fixture=users adds 100 fake users to verify widget fixed height + internal scroll
  const fixtureCount =
    typeof import.meta !== "undefined" &&
    import.meta.env?.DEV &&
    typeof window !== "undefined" &&
    window.location?.search?.includes("fixture=users")
      ? 100
      : 0;
  const fixtureUsers = useMemo(
    () =>
      fixtureCount > 0
        ? Array.from({ length: fixtureCount }, (_, i) => ({
            id: `fixture-${i}`,
            username: `Fixture User ${i}`,
            email: `user${i}@example.com`,
            role: "USER",
            lastSeen: "—",
            status: "offline",
          }))
        : [],
    [fixtureCount]
  );
  const listUsers = fixtureCount > 0 ? [...baseListUsers, ...fixtureUsers] : baseListUsers;
  const selectedUser = selectedUserId ? (usersData.find((u) => u.id === selectedUserId) ?? null) : null;
  const { sessions, refetch: refetchSessions } = useAdminUserSessions(selectedUserId ?? null);
  const [actionLoading, setActionLoading] = useState({ ban: false, unban: false, revoke: false, role: false, revokingSessionId: null });
  const { toast } = useToast();

  useEffect(() => {
    const filtered = (usersData ?? []).filter((u) => u.id !== viewer?.id);
    if (filtered.length > 0 && !selectedUserId) setSelectedUserId(filtered[0].id);
    if (selectedUserId === viewer?.id) setSelectedUserId(filtered[0]?.id ?? null);
  }, [usersData, selectedUserId, viewer?.id]);

  const activeSessions = (sessions ?? []).filter((s) => s.revokedAt == null);

  const handleBan = useCallback(async () => {
    if (!selectedUser?.id || actionLoading.ban) return;
    setActionLoading((prev) => ({ ...prev, ban: true }));
    try {
      await adminBanUser(selectedUser.id);
      toast({ title: "User banned", description: `${selectedUser.username ?? selectedUser.id} has been banned.`, variant: "default" });
      await refetchUsers();
      await refetchSessions();
    } catch (e) {
      const msg = e?.message ?? "Failed to ban user";
      const code = e?.code ? ` (${e.code})` : "";
      toast({ title: "Ban failed", description: `${msg}${code}`, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, ban: false }));
    }
  }, [selectedUser?.id, selectedUser?.username, actionLoading.ban, refetchUsers, refetchSessions, toast]);

  const handleUnban = useCallback(async () => {
    if (!selectedUser?.id || actionLoading.unban) return;
    setActionLoading((prev) => ({ ...prev, unban: true }));
    try {
      await adminUnbanUser(selectedUser.id);
      toast({ title: "User unbanned", description: `${selectedUser.username ?? selectedUser.id} has been unbanned.`, variant: "default" });
      await refetchUsers();
      await refetchSessions();
    } catch (e) {
      const msg = e?.message ?? "Failed to unban user";
      const code = e?.code ? ` (${e.code})` : "";
      toast({ title: "Unban failed", description: `${msg}${code}`, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, unban: false }));
    }
  }, [selectedUser?.id, selectedUser?.username, actionLoading.unban, refetchUsers, refetchSessions, toast]);

  const handleRevokeSessions = useCallback(async () => {
    if (!selectedUser?.id || actionLoading.revoke) return;
    setActionLoading((prev) => ({ ...prev, revoke: true }));
    try {
      await adminRevokeSessions(selectedUser.id);
      toast({ title: "Sessions revoked", description: `All sessions for ${selectedUser.username ?? selectedUser.id} have been revoked.`, variant: "default" });
      await refetchUsers();
      await refetchSessions();
    } catch (e) {
      const msg = e?.message ?? "Failed to revoke sessions";
      const code = e?.code ? ` (${e.code})` : "";
      toast({ title: "Revoke failed", description: `${msg}${code}`, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, revoke: false }));
    }
  }, [selectedUser?.id, selectedUser?.username, actionLoading.revoke, refetchUsers, refetchSessions, toast]);

  const handleSetRole = useCallback(async () => {
    if (!selectedUser?.id || actionLoading.role) return;
    const isAdmin = selectedUser.role === "admin";
    const newRole = isAdmin ? "USER" : "ADMIN";
    setActionLoading((prev) => ({ ...prev, role: true }));
    try {
      await setUserRole(selectedUser.id, newRole);
      toast({
        title: isAdmin ? "Admin revoked" : "User promoted",
        description: `${selectedUser.username ?? selectedUser.id} is now ${newRole.toLowerCase()}.`,
        variant: "default",
      });
      await refetchUsers();
      await refetchSessions();
    } catch (e) {
      const msg = e?.message ?? (isAdmin ? "Failed to revoke admin" : "Failed to promote to admin");
      const code = e?.code ? ` (${e.code})` : "";
      toast({ title: "Role change failed", description: `${msg}${code}`, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, role: false }));
    }
  }, [selectedUser?.id, selectedUser?.username, selectedUser?.role, actionLoading.role, refetchUsers, refetchSessions, toast]);

  const handleRevokeOneSession = useCallback(async (sessionId) => {
    if (!selectedUser?.id || !sessionId || actionLoading.revokingSessionId) return;
    setActionLoading((prev) => ({ ...prev, revokingSessionId: sessionId }));
    try {
      await adminRevokeOneSession(selectedUser.id, sessionId);
      toast({ title: "Session revoked", description: "Device session has been revoked.", variant: "default" });
      await refetchUsers();
      await refetchSessions();
    } catch (e) {
      const msg = e?.message ?? "Failed to revoke session";
      const code = e?.code ? ` (${e.code})` : "";
      toast({ title: "Revoke failed", description: `${msg}${code}`, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, revokingSessionId: null }));
    }
  }, [selectedUser?.id, actionLoading.revokingSessionId, refetchUsers, refetchSessions, toast]);

  if (unauthorized) {
    return (
      <div className="space-y-6">
        <div className="p-6 border border-destructive/50 rounded-xl bg-destructive/10">
          <p className="text-destructive font-medium">Login required</p>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        <div className="p-6 border border-destructive/50 rounded-xl bg-destructive/10">
          <p className="text-destructive font-medium">Admin role required</p>
        </div>
      </div>
    );
  }

  if (loading && usersData.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Loading users…</div>
      </div>
    );
  }

  if (error && usersData.length === 0) {
    return (
      <div className="space-y-6">
        <div className="p-6 border border-destructive/50 rounded-xl bg-destructive/10">
          <p className="text-destructive font-medium">{error}</p>
          {canRetry && (
            <Button onClick={() => refetchUsers()} className="mt-4">
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-hidden flex flex-col min-h-0">
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Users</h1>
          <p className="text-muted-foreground">
            Manage and monitor user sessions.
          </p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search users..."
              className="pl-8 bg-background"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 min-w-0 grid-rows-[minmax(0,1fr)]">
        {/* User Directory: fixed max height so adding users does not expand widget or trigger page scaling */}
        <Card className="flex flex-col h-full max-h-[min(65vh,480px)] min-h-[280px] w-full min-w-0 shrink-0 shadow-md border-border/50 overflow-hidden">
          <CardHeader className="px-4 py-3 border-b bg-muted/20 shrink-0">
            <CardTitle className="text-base font-medium">User Directory</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar">
              <div className="divide-y divide-border/50 pb-2">
                {listUsers.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => setSelectedUserId(user.id)}
                    className={cn(
                      "flex items-center p-4 cursor-pointer hover:bg-muted/50 transition-colors min-w-0",
                      selectedUserId === user.id && "bg-muted/80 border-l-4 border-l-primary"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative shrink-0">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold bg-secondary text-secondary-foreground border border-border",
                            user.flagged && "ring-2 ring-destructive ring-offset-2"
                          )}
                        >
                          {user.username.substring(0, 2).toUpperCase()}
                        </div>
                        <span
                          className={cn(
                            "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background",
                            user.status === "online" ? "bg-emerald-500" : "bg-zinc-400"
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm flex items-center gap-2 min-w-0">
                          <span className="truncate" title={user.username}>
                            {user.username}
                          </span>
                          {user.flagged && (
                            <ShieldAlert className="w-3 h-3 text-destructive animate-pulse shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
                          <span className="font-bold truncate">{user.role}</span>
                          <span className="shrink-0">•</span>
                          <span className="flex items-center gap-0.5 truncate">
                            <Clock className="w-2.5 h-2.5 shrink-0" /> {user.lastSeen ?? "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {listUsers.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No users found{debouncedQ ? ` matching "${debouncedQ}"` : ""}.
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 flex flex-col h-full min-w-0 gap-6 overflow-hidden">
          {selectedUser && (
            <Card className="flex-1 shadow-md border-border/50 flex flex-col overflow-hidden min-h-0">
              <CardHeader className="border-b bg-muted/10 shrink-0">
                <div className="flex items-center justify-between min-w-0">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-xl flex items-center gap-2 flex-wrap min-w-0">
                      <span className="truncate" title={selectedUser.username}>{selectedUser.username}</span>
                      <Badge
                        variant={selectedUser.status === "online" ? "default" : "secondary"}
                        className={cn(
                          selectedUser.status === "online" && "bg-emerald-500 hover:bg-emerald-600"
                        )}
                      >
                        {selectedUser.status}
                      </Badge>
                      {selectedUser.banned && (
                        <Badge variant="destructive" className="text-xs">Banned</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 truncate" title={selectedUser.email ?? selectedUser.id}>
                      {selectedUser.email ?? selectedUser.id}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-6">
                    <div className="flex flex-wrap gap-2 mb-8">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8"
                        disabled={selectedUser.banned || actionLoading.ban}
                        onClick={handleBan}
                      >
                        <ShieldX className="w-3.5 h-3.5 mr-2" /> Ban User
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={!selectedUser.banned || actionLoading.unban}
                        onClick={handleUnban}
                      >
                        <UserCheck className="w-3.5 h-3.5 mr-2" /> Unban
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-destructive hover:text-destructive font-bold uppercase tracking-widest text-[10px]"
                        disabled={actionLoading.revoke}
                        onClick={handleRevokeSessions}
                      >
                        Revoke Sessions
                      </Button>
                      {viewer?.isRootAdmin && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 font-bold uppercase tracking-widest text-[10px]"
                                disabled={
                                  actionLoading.role ||
                                  selectedUser.id === viewer?.id ||
                                  selectedUser.isRootAdmin
                                }
                                onClick={selectedUser.isRootAdmin ? undefined : handleSetRole}
                              >
                                {selectedUser.isRootAdmin
                                  ? "Root (locked)"
                                  : selectedUser.role === "admin"
                                    ? "Revoke Admin"
                                    : "Make Admin"}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {selectedUser.isRootAdmin
                              ? "Root admin cannot be demoted."
                              : selectedUser.id === viewer?.id
                                ? "You cannot change your own role."
                                : selectedUser.role === "admin"
                                  ? "Revoke admin role (user will lose admin panel access)."
                                  : "Grant admin role (user will gain admin panel access)."}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-bold text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <Laptop className="w-4 h-4" /> Active Sessions
                      </h3>
                      <div className="space-y-2">
                        {activeSessions.length === 0 ? (
                          <div className="p-4 rounded-lg border bg-muted/20 text-sm text-muted-foreground">
                            No active sessions
                          </div>
                        ) : (
                          activeSessions.map((session) => {
                            const IconComponent = sessionIcon(session.device);
                            return (
                              <div
                                key={session.id}
                                className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-muted/20 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded bg-muted text-muted-foreground">
                                    <IconComponent className="w-4 h-4" />
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="text-sm font-medium flex items-center gap-2">
                                      {session.device ?? "—"}
                                      {session.current && (
                                        <Badge
                                          variant="secondary"
                                          className="text-[8px] h-3.5 bg-emerald-500/10 text-emerald-600 uppercase"
                                        >
                                          Current
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                                      <span>{session.ip ?? "—"}</span>
                                      <span>•</span>
                                      <span>{session.location ?? "—"}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-[10px] text-destructive hover:bg-destructive/10 font-bold uppercase tracking-widest"
                                          disabled={actionLoading.revoke || actionLoading.revokingSessionId === session.sessionId}
                                          onClick={() => handleRevokeOneSession(session.sessionId)}
                                        >
                                          {actionLoading.revokingSessionId === session.sessionId ? "…" : "Revoke"}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Revoke this device session.
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-[10px] text-destructive hover:bg-destructive/10 font-bold uppercase tracking-widest"
                                          disabled={actionLoading.revoke || !!actionLoading.revokingSessionId}
                                          onClick={handleRevokeSessions}
                                        >
                                          Revoke all
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Revoke all sessions for this user.
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
