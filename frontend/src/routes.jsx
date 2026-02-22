/**
 * Central route declarations for myfrontend.
 * Phase 6D: /chat, /settings/*, /admin protected by RequireAuth.
 * Wrapped in Switch so only the first matching route renders (prevents NotFound from rendering alongside /chat, /settings).
 * Phase 4: Root always redirects to /login when unauthenticated.
 */
import { Route, Redirect, Switch } from "wouter";
import ChatPage from "./features/chat";
// Admin: real pages from pages/admin; layout from features/admin
import { AdminLayout } from "./features/admin/ui/AdminLayout";
import DashboardPage from "./pages/admin/DashboardPage";
import AdminUsersPage from "./pages/admin/AdminUsersPage";
import AdminReportsPage from "./pages/admin/AdminReportsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import ProfilePage from "./pages/settings/ProfilePage";
import SecurityPage from "./pages/settings/SecurityPage";
import DevicesPage from "./pages/settings/DevicesPage";
import PreferencesPage from "./pages/settings/PreferencesPage";
import DangerPage from "./pages/settings/DangerPage";
import { SettingsLayout } from "./components/settings/SettingsLayout";
import { RequireAuth } from "./components/auth/RequireAuth";
import { RequireRole } from "./components/auth/RequireRole";
import ProfilePlaceholder from "./pages/ProfilePlaceholder";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import Forgot from "./pages/auth/Forgot";
import Reset from "./pages/auth/Reset";
import VerifyOTP from "./pages/auth/VerifyOTP";
import NotFound from "./pages/system/NotFound";

function SettingsRoute({ Page }) {
  return (
    <SettingsLayout>
      <Page />
    </SettingsLayout>
  );
}

export function Routes() {
  // #region agent log
  try {
    fetch("http://127.0.0.1:7440/ingest/34831ccd-0439-498b-bff5-78886fda482e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8283cd" },
      body: JSON.stringify({
        sessionId: "8283cd",
        location: "routes.jsx:Routes",
        message: "Routes render start",
        data: {},
        timestamp: Date.now(),
        hypothesisId: "H2",
      }),
    }).catch(() => {});
  } catch (_) {}
  // #endregion
  return (
    <Switch>
      <Route path="/chat">
        <RequireAuth>
          <ChatPage />
        </RequireAuth>
      </Route>
      <Route path="/settings">
        <RequireAuth>
          <SettingsPage />
        </RequireAuth>
      </Route>
      <Route path="/settings/profile">
        <RequireAuth>
          <SettingsRoute Page={ProfilePage} />
        </RequireAuth>
      </Route>
      <Route path="/settings/security">
        <RequireAuth>
          <SettingsRoute Page={SecurityPage} />
        </RequireAuth>
      </Route>
      <Route path="/settings/devices">
        <RequireAuth>
          <SettingsRoute Page={DevicesPage} />
        </RequireAuth>
      </Route>
      <Route path="/settings/preferences">
        <RequireAuth>
          <SettingsRoute Page={PreferencesPage} />
        </RequireAuth>
      </Route>
      <Route path="/settings/connection">
        <Redirect to="/settings" />
      </Route>
      <Route path="/settings/danger">
        <RequireAuth>
          <SettingsRoute Page={DangerPage} />
        </RequireAuth>
      </Route>
      <Route path="/admin/users">
        <RequireAuth>
          <RequireRole roles={["ADMIN"]}>
            <AdminLayout>
              <AdminUsersPage />
            </AdminLayout>
          </RequireRole>
        </RequireAuth>
      </Route>
      <Route path="/admin/reports">
        <RequireAuth>
          <RequireRole roles={["ADMIN"]}>
            <AdminLayout>
              <AdminReportsPage />
            </AdminLayout>
          </RequireRole>
        </RequireAuth>
      </Route>
      <Route path="/admin">
        <RequireAuth>
          <RequireRole roles={["ADMIN"]}>
            <AdminLayout>
              <DashboardPage />
            </AdminLayout>
          </RequireRole>
        </RequireAuth>
      </Route>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot" component={Forgot} />
      <Route path="/reset" component={Reset} />
      <Route path="/verify-otp" component={VerifyOTP} />
      <Route path="/profile">
        <RequireAuth>
          <ProfilePlaceholder />
        </RequireAuth>
      </Route>
      <Route path="/"><Redirect to="/login" /></Route>
      <Route path="/404" component={NotFound} />
      <Route path="*" component={NotFound} />
    </Switch>
  );
}
