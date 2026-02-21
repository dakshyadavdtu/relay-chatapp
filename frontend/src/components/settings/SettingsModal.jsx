import { X, Sun, Moon, Download, FileText, FileJson } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/utils/utils";
import { useState, useRef, useEffect } from "react";
import { getChatState } from "@/state/chat.state";
export function SettingsModal({ open, onClose }) {
  const settings = useSettings();
  const theme = settings.theme ?? "light";
  const textSize = settings.textSize ?? "medium";
  const density = settings.density ?? "comfortable";
  const reducedMotion = settings.reducedMotion ?? false;
  const enterToSend = settings.enterToSend ?? true;
  const messageGrouping = settings.messageGrouping ?? true;
  const {
    setTheme,
    setTextSize,
    setDensity,
    setReducedMotion,
    setEnterToSend,
    setMessageGrouping,
  } = settings;

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const handleClick = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showExportMenu]);

  const handleExportJSON = () => {
    const s = getChatState();
    const byConv = s.byConversation || {};
    const allMessages = Object.values(byConv).flat();
    const exportData = {
      exportedAt: new Date().toISOString(),
      messages: allMessages.map((msg) => ({
        sender: msg.senderId,
        content: msg.content,
        timestamp: msg.createdAt || msg.timestamp,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // Security: render with textContent to prevent XSS in export
  const handleExportPDF = () => {
    const s = getChatState();
    const byConv = s.byConversation || {};
    const allMessages = Object.values(byConv).flat();
    const lines = allMessages.map((msg) => {
      const time = new Date(msg.createdAt || msg.timestamp || 0).toLocaleString();
      return `[${time}] ${String(msg.senderId || "").slice(0, 8)}: ${msg.content || ""}`;
    });

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const doc = printWindow.document;
    doc.title = "Chat Export";

    const styleEl = doc.createElement("style");
    styleEl.textContent = `
      body { font-family: Arial, sans-serif; padding: 40px; font-size: 12px; line-height: 1.6; }
      h1 { font-size: 18px; margin-bottom: 20px; }
      .msg { padding: 4px 0; border-bottom: 1px solid #eee; }
    `;
    doc.head.appendChild(styleEl);

    const header = doc.createElement("h1");
    header.textContent = `Chat Export - ${new Date().toLocaleString()}`;

    const container = doc.createElement("div");
    container.appendChild(header);
    for (const line of lines) {
      const div = doc.createElement("div");
      div.className = "msg";
      div.textContent = line;
      container.appendChild(div);
    }

    doc.body.appendChild(container);
    doc.close();
    printWindow.focus();
    printWindow.print();
    setShowExportMenu(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
      data-testid="settings-overlay"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-card w-full max-w-[420px] max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-modal"
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="text-lg font-bold" data-testid="text-settings-title">
            Settings
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-settings">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-6 custom-scrollbar">
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-4" data-testid="text-section-appearance">
              APPEARANCE
            </h3>
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold mb-2 block">Theme</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setTheme("light")}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-colors",
                      theme === "light" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                    data-testid="button-theme-light"
                  >
                    <Sun className="w-4 h-4" />
                    Light
                  </button>
                  <button
                    onClick={() => setTheme("dark")}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-colors",
                      theme === "dark" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                    data-testid="button-theme-dark"
                  >
                    <Moon className="w-4 h-4" />
                    Dark
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold mb-2 block">Text Size</label>
                <div className="grid grid-cols-3 gap-2">
                  {["small", "medium", "large"].map((size) => (
                    <button
                      key={size}
                      onClick={() => setTextSize(size)}
                      className={cn(
                        "py-2.5 rounded-full text-sm font-medium transition-colors capitalize",
                        textSize === size ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}
                      data-testid={`button-textsize-${size}`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold mb-2 block">Density</label>
                <div className="grid grid-cols-2 gap-2">
                  {["comfortable", "compact"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDensity(d)}
                      className={cn(
                        "py-2.5 rounded-full text-sm font-medium transition-colors capitalize",
                        density === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}
                      data-testid={`button-density-${d}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Reduced Motion</span>
                <Switch checked={reducedMotion} onCheckedChange={setReducedMotion} data-testid="switch-reduced-motion" />
              </div>
            </div>
          </section>

          <div className="border-t border-border" />

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-4" data-testid="text-section-messages">
              MESSAGES
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Enter to Send</span>
                <Switch checked={enterToSend} onCheckedChange={setEnterToSend} data-testid="switch-enter-to-send" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Message Grouping</span>
                <Switch checked={messageGrouping} onCheckedChange={setMessageGrouping} data-testid="switch-message-grouping" />
              </div>
            </div>
          </section>

          <div className="border-t border-border" />

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-4" data-testid="text-section-power">
              POWER
            </h3>
            <div className="relative" ref={exportMenuRef}>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => setShowExportMenu(!showExportMenu)}
                data-testid="button-export-chat"
              >
                <Download className="w-4 h-4" />
                Export Chat
              </Button>
              {showExportMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-10">
                  <button
                    className="w-full px-4 py-2.5 text-left text-sm font-medium hover-elevate flex items-center gap-2"
                    onClick={handleExportPDF}
                    data-testid="button-export-pdf"
                  >
                    <FileText className="w-4 h-4" />
                    Export PDF
                  </button>
                  <div className="border-t border-border" />
                  <button
                    className="w-full px-4 py-2.5 text-left text-sm font-medium hover-elevate flex items-center gap-2"
                    onClick={handleExportJSON}
                    data-testid="button-export-json"
                  >
                    <FileJson className="w-4 h-4" />
                    Export JSON
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
