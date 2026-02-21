/**
 * P6: Central toast helper — TTL policy (auto-dismiss vs sticky).
 * Do not change toast text; only duration + persistence.
 */

import { toast } from "@/hooks/useToast";

export const TOAST_KIND = {
  SUCCESS: "SUCCESS",
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
  CRITICAL: "CRITICAL",
};

const DURATIONS_MS = {
  [TOAST_KIND.SUCCESS]: 3000,
  [TOAST_KIND.INFO]: 3000,
  [TOAST_KIND.WARNING]: 4000,
  [TOAST_KIND.ERROR]: 5000,
  [TOAST_KIND.CRITICAL]: Infinity, // sticky until dismissed
};

/**
 * Show a toast with kind-based duration and variant.
 * @param {keyof typeof TOAST_KIND} kind - SUCCESS | INFO | WARNING | ERROR | CRITICAL
 * @param {{ title: string, description?: string } | string} message - title or { title, description }
 * @param {{ variant?: 'default' | 'destructive' }} [opts] - optional override
 */
export function showToast(kind, message, opts = {}) {
  const title = typeof message === "string" ? message : message?.title ?? "";
  const description = typeof message === "object" && message && "description" in message ? message.description : undefined;
  const duration = DURATIONS_MS[kind] ?? 5000;
  const variant = opts.variant ?? (kind === TOAST_KIND.ERROR || kind === TOAST_KIND.CRITICAL ? "destructive" : "default");
  return toast({
    title,
    description,
    variant,
    duration,
    ...opts,
  });
}
