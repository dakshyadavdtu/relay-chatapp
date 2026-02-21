/**
 * Admin Dashboard page.
 * Phase 8A: Ported from our admin copy 4; uses useAdminDashboard + series/activity/stats adapters.
 * All data from backend: no hardcoded trafficData, activityFeed, or badge values.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  MessageSquare,
  ShieldAlert,
  Wifi,
  Zap,
  UserCheck,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";
import { useMemo } from "react";
import {
  useAdminDashboard,
  useAdminDashboardTimeseries,
  useAdminDashboardStats,
  useAdminDashboardActivity,
} from "@/features/admin/adapters";
import { useAuth } from "@/hooks/useAuth";

const TYPE_ICON = {
  report: AlertTriangle,
  ban: ShieldAlert,
  flag: Zap,
  spike: Wifi,
  failure: Activity,
  connect: Wifi,
  disconnect: Wifi,
  admin: ShieldAlert,
};

const TYPE_COLOR = {
  report: "text-yellow-500",
  ban: "text-red-500",
  flag: "text-purple-500",
  spike: "text-blue-500",
  failure: "text-orange-500",
  connect: "text-emerald-500",
  disconnect: "text-slate-500",
  admin: "text-blue-500",
};

function formatTimeAgo(ts) {
  if (!ts || typeof ts !== "number") return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return "just now";
}

const TOOLTIP_CONTENT_STYLE = {
  borderRadius: "8px",
  border: "none",
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
};

/**
 * Custom tooltip for System Performance chart. Reads from payload to avoid
 * Recharts dual YAxis formatter bug (right-axis series value comes as undefined).
 */
function SystemPerfTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const msg = payload.find((p) => p.dataKey === "messages")?.value;
  const conn = payload.find((p) => p.dataKey === "connections")?.value;
  const messagesText = Number.isFinite(+msg) ? (+msg).toFixed(2) : "0.00";
  const connectionsText = Number.isFinite(+conn) ? String(Math.round(+conn)) : "0";
  const timeLabel = payload[0]?.payload?.name ?? label;
  return (
    <div
      className="px-3 py-2 rounded-lg border-none shadow-md bg-background text-foreground"
      style={TOOLTIP_CONTENT_STYLE}
    >
      {timeLabel != null && timeLabel !== "" && (
        <p className="text-xs font-medium text-muted-foreground mb-1.5">{timeLabel}</p>
      )}
      <div className="space-y-0.5 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Connections</span>
          <span className="font-medium">{connectionsText}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Messages (msg/s)</span>
          <span className="font-medium">{messagesText}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Parse detail string into key=value pairs for chip-style display.
 * Handles "key=value key2=value2" and values with spaces (e.g. "reason=Normal closure").
 * Returns array of { key, value } or null if not parseable as key=value pairs.
 */
function parseDetailPairs(detail) {
  if (typeof detail !== "string" || !detail.trim()) return null;
  const tokens = detail.trim().split(/\s+/);
  if (tokens.length === 0) return null;
  const pairs = [];
  let currentKey = null;
  let currentValue = null;
  for (const t of tokens) {
    if (t.includes("=")) {
      if (currentKey != null) pairs.push({ key: currentKey, value: currentValue || "" });
      const idx = t.indexOf("=");
      currentKey = t.slice(0, idx);
      currentValue = t.slice(idx + 1);
    } else {
      currentValue = currentValue != null ? `${currentValue} ${t}` : t;
    }
  }
  if (currentKey != null) pairs.push({ key: currentKey, value: currentValue || "" });
  return pairs.length > 0 ? pairs : null;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { stats, loading, error, forbidden, unauthorized, canRetry, refetch, hasHadSuccess } = useAdminDashboard();
  const { points: timeseriesPoints } = useAdminDashboardTimeseries({ windowSeconds: 86400, bucketSeconds: 3600 });
  const { stats: extendedStats } = useAdminDashboardStats();
  const { events: activityEvents } = useAdminDashboardActivity({ limit: 25, windowSeconds: 86400 });

  // Hooks must run unconditionally (before any early return) to avoid "Rendered fewer hooks than expected"
  // Plot using backend timestamps only. X-axis is strictly index-based (0..59) so tick spacing is always uniform; time is shown only as the label.
  const CHART_WINDOW_LENGTH = 60;
  const chartData = useMemo(() => {
    const points = timeseriesPoints ?? [];
    const limitedPoints = points.slice(-CHART_WINDOW_LENGTH);
    let arr = limitedPoints.map((p) => {
      const ts = typeof p.ts === "number" ? p.ts : (p.time ? new Date(p.time).getTime() : 0);
      let timeStr = "—";
      if (typeof p.label === "string" && p.label.trim()) {
        timeStr = p.label;
      } else if (p.time) {
        if (typeof p.time === "string") {
          timeStr = p.time.slice(11, 19);
        } else {
          const d = new Date(ts);
          timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        }
      } else if (ts > 0) {
        const d = new Date(ts);
        timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
      return {
        index: 0,
        ts,
        name: timeStr,
        messages: typeof p.messagesPerSecond === "number" ? p.messagesPerSecond : (typeof p.messages === "number" ? p.messages : Number(p.messages) || 0),
        connections: typeof p.connections === "number" ? p.connections : (Number(p.connections) || 0),
      };
    });
    while (arr.length < CHART_WINDOW_LENGTH) {
      arr = [{ index: 0, ts: 0, name: "", messages: 0, connections: 0 }, ...arr];
    }
    return arr.map((item, i) => ({ ...item, index: i }));
  }, [timeseriesPoints]);

  // Right Y-axis domain for messages (msg/s): scale to data so small rates (e.g. 0.02–0.1) are visible.
  const messagesYDomain = useMemo(() => {
    if (!chartData.length) return [0, 0.1];
    const maxMsg = Math.max(...chartData.map((d) => Number(d.messages) || 0), 0);
    const top = Math.max(0.1, maxMsg * 1.2, 0.05);
    return [0, Math.round(top * 100) / 100];
  }, [chartData]);

  if (user && String(user.role || "").toUpperCase() !== "ADMIN") {
    return (
      <div className="space-y-6">
        <div className="p-6 border border-destructive/50 rounded-xl bg-destructive/10">
          <p className="text-destructive font-medium">Admin access required</p>
          <p className="text-sm text-muted-foreground mt-1">You don’t have permission to view this page.</p>
        </div>
      </div>
    );
  }

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

  if (loading && !hasHadSuccess) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Loading dashboard…</div>
      </div>
    );
  }

  const {
    onlineUsers = 0,
    messagesPerSecond = 0,
    messagesPerSecondAvg60 = undefined,
    messagesLastMinute = 0,
    latencyAvg = 0,
    suspiciousFlags = 0,
    adminsCount = 0,
    regularUsersCount = 0,
  } = stats ?? {};

  const totalRole = adminsCount + regularUsersCount;
  const adminsPct = totalRole > 0 ? Math.round((adminsCount / totalRole) * 100) : 0;
  const usersPct = totalRole > 0 ? Math.round((regularUsersCount / totalRole) * 100) : 0;

  const activityItems = (activityEvents ?? []).map((ev, idx) => ({
    id: ev.id ?? `activity-${idx}`,
    type: ev.type,
    title: ev.title ?? "",
    detail: ev.detail ?? null,
    detailPairs: parseDetailPairs(ev.detail),
    time: formatTimeAgo(ev.ts),
    icon: TYPE_ICON[ev.type] ?? Activity,
    color: TYPE_COLOR[ev.type] ?? "text-muted-foreground",
  }));

  const mpsPeak = extendedStats?.messagesPerSecondPeak;
  const mpsP95 = extendedStats?.messagesPerSecondP95;
  const latencyMax = extendedStats?.latencyMaxMs;
  const latencyP95 = extendedStats?.latencyAvgP95;
  const flagsDelta = extendedStats?.suspiciousFlagsDeltaLastHour;

  // Avg must match "Last 60s: N msgs" so the widget is consistent: avg = N/60 (messages per second over the same window).
  const formatMps = (mps) => (Number.isFinite(mps) ? Number(mps).toFixed(2) : "0.00");
  const avgMps = typeof messagesLastMinute === "number" && messagesLastMinute >= 0
    ? Math.round((messagesLastMinute / 60) * 100) / 100
    : (messagesPerSecondAvg60 != null ? messagesPerSecondAvg60 : messagesPerSecond);
  const displayMps = formatMps(avgMps);
  const formatBadgeMps = (v) => (v !== undefined && v !== null && Number.isFinite(v) ? formatMps(v) : "—");
  const formatBadgeMs = (v) => (v !== undefined && v !== null && Number.isFinite(v) ? `${Number(v)}ms` : "—");
  const displayMpsPeak = formatBadgeMps(mpsPeak);
  const displayMpsP95 = formatBadgeMps(mpsP95);
  const displayLatencyMax = formatBadgeMs(latencyMax);
  const displayLatencyP95 = formatBadgeMs(latencyP95);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          System overview and real-time performance metrics.
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-amber-500/50 bg-amber-500/10">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Degraded: failed to refresh ({error}). Showing last known data.
          </p>
          {canRetry && (
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">
        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Online Users</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{onlineUsers.toLocaleString()}</div>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                <span>Admins: {adminsCount}</span>
                <span>Users: {regularUsersCount.toLocaleString()}</span>
              </div>
              <div className="h-1 w-full bg-muted rounded-full overflow-hidden flex">
                <div className="h-full bg-primary" style={{ width: `${adminsPct}%` }} />
                <div className="h-full bg-emerald-500" style={{ width: `${usersPct}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Messages Per Second</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{displayMps}<span className="text-sm font-normal text-muted-foreground ml-1">avg</span></div>
            <div className="text-sm text-muted-foreground">Last 60s: {messagesLastMinute} msgs</div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-[10px] h-4 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">PEAK: {displayMpsPeak}</Badge>
              <Badge variant="outline" className="text-[10px] h-4 bg-blue-500/10 text-blue-600 border-blue-500/20">P95: {displayMpsP95}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Latency</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Number(latencyAvg)}ms<span className="text-sm font-normal text-muted-foreground ml-1">avg</span></div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-[10px] h-4 bg-yellow-500/10 text-yellow-600 border-yellow-500/20">MAX: {displayLatencyMax}</Badge>
              <Badge variant="outline" className="text-[10px] h-4 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">P95: {displayLatencyP95}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Suspicious Flags</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{suspiciousFlags}</div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center">
              <span className={cn(flagsDelta != null && flagsDelta > 0 ? "text-destructive font-bold" : flagsDelta != null && flagsDelta < 0 ? "text-emerald-600" : "")} style={{ marginRight: 4 }}>
                {flagsDelta != null ? (flagsDelta > 0 ? `+${flagsDelta}` : String(flagsDelta)) : "—"}
              </span>
              in the last hour
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-7 gap-6 min-w-0">
        <Card className="col-span-1 lg:col-span-5 shadow-sm">
          <CardHeader>
            <CardTitle>System Performance</CardTitle>
            <CardDescription>
              Real-time message volume and connection stability.
            </CardDescription>
            <div className="text-xs text-muted-foreground mt-1">Left: Connections • Right: Messages / second</div>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full min-h-[200px] min-w-0">
              <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0}>
                <AreaChart
                  data={chartData.length > 0 ? chartData : [{ name: "—", messages: 0, connections: 0 }]}
                  isAnimationActive={false}
                >
                  <defs>
                    <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorConn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="index"
                    type="number"
                    domain={[0, CHART_WINDOW_LENGTH - 1]}
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    ticks={[0, 12, 24, 36, 48, 59]}
                    tickFormatter={(value) => {
                      const d = chartData[Number(value)];
                      return (d && d.name) ? d.name : "";
                    }}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#3b82f6"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 4]}
                    ticks={[0, 1, 2, 3, 4]}
                    tickFormatter={(value) => Math.round(value).toString()}
                    label={{ value: "Connections", angle: -90, position: "insideLeft", style: { textAnchor: "middle" } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="hsl(var(--primary))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    domain={messagesYDomain}
                    tickFormatter={(value) => Number(value).toFixed(2)}
                    label={{ value: "Messages / second", angle: 90, position: "insideRight", style: { textAnchor: "middle" } }}
                  />
                  <Tooltip
                    content={<SystemPerfTooltip />}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                  />
                  {/* Connections first (back) so Messages curve draws on top and is visible */}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="connections"
                    name="Connections"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorConn)"
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="messages"
                    name="Messages (msg/s)"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorMsg)"
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="messages"
                    name="Messages (msg/s)"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col h-full">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base">System Activity</CardTitle>
            <CardDescription>Latest network and moderation events.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ScrollArea className="h-[320px]">
              <div className="divide-y divide-border/50">
                {activityItems.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No recent activity</div>
                ) : (
                  activityItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors group">
                    <div className={cn("p-2 rounded-lg bg-muted/50 mt-0.5 shrink-0", item.color)}>
                      <item.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="text-sm font-semibold leading-tight truncate" title={item.title}>
                        {item.title}
                      </p>
                      {item.detailPairs && item.detailPairs.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {item.detailPairs.map((p, j) => (
                            <span
                              key={j}
                              className="inline-flex items-center rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              title={`${p.key}=${p.value}`}
                            >
                              <span className="text-muted-foreground/80">{p.key}=</span>
                              <span className="truncate max-w-[120px]" title={String(p.value)}>{p.value}</span>
                            </span>
                          ))}
                        </div>
                      ) : item.detail ? (
                        <p className="text-xs text-muted-foreground truncate max-w-full" title={item.detail}>
                          {item.detail}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-bold uppercase tracking-tighter text-[8px] bg-muted px-1 rounded">{item.type}</span>
                        <div className="flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 shrink-0" />
                          {item.time}
                        </div>
                      </div>
                    </div>
                  </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
