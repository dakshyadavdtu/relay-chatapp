import * as React from "react";

const TooltipProvider = ({ children }) => <>{children}</>;
const Tooltip = ({ children }) => <>{children}</>;
const TooltipTrigger = React.forwardRef(({ children, asChild, ...props }, ref) =>
  asChild ? React.cloneElement(children, { ref, ...props }) : (
    <span ref={ref} {...props}>{children}</span>
  )
);
TooltipTrigger.displayName = "TooltipTrigger";
const TooltipContent = ({ children }) => null;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
