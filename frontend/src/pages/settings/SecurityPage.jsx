import { useChangePassword } from "@/hooks/useChangePassword";
import { Widget } from "@/components/settings/Widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/useToast";
import { Loader2, Lock, Eye, EyeOff, ShieldCheck, MapPin, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getActiveSessions } from "@/features/settings/api/sessions.api";
import { UnauthorizedError } from "@/lib/http";

function formatAgo(value) {
  if (!value) return null;
  const ts = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function SecurityPage() {
  const { toast } = useToast();
  const { mutate: changePassword, isPending } = useChangePassword();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadingSessions(true);
        setSessionsError(null);
        const json = await getActiveSessions();
        const next = json?.data?.sessions ?? [];
        if (!mounted) return;
        setSessions(Array.isArray(next) ? next : []);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof UnauthorizedError) {
          setSessions([]);
          setSessionsError("unauthorized");
          return;
        }
        setSessionsError("error");
      } finally {
        if (mounted) setLoadingSessions(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const { currentSession, lastSession, deviceTitle, lastSeenAt, activeNow, ip } = useMemo(() => {
    const safe = Array.isArray(sessions) ? sessions : [];
    const current = safe.find((s) => !!s?.isCurrent) ?? null;
    const sorted = [...safe].sort((a, b) => {
      const at = a?.lastSeenAt != null ? Date.parse(a.lastSeenAt) : NaN;
      const bt = b?.lastSeenAt != null ? Date.parse(b.lastSeenAt) : NaN;
      const av = Number.isFinite(at) ? at : 0;
      const bv = Number.isFinite(bt) ? bt : 0;
      return bv - av;
    });
    const last = sorted[0] ?? null;
    const title =
      current?.device ||
      last?.device ||
      current?.userAgent ||
      last?.userAgent ||
      "Unknown device";
    const seen = current?.lastSeenAt || last?.lastSeenAt || null;
    const ipAddr = current?.ip || last?.ip || null;
    return {
      currentSession: current,
      lastSession: last,
      deviceTitle: title,
      lastSeenAt: seen,
      activeNow: !!current,
      ip: ipAddr,
    };
  }, [sessions]);

  const onSubmit = (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords don't match", variant: "destructive" });
      return;
    }
    changePassword(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast({ title: "Password updated", description: "Your password has been changed successfully." });
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      }
    );
  };

  const hasMinLen = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Security</h1>
        <p className="text-muted-foreground mt-2">Manage your password and security preferences.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Widget className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-border/50">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold">Change Password</h3>
              <p className="text-sm text-muted-foreground">Update your password regularly to stay safe.</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  className="pr-10"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNew ? "text" : "password"}
                    className="pr-10"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium mb-2">Password Requirements:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className={`flex items-center gap-2 ${hasMinLen ? "text-green-500" : "text-muted-foreground"}`}>
                  <ShieldCheck className="w-4 h-4" /> 8+ Characters
                </div>
                <div className={`flex items-center gap-2 ${hasUpper ? "text-green-500" : "text-muted-foreground"}`}>
                  <ShieldCheck className="w-4 h-4" /> Uppercase Letter
                </div>
                <div className={`flex items-center gap-2 ${hasLower ? "text-green-500" : "text-muted-foreground"}`}>
                  <ShieldCheck className="w-4 h-4" /> Lowercase Letter
                </div>
                <div className={`flex items-center gap-2 ${hasNumber ? "text-green-500" : "text-muted-foreground"}`}>
                  <ShieldCheck className="w-4 h-4" /> Number
                </div>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Update Password
              </Button>
            </div>
          </form>
        </Widget>

        <Widget className="space-y-4 h-fit">
          <div className="flex items-center gap-3 pb-4 border-b border-border/50">
            <div className="p-2 bg-green-500/10 rounded-lg text-green-500">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold">Recent Activity</h3>
              <p className="text-sm text-muted-foreground">Last login details.</p>
            </div>
          </div>
          <div className="space-y-4">
            {loadingSessions ? (
              <p className="text-sm text-muted-foreground">Loading activity…</p>
            ) : sessionsError === "unauthorized" ? (
              <p className="text-sm text-muted-foreground">You're logged out.</p>
            ) : sessionsError ? (
              <p className="text-sm text-muted-foreground">Could not load activity.</p>
            ) : !sessions?.length ? (
              <p className="text-sm text-muted-foreground">No recent sessions found.</p>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <Smartphone className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-medium truncate max-w-[60ch]">{deviceTitle}</p>
                    {activeNow ? (
                      <p className="text-xs text-muted-foreground">Last login {formatAgo(lastSeenAt) ?? "unknown"}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Last seen {formatAgo(lastSeenAt) ?? "unknown"}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">IP: {ip ?? "—"}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 flex items-center justify-center">
                    {activeNow ? (
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                    )}
                  </div>
                  <div>
                    {activeNow ? (
                      <>
                        <p className="font-medium text-green-600 dark:text-green-400">Active Now</p>
                        <p className="text-xs text-muted-foreground">This current browser</p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">Inactive</p>
                        <p className="text-xs text-muted-foreground">Last seen {formatAgo(lastSeenAt) ?? "unknown"}</p>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </Widget>
      </div>
    </div>
  );
}
