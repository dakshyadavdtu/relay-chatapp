/**
 * Global app header — hidden on /chat, /admin, /settings so no blank strip above section headers.
 * Also hidden on auth routes: /login, /register, /forgot, /verify-otp, /reset.
 */
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

const AUTH_PATHS = ["/login", "/register", "/forgot", "/verify-otp", "/reset"];

export function GlobalHeader() {
  const [loc, setLocation] = useLocation();
  const onAuthRoute = AUTH_PATHS.some((p) => loc === p || loc?.startsWith?.(p + "/"));
  const hideGlobalHeader =
    onAuthRoute ||
    loc?.startsWith?.("/chat") ||
    loc?.startsWith?.("/admin") ||
    loc?.startsWith?.("/settings");
  if (hideGlobalHeader) return null;

  return (
    <header className="h-14 shrink-0 border-b border-border/50 bg-card/95 backdrop-blur-sm flex items-center justify-end px-4 gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground rounded-full"
        onClick={() => setLocation("/settings")}
        data-testid="button-global-settings"
      >
        <Settings className="w-5 h-5" />
      </Button>
    </header>
  );
}
