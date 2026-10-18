import { SessionGate } from "@/components/auth/session-gate";
import { AddReceiptScreen } from "@/components/receipts/add-receipt-screen";

export default function AddReceiptPage() {
  return (
    <SessionGate requireAuth>
      <AddReceiptScreen />
    </SessionGate>
  );
}
