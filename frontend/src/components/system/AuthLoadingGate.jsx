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
  // #region agent log
  try {
    fetch("http://127.0.0.1:7440/ingest/34831ccd-0439-498b-bff5-78886fda482e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8283cd" },
      body: JSON.stringify({
        sessionId: "8283cd",
        location: "AuthLoadingGate.jsx:AuthLoadingGate",
        message: "AuthLoadingGate render start",
        data: {},
        timestamp: Date.now(),
        hypothesisId: "H3",
      }),
    }).catch(() => {});
  } catch (_) {}
  // #endregion
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
