/**
 * Phase 7C: Settings UI (myset copy2 style) — all controls drive ui_prefs.
 * Export uses backend /api/export/chat/:chatId.(json|pdf) with real chat history.
 */
import { useUiPrefs } from "@/features/ui_prefs";
import { Widget } from "@/components/settings/Widget";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Loader2, Moon, Sun, Monitor, Download, FileJson, FileText, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { useChatStore } from "@/features/chat/adapters";
import { getConversationId } from "@/utils/conversation";
import { toBackendChatId, exportChatJson, exportChatPdf } from "@/features/chat/api/chat.api";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export default function PreferencesPage() {
  const prefs = useUiPrefs();
  const { toast } = useToast();
  const { user } = useAuth();
  const { activeGroupId, activeDmUser, activeConversationId } = useChatStore();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("pdf");
  const [exporting, setExporting] = useState(false);

  // Canonical source: use activeConversationId always; fallback only when no conversation selected
  const conversationId = activeConversationId ?? getConversationId(activeGroupId, activeDmUser);
  let normalizedId = conversationId;
  if (normalizedId && typeof normalizedId === "string") {
    if (normalizedId.startsWith("group-room:")) normalizedId = `group-${normalizedId.slice(11)}`;
    else if (normalizedId.startsWith("group-group-")) normalizedId = `group-${normalizedId.slice(12)}`;
  }
  const backendChatId = normalizedId ? toBackendChatId(normalizedId, user?.id) : null;
  const canExport = !!backendChatId;
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV && backendChatId) {
    if (import.meta.env.DEV) console.debug("[export] conversationId=", conversationId, "backendChatId=", backendChatId);
  }

  const theme = prefs.theme ?? "light";
  const textSize = prefs.textSize ?? "medium";
  const density = prefs.density ?? "comfortable";
  const reducedMotion = prefs.reducedMotion ?? false;
  const enterToSend = prefs.enterToSend ?? true;
  const messageGrouping = prefs.messageGrouping ?? true;

  const handleExport = async () => {
    if (!backendChatId) return;
    // TEMP Phase 1 debug: remove in Phase 2
    console.debug("[export] exportFormat=", exportFormat);
    console.debug("[export] fn=", exportFormat === "json" ? "exportChatJson" : "exportChatPdf");
    console.debug("[export] backendChatId=", backendChatId);
    setExporting(true);
    try {
      const fn = exportFormat === "json" ? exportChatJson : exportChatPdf;
      const result = await fn(backendChatId);
      if (result.ok) {
        toast({
          title: "Export downloaded",
          description: `Chat history exported as ${exportFormat.toUpperCase()}.`,
        });
        setExportOpen(false);
      } else {
        const description = [result.status, result.error].filter(Boolean).join(": ") || "Export failed";
        toast({ title: "Export failed", description, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Export failed",
        description: err?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold">Preferences</h1>
        <p className="text-muted-foreground mt-2">Customize your app experience.</p>
      </div>

      {/* Appearance */}
      <section>
        <h2 className="text-lg font-semibold mb-4 px-1">Appearance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Widget className="space-y-4">
            <Label className="text-base">Theme</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "light", icon: Sun, label: "Light" },
                { id: "dark", icon: Moon, label: "Dark" },
                { id: "system", icon: Monitor, label: "System" },
              ].map((t) => (
                <div
                  key={t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    prefs.setTheme(t.id);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all",
                    theme === t.id
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent bg-secondary hover:bg-secondary/80 text-muted-foreground"
                  )}
                >
                  <t.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{t.label}</span>
                </div>
              ))}
            </div>
          </Widget>

          <Widget className="space-y-4">
            <Label className="text-base">Text Size</Label>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-end px-2 pb-2 h-8 border-b border-border/50">
                <span className="text-xs">A</span>
                <span className="text-sm font-medium">A</span>
                <span className="text-lg font-bold">A</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="1"
                value={textSize === "small" ? 0 : textSize === "medium" ? 1 : 2}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  const size = val === 0 ? "small" : val === 1 ? "medium" : "large";
                  prefs.setTextSize(size);
                }}
                className="w-full accent-primary h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-muted-foreground px-1">
                <span>Small</span>
                <span>Medium</span>
                <span>Large</span>
              </div>
            </div>
          </Widget>

          <Widget
            onClick={() =>
              prefs.setDensity(density === "comfortable" ? "compact" : "comfortable")
            }
          >
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base cursor-pointer">Compact Mode</Label>
                <p className="text-sm text-muted-foreground">Fit more content on screen</p>
              </div>
              <Switch
                checked={density === "compact"}
                onCheckedChange={(val) => prefs.setDensity(val ? "compact" : "comfortable")}
              />
            </div>
          </Widget>

          <Widget onClick={() => prefs.setReducedMotion(!reducedMotion)}>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base cursor-pointer">Reduced Motion</Label>
                <p className="text-sm text-muted-foreground">Disable animations</p>
              </div>
              <Switch
                checked={!!reducedMotion}
                onCheckedChange={(val) => prefs.setReducedMotion(val)}
              />
            </div>
          </Widget>
        </div>
      </section>

      {/* Messages */}
      <section>
        <h2 className="text-lg font-semibold mb-4 px-1">Messages</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Widget>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base cursor-pointer">Enter to send</Label>
                <p className="text-sm text-muted-foreground">Send message on enter key</p>
              </div>
              <Switch
                checked={!!enterToSend}
                onCheckedChange={(val) => prefs.setEnterToSend(val)}
              />
            </div>
          </Widget>

          <Widget>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base cursor-pointer">Message Grouping</Label>
                <p className="text-sm text-muted-foreground">
                  Combine messages from same user
                </p>
              </div>
              <Switch
                checked={!!messageGrouping}
                onCheckedChange={(val) => prefs.setMessageGrouping(val)}
              />
            </div>
          </Widget>
        </div>
      </section>

      {/* Data */}
      <section>
        <h2 className="text-lg font-semibold mb-4 px-1">Data</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Widget className="flex items-center justify-between cursor-default">
            <div>
              <Label className="text-base">Export Chat History</Label>
              <p className="text-sm text-muted-foreground">Download your data copy (JSON or PDF)</p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-block">
                    <Button
                      onClick={() => setExportOpen(true)}
                      variant="outline"
                      className="gap-2"
                      disabled={!canExport}
                    >
                      <Download className="w-4 h-4" /> Export
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canExport ? "Export current conversation" : "Open a chat first to export"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Widget>
        </div>
      </section>

      {/* Export Dialog */}
      <SettingsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Data"
        description="Choose how you want to export your chat history."
      >
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="grid grid-cols-2 gap-4">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExportFormat("pdf")}
                onKeyDown={(e) => e.key === "Enter" && setExportFormat("pdf")}
                className={cn(
                  "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all",
                  exportFormat === "pdf"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary"
                )}
              >
                <FileText
                  className={cn(
                    "w-8 h-8",
                    exportFormat === "pdf" ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span className="font-medium">PDF Document</span>
                {exportFormat === "pdf" && (
                  <div className="absolute top-2 right-2 text-primary">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => setExportFormat("json")}
                onKeyDown={(e) => e.key === "Enter" && setExportFormat("json")}
                className={cn(
                  "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all",
                  exportFormat === "json"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary"
                )}
              >
                <FileJson
                  className={cn(
                    "w-8 h-8",
                    exportFormat === "json" ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span className="font-medium">JSON Data</span>
                {exportFormat === "json" && (
                  <div className="absolute top-2 right-2 text-primary">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              className="bg-primary text-primary-foreground"
              disabled={exporting || !canExport}
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Exporting…
                </>
              ) : (
                "Start Export"
              )}
            </Button>
          </div>
        </div>
      </SettingsDialog>
    </div>
  );
}
