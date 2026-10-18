import { SessionGate } from "@/components/auth/session-gate";
import { AccountScreen } from "@/components/account/account-screen";

export default function SettingsPage() {
  return (
    <SessionGate requireAuth>
      <AccountScreen />
    </SessionGate>
  );
}
