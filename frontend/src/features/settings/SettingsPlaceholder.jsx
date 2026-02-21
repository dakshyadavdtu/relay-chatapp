/**
 * Settings feature placeholder.
 * Phase 1: Adapter until settings module is migrated from myset copy 2.
 * Host routes already serve settings pages; this is the feature entry.
 */
export default function SettingsPlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <p className="text-muted-foreground">Settings — use sub-routes</p>
    </div>
  );
}
