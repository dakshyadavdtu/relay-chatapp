import { useToast } from "@/hooks/useToast";
import { cn } from "@/utils/utils";
import { X } from "lucide-react";

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const openToasts = toasts.filter((t) => t.open !== false);

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
      {openToasts.map(({ id, title, description, variant }) => (
        <div
          key={id}
          className={cn(
            "rounded-lg border px-4 py-3 shadow-lg flex items-start gap-2",
            variant === "destructive"
              ? "border-destructive bg-destructive/10 text-destructive-foreground"
              : "border-border bg-card text-card-foreground"
          )}
        >
          <div className="flex-1 min-w-0">
            {title && <p className="font-semibold text-sm">{title}</p>}
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/20"
            onClick={() => dismiss(id)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
