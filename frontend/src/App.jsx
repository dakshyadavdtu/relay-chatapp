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
