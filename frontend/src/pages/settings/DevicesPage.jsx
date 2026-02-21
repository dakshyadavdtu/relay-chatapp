import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { getActiveSessions, logoutSession } from "@/features/settings/api/sessions.api";
import { useAuth } from "@/hooks/useAuth";
import { Widget } from "@/components/settings/Widget";
import { ErrorBanner } from "@/components/settings/ErrorBanner";
import { EmptyState } from "@/components/settings/EmptyState";
import { Button } from "@/components/ui/button";
import { Loader2, Monitor, Smartphone, Tablet, Globe, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { UnauthorizedError } from "@/lib/http";

/** Devices page shows live sessions only; do not show "N sessions" per group in that mode. */
const LIVE_ONLY_UI = true;

function normalizeKey(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

function getGroupKey(session) {
  if (!session) return "unknown";
  const device = session.device;
  if (device && typeof device === "string" && device.trim()) {
    return normalizeKey(device);
  }
  const ua = session.userAgent;
  if (ua && typeof ua === "string") {
    const prefix = ua.slice(0, 80).trim();
    return normalizeKey(prefix);
  }
  return "unknown";
}

function groupSessions(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const map = new Map();
  for (const session of list) {
    const key = getGroupKey(session);
    if (!map.has(key)) {
      map.set(key, {
        key,
        sessions: [],
        hasCurrent: false,
        lastSeenAt: null,
        ip: null,
        title: session.device || (session.userAgent ? session.userAgent.slice(0, 60) : "Device"),
      });
    }
    const group = map.get(key);
    group.sessions.push(session);
    if (session.isCurrent) {
      group.hasCurrent = true;
    }
    const ts = session.lastSeenAt ? Date.parse(session.lastSeenAt) : NaN;
    if (Number.isFinite(ts) && (!group.lastSeenAt || ts > Date.parse(group.lastSeenAt))) {
      group.lastSeenAt = session.lastSeenAt;
    }
    if (session.ip && !group.ip) {
      group.ip = session.ip;
    }
  }
  return Array.from(map.values()).map((g) => ({
    ...g,
    count: g.sessions.length,
  }));
}

function formatAgo(d) {
  if (!d) return "Unknown";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function getDeviceIcon(type) {
  switch ((type || "").toLowerCase()) {
    case "mobile":
      return Smartphone;
    case "tablet":
      return Tablet;
    case "browser":
      return Globe;
    default:
      return Monitor;
  }
}

export default function DevicesPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revokingGroupKey, setRevokingGroupKey] = useState(null);
  const [, setLocation] = useLocation();
  const { logout } = useAuth();
  const { toast } = useToast();

  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await getActiveSessions({ liveOnly: true });
      const list = json?.data?.sessions ?? [];
      setSessions(Array.isArray(list) ? list : []);
    } catch (err) {
      if (err instanceof UnauthorizedError || err?.status === 401) {
        await logout();
        setLocation("/login");
        return;
      }
      setError(err?.message || "Failed to load sessions.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [logout, setLocation]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleLogoutGroup = async (group) => {
    if (!group || !Array.isArray(group.sessions) || group.sessions.length === 0) return;
    setRevokingGroupKey(group.key);
    const hasCurrent = group.hasCurrent;
    try {
      for (const session of group.sessions) {
        const sid = session?.sessionId;
        if (!sid) continue;
        try {
          await logoutSession({ sessionId: sid });
        } catch (err) {
          if (err instanceof UnauthorizedError || err?.status === 401) {
            await logout();
            setLocation("/login");
            return;
          }
          throw err;
        }
      }
      if (hasCurrent) {
        await logout();
        setLocation("/login");
        return;
      }
      const removedIds = new Set(group.sessions.map((s) => s.sessionId).filter(Boolean));
      setSessions((prev) => prev.filter((s) => !removedIds.has(s.sessionId)));
      toast({
        title: "Device logged out",
        description: group.count > 1 ? `${group.count} sessions ended on that device.` : "Session ended on that device.",
      });
    } catch (err) {
      if (err instanceof UnauthorizedError || err?.status === 401) {
        await logout();
        setLocation("/login");
        return;
      }
      toast({
        title: "Logout failed",
        description: err?.message || "Could not end session.",
        variant: "destructive",
      });
    } finally {
      setRevokingGroupKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Devices</h1>
          <p className="text-muted-foreground mt-2">Manage devices logged into your account.</p>
        </div>
        <ErrorBanner message={error} onRetry={loadSessions} />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Devices</h1>
          <p className="text-muted-foreground mt-2">Manage devices logged into your account.</p>
        </div>
        <EmptyState message="No active sessions.">
          <Button variant="outline" onClick={loadSessions}>
            Retry
          </Button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Devices</h1>
        <p className="text-muted-foreground mt-2">Manage devices logged into your account.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {groups.map((group) => {
          const Icon = getDeviceIcon(group.title);
          const isCurrent = group.hasCurrent;
          const key = group.key || `group-${group.title}`;

          return (
            <Widget
              key={key}
              className={`flex flex-col justify-between min-h-[160px] ${isCurrent ? "border-primary/50 bg-primary/5" : ""}`}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-4">
                  <div
                    className={`p-3 rounded-xl ${isCurrent ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg">{group.title}</h3>
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatAgo(group.lastSeenAt)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      {group.ip ?? "—"}
                    </p>
                    {!LIVE_ONLY_UI && group.count > 1 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {group.count} sessions
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
                <div className="text-sm">
                  {isCurrent ? (
                    <span className="flex items-center text-green-600 dark:text-green-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
                      Active now
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Last seen {formatAgo(group.lastSeenAt)}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleLogoutGroup(group)}
                  disabled={revokingGroupKey !== null}
                >
                  {revokingGroupKey === group.key ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  Log out
                </Button>
              </div>
            </Widget>
          );
        })}
      </div>
    </div>
  );
}
