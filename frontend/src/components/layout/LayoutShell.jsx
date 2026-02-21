/**
 * Minimal layout shell. Global header always visible; children below.
 * Background: #EFEAE2 (light) for /chat route only; otherwise bg-background.
 */
import { useLocation } from "wouter";
import { cn } from "@/utils/utils";
import { GlobalHeader } from "./GlobalHeader";

export default function LayoutShell({ children }) {
  const [location] = useLocation();
  const isChat = location.startsWith("/chat");

  return (
    <div
      className={cn(
        "min-h-screen h-full flex flex-col",
        isChat ? "bg-[#EFEAE2] dark:bg-[#0f172a]" : "bg-background"
      )}
    >
      <GlobalHeader />
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col",
          isChat && "bg-[#EFEAE2] dark:bg-[#0f172a]"
        )}
      >
        {children}
      </div>
    </div>
  );
}
