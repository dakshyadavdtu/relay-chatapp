import { Inbox } from "lucide-react";

export function EmptyState({ message, children }) {
  const displayMessage = message || "No data to show.";
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-secondary/30 p-12 text-center">
      <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-muted-foreground">{displayMessage}</p>
      {children != null && <div className="mt-4">{children}</div>}
    </div>
  );
}
