/**
 * Hook for changing user password.
 * Uses React Query-like mutation pattern for consistency with other hooks.
 */
import { useState, useCallback } from "react";
import { changePassword as changePasswordApi } from "@/http/auth.api";
import { useToast } from "@/hooks/useToast";

/**
 * Hook to change user password.
 * @returns {{ mutate: (payload, options?) => void, isPending: boolean }}
 */
export function useChangePassword() {
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (payload, options = {}) => {
      const { currentPassword, newPassword } = payload || {};
      
      if (!currentPassword || !newPassword) {
        toast({
          title: "Error",
          description: "Current password and new password are required",
          variant: "destructive",
        });
        if (options.onError) options.onError(new Error("Missing required fields"));
        return;
      }

      setIsPending(true);
      try {
        await changePasswordApi({ currentPassword, newPassword });
        if (options.onSuccess) options.onSuccess();
      } catch (error) {
        const errorMessage =
          error?.message ||
          error?.data?.message ||
          error?.data?.error ||
          "Failed to change password";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        if (options.onError) options.onError(error);
      } finally {
        setIsPending(false);
      }
    },
    [toast]
  );

  return { mutate, isPending };
}
