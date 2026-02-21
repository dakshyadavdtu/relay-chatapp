/**
 * Admin Reports page.
 * Phase 8D: Ported from our admin copy 4. Phase 8E-4: Uses useAdminReports adapter.
 * B4: Warn User -> POST /admin/users/:id/warn; Ban User -> POST /admin/users/:id/ban (targetUserId from report).
 *
 * --- Message context window (audit) ---
 * Current behavior: Details come only from GET /api/admin/reports/:id. This page does NOT fetch
 * full chat anywhere. It renders details.data.context (and details.data.message, report, insights,
 * userMeta). When context is empty (e.g. user report, or MESSAGE_NOT_FOUND), the UI shows the
 * appropriate empty/error copy; there is no fallback that loads conversation history by
 * conversationId. Fallback full-chat fetch codepaths: none.
 */
import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldBan,
  MessageSquare,
  ShieldAlert,
  User,
  FileText,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/useToast";
import { useAdminReports, useAdminReportDetails } from "@/features/admin/adapters";
import { resolveAdminReport, adminWarnUser, adminBanUser } from "@/features/admin/api/admin.api";

/** Normalize server priority to display label; unknown/missing -> NORMAL. */
function priorityLabel(p) {
  const v = (p && String(p).toLowerCase()) || "normal";
  if (v === "high") return "HIGH";
  if (v === "low") return "LOW";
  return "NORMAL";
}

/** Badge variant by priority (low=outline, normal=secondary, high=destructive). */
function priorityVariant(p) {
  const v = (p && String(p).toLowerCase()) || "normal";
  if (v === "high") return "destructive";
  if (v === "low") return "outline";
  return "secondary";
}

/** Allowed report reason values (user reports). Reason section must show only one of these; never show free-text details there. */
const REPORT_DISPLAY_REASONS = Object.freeze(["Spam", "Harassment", "Hate speech", "Sexual content", "Illegal"]);

/** Read-only display priority: use server priority, or derive from category (Spam→low, Harassment→normal, Hate speech/Sexual content/Illegal→high), else normal. */
function displayPriority(report) {
  if (report?.priority && ["low", "normal", "high"].includes(String(report.priority).toLowerCase())) {
    return String(report.priority).toLowerCase();
  }
  const c = report?.category;
  if (c === "Spam") return "low";
  if (c === "Harassment") return "normal";
  if (c === "Hate speech" || c === "Sexual content" || c === "Illegal") return "high";
  return "normal";
}

/** Value to show in Reason section: only category or reason if it's one of the allowed five; never details/free text. */
function displayReason(reportMeta) {
  if (reportMeta?.category && REPORT_DISPLAY_REASONS.includes(reportMeta.category)) return reportMeta.category;
  if (reportMeta?.reason && REPORT_DISPLAY_REASONS.includes(reportMeta.reason)) return reportMeta.reason;
  return null;
}

