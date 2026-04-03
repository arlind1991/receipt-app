"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import { StatusBanner } from "@/components/status-banner";
import { fetchReceiptDetail } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate } from "@/lib/utils";
import type { ReceiptDetail } from "@/lib/types";

type ReceiptDetailClientProps = {
  receiptId: string;
};

export function ReceiptDetailClient({
  receiptId,
}: ReceiptDetailClientProps) {
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReceipt = useEffectEvent(async () => {
    setLoading(true);
    setStatusMessage(null);

    if (supabaseEnvError) {
      setStatusMessage(supabaseEnvError);
      setLoading(false);
      return;
    }

    const user = await ensureBrowserSession();
    if (!user) {
      setStatusMessage("You need to sign in to load this receipt.");
      setLoading(false);
      return;
    }

    const result = await fetchReceiptDetail(receiptId, user.id);
    if (!result.ok) {
      setStatusMessage(result.error);
      setLoading(false);
      return;
    }

    setReceipt(result.data);
    setLoading(false);
  });

  useEffect(() => {
    void loadReceipt();
  }, [receiptId]);

  return (
    <main className="app-shell">
      <section className="mx-auto w-full max-w-md pb-8">
        <div className="mb-5 flex items-center justify-between">
          <Link
            href="/receipts"
            className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
          >
            Back
          </Link>
          <span className="eyebrow">Receipt Detail</span>
        </div>

        {statusMessage ? <StatusBanner tone="error" message={statusMessage} /> : null}

        {loading ? (
          <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
            Loading receipt...
          </div>
        ) : null}

        {receipt ? (
          <div className="space-y-4">
            <section className="glass-panel overflow-hidden rounded-[32px]">
              {receipt.signed_image_url ? (
                <img
                  src={receipt.signed_image_url}
                  alt={receipt.merchant_name ?? "Receipt image"}
                  className="h-auto max-h-[56dvh] w-full object-cover"
                />
              ) : (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-[var(--text-muted)]">
                  Receipt image unavailable
                </div>
              )}
            </section>

            <section className="glass-panel rounded-[28px] p-5">
              <p className="eyebrow">Saved Fields</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <FieldCard label="Merchant" value={receipt.merchant_name ?? "Pending OCR"} />
                <FieldCard
                  label="Receipt date"
                  value={formatReceiptDate(receipt.receipt_date, receipt.created_at)}
                />
                <FieldCard label="Total" value={formatCurrency(receipt.total_amount)} />
                <FieldCard label="VAT" value={formatCurrency(receipt.vat_amount)} />
                <FieldCard label="Category" value={receipt.category ?? "Uncategorized"} />
                <FieldCard label="Folder" value={receipt.folder_name ?? "Unsorted"} />
              </div>
              <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  OCR status
                </p>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  OCR is not implemented yet. This placeholder uses stubbed values so the save and
                  review flow is ready for the next step.
                </p>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

type FieldCardProps = {
  label: string;
  value: string;
};

function FieldCard({ label, value }: FieldCardProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}
