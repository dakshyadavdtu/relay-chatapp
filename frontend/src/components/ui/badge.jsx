import * as React from "react";
import { cn } from "@/utils/utils";

const Badge = ({ className, variant = "default", ...props }) => (
  <div
    className={cn(
      "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold",
      variant === "default" && "border-transparent bg-primary text-primary-foreground",
      variant === "secondary" && "border-transparent bg-secondary text-secondary-foreground",
      variant === "destructive" && "border-transparent bg-destructive text-destructive-foreground",
      variant === "outline" && "border-border",
      className
    )}
    {...props}
  />
);

export { Badge };
