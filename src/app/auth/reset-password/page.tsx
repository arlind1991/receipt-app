import { SessionGate } from "@/components/auth/session-gate";
import { ResetPasswordScreen } from "@/components/auth/reset-password-screen";

export default function ResetPasswordPage() {
  return (
    <SessionGate requireAuth>
      <ResetPasswordScreen />
    </SessionGate>
  );
}
