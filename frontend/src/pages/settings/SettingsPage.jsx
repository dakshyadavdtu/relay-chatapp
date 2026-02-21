import { Redirect } from "wouter";
import { SettingsLayout } from "@/components/settings/SettingsLayout";

export default function SettingsPage() {
  return (
    <SettingsLayout>
      <Redirect to="/settings/profile" replace />
    </SettingsLayout>
  );
}
