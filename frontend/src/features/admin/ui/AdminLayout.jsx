/**
 * Admin layout - sidebar + main content.
 * Phase 8A: Ported from our admin copy 4 layout structure.
 * Phase 3: System status from useSystemStatus (API health + WS readiness).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, FileText, Activity, Menu, ArrowLeft, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";
import { useSystemStatus } from "@/features/admin/adapters/useSystemStatus";

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/admin" },
  { icon: Users, label: "Users", path: "/admin/users" },
  { icon: FileText, label: "Reports", path: "/admin/reports" },
];

function SystemStatusBlock() {
  const { apiOk, wsReady } = useSystemStatus();
  if (apiOk && wsReady) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 animate-ping opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Connected
      </div>
    );
  }
  if (apiOk && !wsReady) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
          Degraded
        </div>
        <p className="text-xs text-muted-foreground">WS not ready</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
        Disconnected
      </div>
      <p className="text-xs text-muted-foreground">API unreachable</p>
    </div>
  );
}

export function AdminLayout({ children }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside
        className={cn(
          "w-64 shrink-0 border-r border-border bg-card/50 flex flex-col lg:flex z-40",
          "fixed inset-y-0 left-0 lg:relative",
          mobileMenuOpen ? "flex" : "hidden lg:flex"
        )}
      >
        <div className="h-14 flex items-center px-6 border-b border-border/50">
          <div className="flex items-center gap-2 font-semibold text-lg tracking-tight">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <span>Admin<span className="text-muted-foreground">Panel</span></span>
          </div>
        </div>
        <div className="flex-1 py-6 px-3 space-y-1">
          <div className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Main Menu
          </div>
          {NAV_ITEMS.map(({ icon: Icon, label, path }) => {
            const isActive = location === path;
            return (
              <Link
                key={path}
                href={path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 group relative cursor-pointer",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                {label}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                )}
              </Link>
            );
          })}
        </div>
        <div className="p-4 border-t border-border/50 space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">System Status</div>
            <SystemStatusBlock />
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-h-screen">
        <header className="h-14 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-20 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <Link
              href="/chat"
              onClick={() => {
                if (import.meta.env.DEV && typeof console !== "undefined" && console.log) {
                  console.log("[nav] Return to Chat -> /chat", typeof window !== "undefined" ? window.location.pathname : "");
                }
              }}
            >
              <Button variant="outline" size="sm" className="gap-2 cursor-pointer">
                <ArrowLeft className="w-4 h-4" />
                Return to Chat
              </Button>
            </Link>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground rounded-full"
            onClick={() => {
              if (typeof window !== "undefined") window.sessionStorage.setItem("settings:returnTo", window.location.pathname);
              setLocation("/settings/profile");
            }}
            data-testid="button-admin-settings"
            aria-label="Open settings"
          >
            <Settings className="w-5 h-5" />
          </Button>
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-30 lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden
            />
          )}
        </header>
        <div className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
