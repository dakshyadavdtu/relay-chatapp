import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useRef } from "react";
import { fetchServerUiPrefs } from "@/features/ui_prefs/uiPrefs.server";
import { applyServerPrefIfNotOverridden } from "@/features/ui_prefs";

/**
 * Phase 6C: Blocks app until initial GET /api/me completes.
 * useAuth triggers runAuthInitOnce on mount; isLoading true until /api/me resolves.
 * Phase 4: Hydrates UI preferences from server once authenticated.
 */
export function AuthLoadingGate({ children }) {
  const { isLoading, isAuthenticated } = useAuth();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    if (isLoading) return;
    if (!isAuthenticated) {
      hydratedRef.current = false;
      return;
    }
    hydratedRef.current = true;
    fetchServerUiPrefs().then((serverPrefs) => {
        if (serverPrefs) {
          if (serverPrefs.soundNotifications !== null) {
            applyServerPrefIfNotOverridden(
              "soundNotifications",
              serverPrefs.soundNotifications
            );
          }
          // Same pattern as soundNotifications: recent local toggle wins over server (fix #2 desktop notification audit).
          const serverDesktop = serverPrefs.desktopNotifications;
          if (serverDesktop !== null) {
            applyServerPrefIfNotOverridden(
              "desktopNotifications",
              serverDesktop
            );
          }
        }
      }).catch(() => {
        // Ignore errors - fallback to localStorage
      });
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <Spinner size="lg" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return children;
}
