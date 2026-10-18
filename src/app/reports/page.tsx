import { SessionGate } from "@/components/auth/session-gate";
import { ReportsScreen } from "@/components/reports/reports-screen";

export default function ReportsPage() {
  return (
    <SessionGate requireAuth>
      <ReportsScreen />
    </SessionGate>
  );
}
