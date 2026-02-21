import { Link, useLocation } from "wouter";
import { ChevronLeft, User, Shield, MonitorSmartphone, Settings2, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";

const NAV_ITEMS = [
  { icon: User, label: "Profile", path: "/settings/profile" },
  { icon: Shield, label: "Security", path: "/settings/security" },
  { icon: MonitorSmartphone, label: "Devices", path: "/settings/devices" },
  { icon: Settings2, label: "Preferences", path: "/settings/preferences" },
  { icon: AlertOctagon, label: "Danger Zone", path: "/settings/danger", danger: true },
];

export function SettingsLayout({ children }) {
  const [location] = useLocation();
  const returnTo =
    typeof window !== "undefined"
      ? (window.sessionStorage.getItem("settings:returnTo") || "/chat")
      : "/chat";

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-64 shrink-0 border-r border-border/50 bg-card/50">
        <div className="sticky top-0 p-4 border-b border-border/50">
          <Link href={returnTo}>
            <Button variant="ghost" className="gap-2 -ml-2">
              <ChevronLeft className="w-4 h-4" />
              Back to Chat
            </Button>
          </Link>
        </div>
        <nav className="p-3 space-y-1">
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Settings</p>
          {NAV_ITEMS.map(({ icon: Icon, label, path, danger }) => {
            const active = location === path;
            return (
              <Link
                key={path}
                href={path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  danger && !active && "text-destructive hover:bg-destructive/10"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  );
}
