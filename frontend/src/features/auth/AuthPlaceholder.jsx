/**
 * Auth feature placeholder.
 * Phase 1: Adapter until auth module is migrated from updated_auth.
 * Host routes already serve login, register, forgot, reset.
 */
export default function AuthPlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-muted-foreground">Auth — use /login, /register, etc.</p>
    </div>
  );
}
