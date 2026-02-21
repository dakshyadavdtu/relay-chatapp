import { cn } from "@/utils/utils";

/**
 * Simple loading spinner. Use size "sm" | "default" | "lg".
 */
export function Spinner({ className, size = "default" }) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    default: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-2",
  };
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-primary border-t-transparent",
        sizeClasses[size],
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}
