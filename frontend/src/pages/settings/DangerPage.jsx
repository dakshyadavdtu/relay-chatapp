import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2, LogOut, Loader2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Label } from "@/components/ui/label";
import { deleteMyAccount } from "@/features/settings/api/account.api";
import { logoutAllSessions } from "@/features/settings/api/sessions.api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { UnauthorizedError } from "@/lib/http";

export default function DangerPage() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { logout } = useAuth();
  const { toast } = useToast();

  const canDelete = confirmText.trim() === "DELETE" && !deleteLoading;

  const handleDeleteOpenChange = (open) => {
    setDeleteOpen(open);
    if (!open) setConfirmText("");
  };

  const handleDeleteAccount = async () => {
    if (!canDelete) return;
    setDeleteLoading(true);
    try {
      await deleteMyAccount({ confirm: "DELETE" });
      await logout();
      setDeleteOpen(false);
      setConfirmText("");
      setLocation("/login");
    } catch (err) {
      if (err instanceof UnauthorizedError || err?.status === 401) {
        await logout();
        setDeleteOpen(false);
        setLocation("/login");
        return;
      }
      toast({
        title: "Delete account failed",
        description: err?.message || "Could not delete your account.",
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleLogoutAll = async () => {
    setLogoutAllLoading(true);
    try {
      await logoutAllSessions();
      await logout();
      setLocation("/login");
    } catch (err) {
      if (err instanceof UnauthorizedError || err?.status === 401) {
        await logout();
        setLocation("/login");
        return;
      }
      toast({
        title: "Log out all failed",
        description: err?.message || "Could not sign out all devices.",
        variant: "destructive",
      });
    } finally {
      setLogoutAllLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-destructive">Danger Zone</h1>
        <p className="text-muted-foreground mt-2">Irreversible actions. Tread carefully.</p>
      </div>

      <div className="border border-destructive/20 rounded-2xl overflow-hidden">
        <div className="bg-destructive/5 p-6 space-y-6">
          <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-destructive/10">
            <div>
              <h3 className="font-semibold text-lg mb-1">Log Out All Devices</h3>
              <p className="text-sm text-muted-foreground">Sign out of all other sessions immediately.</p>
            </div>
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive hover:text-white"
              onClick={handleLogoutAll}
              disabled={logoutAllLoading}
            >
              {logoutAllLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4 mr-2" />
              )}
              Log Out All
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-destructive/10">
            <div>
              <h3 className="font-semibold text-lg mb-1">Delete Account</h3>
              <p className="text-sm text-muted-foreground">Permanently remove your account and all data.</p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="bg-destructive hover:bg-destructive/90"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Account
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 p-4 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-xl items-start">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <p className="text-sm leading-relaxed">
          <strong>Warning:</strong> Actions on this page are final. Deleted data cannot be recovered.
        </p>
      </div>

      <SettingsDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        title="Delete Account?"
        description="This action cannot be undone. This will permanently delete your account."
      >
        <div className="py-4">
          <Label className="text-sm font-medium block mb-2">Type &quot;DELETE&quot; to confirm:</Label>
          <input
            className="w-full px-3 py-2 border border-input rounded-md bg-background"
            placeholder="DELETE"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleteLoading}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => handleDeleteOpenChange(false)} disabled={deleteLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={handleDeleteAccount}
            className="bg-destructive hover:bg-destructive/90"
          >
            {deleteLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Permanently Delete
          </Button>
        </div>
      </SettingsDialog>
    </div>
  );
}
