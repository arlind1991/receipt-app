import { SessionGate } from "@/components/auth/session-gate";
import { ReceiptsPageClient } from "@/components/receipts/receipts-page-client";

export default function ReceiptsPage() {
  return (
    <SessionGate requireAuth>
      <ReceiptsPageClient />
    </SessionGate>
  );
}
