import { cn } from "@/utils/utils";

export function SettingsProgress({ value = 0, className, ...props }) {
  return (
    <div
      className={cn("h-2 bg-secondary rounded-full overflow-hidden", className)}
      {...props}
    >
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
