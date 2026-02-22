import LayoutShell from "./components/layout/LayoutShell";
import { Routes } from "./routes";
import { Toaster } from "@/components/ui/toaster";
import { UiPrefsDebug } from "@/features/ui_prefs";
import { AuthDebugButton } from "@/components/auth/AuthDebugButton";
import { ErrorBoundary } from "./components/system/ErrorBoundary";
import { AuthLoadingGate } from "./components/system/AuthLoadingGate";
import { ChatAdapterProvider } from "@/features/chat/adapters";
import { SessionSwitchListener } from "@/features/auth/SessionSwitchListener";

const enableDevTools = import.meta.env.VITE_ENABLE_DEV_TOOLS === "true";

function App() {
  // #region agent log
  try {
    fetch("http://127.0.0.1:7440/ingest/34831ccd-0439-498b-bff5-78886fda482e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8283cd" },
      body: JSON.stringify({
        sessionId: "8283cd",
        location: "App.jsx:App",
        message: "App render start",
        data: {},
        timestamp: Date.now(),
        hypothesisId: "H3",
      }),
    }).catch(() => {});
  } catch (_) {}
  // #endregion
  return (
    <LayoutShell>
      <Toaster />
      <SessionSwitchListener />
      <AuthLoadingGate>
        <ErrorBoundary>
          <ChatAdapterProvider>
            <Routes />
          </ChatAdapterProvider>
        </ErrorBoundary>
      </AuthLoadingGate>
      {enableDevTools && (
        <>
          <UiPrefsDebug />
          <AuthDebugButton />
        </>
      )}
    </LayoutShell>
  );
}

export default App;
