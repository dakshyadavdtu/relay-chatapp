/**
 * Phase 6D: Route guard — no protected route accessible without backend auth.
 *
 * Behavior:
 * - IF loading: show loading screen (avoids redirect before /api/me resolves)
 * - IF unauthenticated: redirect to /login?next=<currentPathWithQuery>
 * - IF authenticated: render child route
 *
 * Prevents redirect loops: /login is not protected, so unauthenticated users stay.
 * Refresh on /chat works: AuthLoadingGate runs GET /api/me before routes; RequireAuth
 * sees isAuthenticated once cookie is validated.
 */
import { Redirect } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
export function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background" aria-busy="true">
        <Spinner size="lg" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    const currentPathWithQuery =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    return <Redirect to={`/login?next=${encodeURIComponent(currentPathWithQuery)}`} />;
  }

  return children;
}
