/**
 * Role gate for routes. Use after auth is resolved.
 * - Loading: spinner
 * - Not authenticated: redirect /login?next=...
 * - Authenticated but role not in allowed list: show Unauthorized page (no redirect loop)
 */
import { Redirect } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Spinner } from "@/components/ui/spinner";
import Unauthorized from "@/pages/system/Unauthorized";

/**
 * @param {{ children: React.ReactNode, roles?: string[] | string, role?: string, fallback?: React.ReactNode }} props
 * - roles: e.g. ['ADMIN'] or single role string
 * - role: shorthand for roles={[role]}
 * - fallback: when provided, render this instead of Unauthorized/Redirect/Spinner when not allowed (e.g. null to hide inline content)
 */
export function RequireRole({ children, roles, role, fallback }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const allowed = Array.isArray(roles) ? roles : roles != null ? [roles] : role != null ? [role] : [];

  if (isLoading) {
    if (fallback !== undefined) return fallback;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background" aria-busy="true">
        <Spinner size="lg" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (fallback !== undefined) return fallback;
    const currentPathWithQuery =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    return <Redirect to={`/login?next=${encodeURIComponent(currentPathWithQuery)}`} />;
  }

  const isRoot = !!user?.isRootAdmin;
  const hasRole = allowed.length > 0 && allowed.includes(user?.role || "");
  if (!isRoot && !hasRole) {
    return fallback !== undefined ? fallback : <Unauthorized />;
  }

  return children;
}
