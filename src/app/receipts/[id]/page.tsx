import { SessionGate } from "@/components/auth/session-gate";
import { ReceiptDetailClient } from "@/components/receipts/receipt-detail-client";

type ReceiptDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ReceiptDetailPage({
  params,
}: ReceiptDetailPageProps) {
  const { id } = await params;

  return (
    <SessionGate requireAuth>
      <ReceiptDetailClient receiptId={id} />
    </SessionGate>
  );
}
