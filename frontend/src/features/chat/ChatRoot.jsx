/**
 * Chat feature root: full UI with Sidebar + ChatWindow.
 * Phase 2: loadChats once when auth becomes true (run-on-auth-transition); not re-run on loadChats identity changes.
 * Gates loadChats and WS by isAuthenticated; shows "Login required" when unauthenticated.
 * While auth isLoading, renders stable shell (Sidebar + loading placeholder) to avoid flicker.
 */
import { useContext, useEffect, useRef } from "react";
import { Link } from "wouter";
import { ChatAdapterContext, ChatAdapterProvider, useChatStore } from "./adapters";
import { Sidebar } from "./ui/Sidebar";
import { ChatWindow } from "./ui/ChatWindow";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

/**
 * Guard to ensure ChatRoot always renders inside a ChatAdapterProvider.
 * If the provider higher in the tree is missing (or a different module instance during HMR),
 * we wrap the content with a local provider so hooks keep working instead of throwing.
 */
function ChatProviderBoundary({ children }) {
  const ctx = useContext(ChatAdapterContext);
  if (ctx) return children;
  return <ChatAdapterProvider>{children}</ChatAdapterProvider>;
}

function ChatRootInner() {
  const { isAuthenticated, isLoading } = useAuth();
  const { loadChats } = useChatStore();
  /** Run once per auth session: load when isAuthenticated becomes true; reset on logout so re-login loads again. */
  const didLoadRef = useRef(false);
  const loadChatsRef = useRef(loadChats);
  useEffect(() => {
    loadChatsRef.current = loadChats;
  }, [loadChats]);

  useEffect(() => {
    if (isAuthenticated) {
      if (!didLoadRef.current) {
        loadChatsRef.current?.();
        didLoadRef.current = true;
      }
    } else {
      didLoadRef.current = false;
    }
  }, [isAuthenticated]);

  // Refetch chat list when user returns to the tab so new DMs appear without manual refresh
  useEffect(() => {
    if (!isAuthenticated) return;
    const onFocus = () => {
      loadChatsRef.current?.();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isAuthenticated]);

  // Stable shell while auth is bootstrapping: same layout so Sidebar does not unmount
  if (isLoading) {
    return (
      <div className="chat-page-scope flex flex-1 min-h-0 w-full overflow-hidden bg-[#EFEAE2] dark:bg-[#0f172a]">
        <aside className="w-[320px] flex-shrink-0 flex flex-col border-r border-border/50 overflow-hidden h-full">
          <Sidebar />
        </aside>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="chat-page-scope flex flex-1 min-h-0 w-full items-center justify-center bg-[#EFEAE2] dark:bg-[#0f172a]">
        <div className="flex flex-col gap-4 items-center p-8 border border-border rounded-xl bg-muted/30">
          <p className="text-muted-foreground">Login required</p>
          <Link href="/login">
            <Button>Go to Login</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page-scope flex flex-1 min-h-0 w-full overflow-hidden bg-[#EFEAE2] dark:bg-[#0f172a]">
      <aside className="w-[320px] flex-shrink-0 flex flex-col border-r border-border/50 overflow-hidden h-full">
        <Sidebar />
      </aside>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[#EFEAE2] dark:bg-[#0f172a]">
        <ChatWindow />
      </main>
    </div>
  );
}

export default function ChatRoot() {
  return (
    <ChatProviderBoundary>
      <ChatRootInner />
    </ChatProviderBoundary>
  );
}