function formatMessageTime(ts) {
  if (ts == null || typeof ts !== "number") return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default function AdminReportsPage() {
  const { data, notAvailable, reason, loading, error, forbidden, unauthorized, canRetry, refetch } = useAdminReports();
  const [selectedReport, setSelectedReport] = useState(null);
  const [sortConfig, setSortConfig] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [actionLoading, setActionLoading] = useState({ warn: false, ban: false });
  const { toast } = useToast();

  const selectedReportId = selectedReport?.id ?? null;
  const details = useAdminReportDetails(selectedReportId);
  const maxContext = 5;
  const rawCtx = details.data?.context ?? [];
  const ctx = rawCtx.slice(0, maxContext);
  const reportedMsg = details.data?.message ?? null;
  const reportMeta = details.data?.report ?? {};
  const reportedMessageId = reportMeta.messageId ?? selectedReport?.messageId ?? null;
  const insights = details.data?.insights ?? null;
  const userMeta = details.data?.userMeta ?? null;
  const warningCreatedForThisReport = details.data?.warningCreatedForThisReport === true;

  const contextTruncated = rawCtx.length > maxContext;
  const anchorInCtx = reportedMessageId && ctx.some((m) => (m?.messageId ?? m?.id) === reportedMessageId);
  const showAnchorSeparately = reportedMsg && !anchorInCtx;
  const surroundingCount = ctx.length;

  const targetUserId = selectedReport?.targetUserId ?? null;
  const canWarnBan = Boolean(targetUserId) && !notAvailable;
  const canWarn = canWarnBan && !warningCreatedForThisReport;

  const reports = (data && !data.notAvailable && Array.isArray(data.reports)) ? data.reports : [];
  const sortedReports = [...reports].sort((a, b) => {
    if (!sortConfig) return 0;
    if (sortConfig.key === "date") {
      const da = a.date || "";
      const db = b.date || "";
      return sortConfig.direction === "asc" ? da.localeCompare(db) : db.localeCompare(da);
    }
    if (sortConfig.key === "priorityLevel") {
      const order = { high: 0, normal: 1, low: 2 };
      const pa = order[displayPriority(a)] ?? 1;
      const pb = order[displayPriority(b)] ?? 1;
      const cmp = pa - pb;
      return sortConfig.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  const hasMessageContext = selectedReport?.hasMessageContext === true;

  useEffect(() => {
    if (notAvailable && reason) {
      if (import.meta.env.DEV) console.debug("[AdminReports] not available:", reason);
    }
  }, [notAvailable, reason]);

  useEffect(() => {
    if (details.error && selectedReportId) {
      toast({
        title: "Could not load report details",
        description: details.error,
        variant: "destructive",
      });
    }
  }, [details.error, selectedReportId, toast]);


  async function handleResolveReport(reportId) {
    if (!reportId) return;
    setResolvingId(reportId);
    try {
      await resolveAdminReport(reportId);
      await refetch();
      if (selectedReport?.id === reportId) setSelectedReport(null);
      toast({ title: "Report resolved", description: "Report has been marked resolved.", variant: "default" });
    } catch (e) {
      const msg = e?.message ?? "Failed to resolve report";
      toast({ title: "Resolve failed", description: msg, variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  }

  const handleWarnUser = useCallback(async () => {
    if (!targetUserId || actionLoading.warn || notAvailable) return;
    setActionLoading((prev) => ({ ...prev, warn: true }));
    try {
      const warnReason = selectedReport?.reason ?? "";
      const reportId = selectedReport?.id ?? null;
      await adminWarnUser(targetUserId, warnReason, reportId);
      toast({ title: "User warned", description: `Warning recorded for user.`, variant: "default" });
      // Refetch reports list and report details to update Prev Warnings count
      await refetch();
      await details.refetch();
    } catch (e) {
      const code = e?.code;
      const isAlreadyWarnedToast = e?.status === 409 || code === "WARNING_ALREADY_CREATED_FOR_REPORT";
      const msg = isAlreadyWarnedToast
        ? "A warning was already created for this user from this report."
        : (e?.message ?? "Failed to warn user");
      const status = !isAlreadyWarnedToast && e?.status ? ` [${e.status}]` : "";
      const codeSuffix = !isAlreadyWarnedToast && code ? ` (${code})` : "";
      toast({
        title: isAlreadyWarnedToast ? "Already warned" : "Warn failed",
        description: `${msg}${status}${codeSuffix}`,
        variant: "destructive",
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, warn: false }));
    }
  }, [targetUserId, selectedReport?.reason, selectedReport?.id, actionLoading.warn, notAvailable, refetch, details, toast]);

  const handleBanUser = useCallback(async () => {
    if (!targetUserId || actionLoading.ban || notAvailable) return;
    setActionLoading((prev) => ({ ...prev, ban: true }));
    try {
      await adminBanUser(targetUserId);
      toast({ title: "User banned", description: `User has been banned.`, variant: "default" });
      await refetch();
    } catch (e) {
      const msg = e?.message ?? "Failed to ban user";
      const code = e?.code ? ` (${e.code})` : "";
      toast({ title: "Ban failed", description: `${msg}${code}`, variant: "destructive" });
    } finally {
      setActionLoading((prev) => ({ ...prev, ban: false }));
    }
  }, [targetUserId, actionLoading.ban, notAvailable, refetch, toast]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground">Loading reports…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="p-6 border border-destructive/50 rounded-xl bg-destructive/10">
          <p className="text-destructive font-medium">{error}</p>
          {canRetry && (
            <Button onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
      <div className="mb-6 flex flex-col gap-2 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">Manage user reports and moderation queue.</p>
      </div>

      {notAvailable && (
        <div className="mb-6 p-4 rounded-lg bg-muted/50 border border-border">
          <p className="text-sm font-medium text-muted-foreground">
            Reports moderation is not available right now.
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-hidden min-w-0">
        <Card className="lg:col-span-1 min-w-0 shadow-md flex flex-col h-full overflow-hidden">
          <CardHeader className="px-4 py-3 border-b bg-muted/20 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">Moderation Queue</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={() => requestSort("priorityLevel")}
              >
                <ArrowUpDown className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead
                    className="text-[10px] uppercase tracking-wider font-bold cursor-pointer"
                    onClick={() => requestSort("date")}
                  >
                    Date {sortConfig?.key === "date" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider font-bold">User</TableHead>
                  <TableHead
                    className="text-[10px] uppercase tracking-wider font-bold text-right cursor-pointer"
                    onClick={() => requestSort("priorityLevel")}
                  >
                    Priority {sortConfig?.key === "priorityLevel" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedReports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="p-8 text-center text-sm text-muted-foreground">
                      No reports
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedReports.map((report) => (
                    <TableRow
                      key={report.id}
                      className={cn(
                        "cursor-pointer transition-colors group",
                        selectedReport?.id === report.id && "bg-muted/80"
                      )}
                      onClick={() => setSelectedReport(report)}
                    >
                      <TableCell className="p-3">
                        <div className="text-[10px] font-medium">{report.date}</div>
                      </TableCell>
                      <TableCell className="p-3">
                        <div className="text-xs font-medium">{report.user}</div>
                      </TableCell>
                      <TableCell className="p-3 text-right">
                        <Badge
                          variant={priorityVariant(displayPriority(report))}
                          className="text-[8px] px-1 h-4 uppercase shrink-0"
                        >
                          {priorityLabel(displayPriority(report))}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className="lg:col-span-2 min-w-0 shadow-md flex flex-col h-full overflow-hidden">
          <CardHeader className="border-b bg-muted/10 p-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Report #{selectedReport?.id ?? "—"}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {selectedReport ? `${selectedReport.reason} • Reported on ${selectedReport.date}` : "Select a report"}
                  </CardDescription>
                </div>
              </div>
              <Button
                size="sm"
                variant="default"
                className="h-8 bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                disabled={notAvailable || !selectedReport || resolvingId != null}
                onClick={() => handleResolveReport(selectedReport?.id)}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Resolve Report
              </Button>
            </div>
          </CardHeader>

          <ScrollArea className="flex-1">
            <div className="p-6 space-y-8">
              {selectedReport && (
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" /> Report details
                  </h3>
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Type</span>
                      <span className="font-medium">{reportMeta.type ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium">{reportMeta.status ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-2 items-center">
                      <span className="text-muted-foreground">Priority</span>
                      <Badge
                        variant={priorityVariant(displayPriority(reportMeta || selectedReport))}
                        className="text-[8px] px-1.5 h-4 uppercase"
                      >
                        {priorityLabel(displayPriority(reportMeta || selectedReport))}
                      </Badge>
                    </div>
                    {reportMeta.suspicious && Array.isArray(reportMeta.suspiciousReasons) && reportMeta.suspiciousReasons.length > 0 && (
                      <div className="pt-2 border-t border-border/50">
                        <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Suspicious</span>
                        <ul className="list-disc list-inside text-xs text-destructive space-y-0.5">
                          {reportMeta.suspiciousReasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Created</span>
                      <span className="font-medium">{reportMeta.dateFormatted ?? (reportMeta.createdAt != null ? formatMessageTime(reportMeta.createdAt) : "—")}</span>
                    </div>
                    <div className="pt-2 border-t border-border/50">
                      <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Reason</span>
                      <p className="font-medium">{displayReason(reportMeta) ?? "—"}</p>
                    </div>
                    {reportMeta.details != null && reportMeta.details !== "" && (
                      <div className="pt-2 border-t border-border/50">
                        <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Details</span>
                        <p className="text-muted-foreground">{reportMeta.details}</p>
                      </div>
                    )}
                    {reportMeta.conversationId != null && (
                      <div className="flex justify-between gap-2 pt-2 border-t border-border/50">
                        <span className="text-muted-foreground">Conversation</span>
                        <span className="font-mono text-xs truncate max-w-[12rem]" title={reportMeta.conversationId}>{reportMeta.conversationId}</span>
                      </div>
                    )}
                    {reportMeta.messageId != null && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Message ID</span>
                        <span className="font-mono text-xs truncate max-w-[12rem]" title={reportMeta.messageId}>{reportMeta.messageId}</span>
                      </div>
                    )}
                    {reportMeta.senderId != null && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Sender</span>
                        <span className="font-mono text-xs">{reportMeta.senderId}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" /> Message context
                </h3>
                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  {!selectedReport ? (
                    <p className="text-sm text-muted-foreground">Select a report to view context</p>
                  ) : details.loading ? (
                    <p className="text-sm text-muted-foreground">Loading context…</p>
                  ) : details.error ? (
                    <div className="space-y-2">
                      <p className="text-sm text-destructive">Could not load report details.</p>
                      <Button variant="outline" size="sm" onClick={() => details.refetch()}>
                        Retry
                      </Button>
                    </div>
                  ) : !hasMessageContext ? (
                    <p className="text-sm text-muted-foreground">No message context (user report)</p>
                  ) : ctx.length === 0 && !reportedMsg ? (
                    <p className="text-sm text-muted-foreground">
                      {details.data?.contextError === "MESSAGE_NOT_FOUND"
                        ? "Message not found or no context available."
                        : "No message context available."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Showing up to 2 messages before and after the reported message.
                      </p>
                      {surroundingCount < 5 && (ctx.length > 0 || reportedMsg) && (
                        <p className="text-[11px] text-muted-foreground">
                          Only {surroundingCount + (showAnchorSeparately ? 1 : 0)} surrounding message{surroundingCount + (showAnchorSeparately ? 1 : 0) === 1 ? "" : "s"} available.
                        </p>
                      )}
                      {contextTruncated && (
                        <p className="text-xs text-amber-600 font-medium">
                          Context truncated to 2 above + 2 below.
                        </p>
                      )}
                      <ScrollArea className="h-[280px] w-full rounded-md border p-3">
                        <div className="space-y-2">
                          {ctx.map((msg, idx) => {
                            const isReported = msg && (msg.messageId === reportedMessageId || (msg.roomMessageId && msg.roomMessageId === reportedMessageId));
                            return (
                              <div
                                key={msg?.messageId ?? msg?.id ?? `ctx-${idx}`}
                                className={cn(
                                  "flex flex-col gap-1 p-2 rounded-lg transition-colors",
                                  isReported
                                    ? "bg-destructive/10 border-l-2 border-destructive"
                                    : "hover:bg-muted/50"
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold px-1.5 rounded bg-muted text-muted-foreground">
                                    {msg?.senderId ?? "—"}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">
                                    {msg?.timestamp != null ? formatMessageTime(msg.timestamp) : "—"}
                                  </span>
                                </div>
                                <p className="text-sm font-medium break-words">{msg?.content ?? msg?.body ?? "—"}</p>
                                {isReported && (
                                  <span className="text-[10px] text-destructive font-medium">Reported message</span>
                                )}
                              </div>
                            );
                          })}
                          {showAnchorSeparately && (
                            <div className="flex flex-col gap-1 p-2 rounded-lg bg-destructive/10 border-l-2 border-destructive">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-bold px-1.5 rounded bg-muted text-muted-foreground">
                                  {reportedMsg?.senderId ?? "—"}
                                </span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {reportedMsg?.timestamp != null ? formatMessageTime(reportedMsg.timestamp) : "—"}
                                </span>
                              </div>
                              <p className="text-sm font-medium break-words">{reportedMsg?.content ?? reportedMsg?.body ?? "—"}</p>
                              <span className="text-[10px] text-destructive font-medium">Reported message</span>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5" /> Moderation Insights
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Card className="p-3 bg-card border shadow-sm">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block mb-1">Message Rate</span>
                      <div className="text-lg font-bold">
                        {insights?.messageRate != null ? `${insights.messageRate.toFixed(2)}/min` : "—"}
                      </div>
                    </Card>
                    <Card className="p-3 bg-card border shadow-sm">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block mb-1">Prev Warnings</span>
                      <div className="text-lg font-bold text-yellow-500">
                        {insights?.prevWarnings != null ? insights.prevWarnings : "—"}
                      </div>
                    </Card>
                    <Card className="p-3 bg-card border shadow-sm">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block mb-1">Recent Reports</span>
                      <div className="text-lg font-bold text-destructive">
                        {insights?.recentReports != null ? insights.recentReports : "—"}
                      </div>
                    </Card>
                    <Card className="p-3 bg-card border shadow-sm">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold block mb-1">Suspicious Flags</span>
                      <div className="text-lg font-bold text-purple-600">
                        {insights?.suspiciousFlagsCount != null ? insights.suspiciousFlagsCount : (Array.isArray(insights?.suspiciousFlags) ? insights.suspiciousFlags.length : "—")}
                      </div>
                      {Array.isArray(insights?.suspiciousFlags) && insights.suspiciousFlags.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2 text-[11px]">
                          {insights.suspiciousFlags.map((f, i) => (
                            <div key={i} className="flex justify-between items-baseline gap-2">
                              <span className="font-medium truncate">{f.reason || "—"}</span>
                              <span className="text-muted-foreground shrink-0">×{typeof f.count === "number" ? f.count : 0}</span>
                              {typeof f.lastDetectedAt === "number" && f.lastDetectedAt > 0 && (
                                <span className="text-muted-foreground shrink-0">{formatMessageTime(f.lastDetectedAt)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                    <User className="w-3.5 h-3.5" /> User Metadata
                  </h3>
                  <div className="space-y-2 text-[11px] bg-muted/30 p-4 rounded-xl border">
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">Account Created</span>
                      <span className="font-medium">
                        {userMeta?.accountCreatedAt
                          ? formatMessageTime(new Date(userMeta.accountCreatedAt).getTime())
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">Last Known IP</span>
                      <span className="font-mono">{userMeta?.lastKnownIp ?? "—"}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">Total Reports</span>
                      <span className="font-medium">{userMeta?.totalReports != null ? userMeta.totalReports : "—"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3 shrink-0">
                <Button
                  className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-bold h-10 shadow-lg shadow-yellow-600/10 cursor-pointer"
                  disabled={!canWarn || actionLoading.warn}
                  onClick={handleWarnUser}
                  title={warningCreatedForThisReport ? "A warning was already created for this user from this report." : undefined}
                >
                  <AlertTriangle className="w-4 h-4 mr-2" /> Warn User
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 h-10 shadow-lg shadow-destructive/10 cursor-pointer"
                  disabled={!canWarnBan || actionLoading.ban}
                  onClick={handleBanUser}
                >
                  <ShieldBan className="w-4 h-4 mr-2" /> Ban User
                </Button>
              </div>
              {selectedReport && !targetUserId && (
                <p className="text-[11px] text-muted-foreground pt-1">
                  This report has no target user; Warn/Ban are unavailable.
                </p>
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
