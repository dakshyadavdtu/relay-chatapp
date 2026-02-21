import * as React from "react";
import { cn } from "@/utils/utils";

const variantClasses = {
  default: "bg-primary text-primary-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  outline: "border border-border",
  secondary: "bg-secondary text-secondary-foreground",
  ghost: "border-transparent",
};

const sizeClasses = {
  default: "min-h-9 px-4 py-2",
  sm: "min-h-8 rounded-md px-3 text-xs",
  lg: "min-h-10 rounded-md px-8",
  icon: "h-9 w-9",
};

const Button = React.forwardRef(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant] || variantClasses.default,
        sizeClasses[size] || sizeClasses.default,
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button };
