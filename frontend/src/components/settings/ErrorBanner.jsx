import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorBanner({ message, status, onRetry }) {
  const displayMessage = message || "Something went wrong.";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
      role="alert"
    >
      <div className="flex items-center gap-3 min-w-0">
        <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="font-medium text-destructive">{displayMessage}</p>
          {status != null && (
            <p className="text-xs text-muted-foreground mt-0.5">Status: {status}</p>
          )}
        </div>
      </div>
      {typeof onRetry === "function" && (
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      )}
    </div>
  );
}
