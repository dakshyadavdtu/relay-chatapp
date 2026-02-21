import { cn } from "@/utils/utils";
import { useSettings } from "@/hooks/useSettings";

export function Widget({ className, active, children, onClick, ...props }) {
  const settings = useSettings();
  const isCompact = settings?.density === "compact";

  return (
    <div
      onClick={onClick}
      className={cn(
        "settings-widget relative group overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors",
        isCompact && "p-3",
        active && "ring-2 ring-primary border-primary bg-primary/5",
        className
      )}
      {...props}
    >
      {active && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary animate-pulse" />
      )}
      {children}
    </div>
  );
}
