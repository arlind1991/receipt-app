"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import {
  deleteReceipt,
  fetchReceiptDetail,
  triggerReceiptProcessing,
  updateReceiptFields,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate, normalizeCurrency } from "@/lib/utils";
import type { ReceiptDetail, ReceiptEditableFields } from "@/lib/types";

const showReceiptDebug =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_RECEIPT_DEBUG === "true";

type ReceiptDetailClientProps = {
  receiptId: string;
};

export function ReceiptDetailClient({
  receiptId,
}: ReceiptDetailClientProps) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editValues, setEditValues] = useState({
    merchant_name: "",
    receipt_date: "",
    total_amount: "",
    vat_amount: "",
    category: "",
  });

  async function fetchReceipt() {
    if (supabaseEnvError) {
      return { ok: false as const, error: supabaseEnvError };
    }

    const user = await ensureBrowserSession();
    if (!user) {
      return {
        ok: false as const,
        error: "You need to sign in to load this receipt.",
      };
    }

    const result = await fetchReceiptDetail(receiptId, user.id);
    return result;
  }

  function applyReceipt(nextReceipt: ReceiptDetail) {
    setReceipt(nextReceipt);
    setEditValues({
      merchant_name: nextReceipt.merchant_name ?? "",
      receipt_date: nextReceipt.receipt_date ?? "",
      total_amount:
        nextReceipt.total_amount != null ? String(nextReceipt.total_amount) : "",
      vat_amount: nextReceipt.vat_amount != null ? String(nextReceipt.vat_amount) : "",
      category: nextReceipt.category ?? "",
    });
  }

  const loadReceipt = useEffectEvent(async () => {
    setLoading(true);
    setStatusMessage(null);

    const result = await fetchReceipt();
    if (!result.ok) {
      setStatusMessage(result.error);
      setLoading(false);
      return;
    }

    applyReceipt(result.data);
    setLoading(false);
  });

  async function handleRefresh() {
    setLoading(true);
    setStatusMessage(null);

    const result = await fetchReceipt();
    if (!result.ok) {
      setStatusMessage(result.error);
      setLoading(false);
      return;
    }

    applyReceipt(result.data);
    setLoading(false);
  }

  const triggerProcessing = useEffectEvent(async () => {
    const result = await triggerReceiptProcessing(receiptId);
    if (!result.ok) {
      setStatusMessage(result.error);
    }

    const refreshed = await fetchReceipt();
    if (!refreshed.ok) {
      setStatusMessage(refreshed.error);
      return;
    }

    applyReceipt(refreshed.data);
  });

  useEffect(() => {
    void loadReceipt();
  }, [receiptId]);

  useEffect(() => {
    if (receipt?.status !== "processing") {
      return;
    }

    void triggerProcessing();

    const intervalId = window.setInterval(() => {
      void loadReceipt();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [receipt?.status, receiptId]);

  async function handleSaveEdits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!receipt) {
      return;
    }

    setIsSavingEdits(true);
    setStatusMessage(null);

    const payload: ReceiptEditableFields = {
      merchant_name: editValues.merchant_name.trim() || null,
      receipt_date: editValues.receipt_date || null,
      total_amount: editValues.total_amount ? Number(editValues.total_amount) : null,
      vat_amount: editValues.vat_amount ? Number(editValues.vat_amount) : null,
      category: editValues.category.trim() || null,
    };

    const result = await updateReceiptFields(receipt.id, payload);
    if (!result.ok) {
      setStatusMessage(result.error);
      setIsSavingEdits(false);
      return;
    }

    const refreshed = await fetchReceipt();
    if (!refreshed.ok) {
      setStatusMessage(refreshed.error);
      setIsSavingEdits(false);
      return;
    }

    applyReceipt(refreshed.data);
    setIsSavingEdits(false);
  }

  async function handleDeleteReceipt() {
    if (!receipt) {
      return;
    }

    const confirmed = window.confirm("Delete this receipt and its stored image?");
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setStatusMessage(null);

    const result = await deleteReceipt(receipt.id);
    if (!result.ok) {
      setStatusMessage(result.error);
      setIsDeleting(false);
      return;
    }

    router.replace("/receipts");
    router.refresh();
  }

  const statusDescription = useMemo(() => {
    if (!receipt) {
      return null;
    }

    if (receipt.status === "processing") {
      return "We are reading the receipt now. Fields will refresh automatically when extraction finishes.";
    }

    if (receipt.status === "failed") {
      return "Extraction failed. You can still review the image and fill in the important fields manually below.";
    }

    if (receipt.status === "done" && isPartiallyRead(receipt)) {
      return "Partially read. Some fields were recovered, and you can fill in the rest manually.";
    }

    return null;
  }, [receipt]);

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
            >
              Refresh
            </button>
            <span className="eyebrow">Receipt Detail</span>
          </div>
        </div>

        {statusMessage ? <StatusBanner tone="error" message={statusMessage} /> : null}

        {loading ? (
          <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
            Loading receipt...
          </div>
        ) : null}

        {receipt ? (
          <div className="space-y-4">
            {statusDescription ? <StatusBanner message={statusDescription} /> : null}

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
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Saved Fields</p>
                <span className="rounded-full bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {resolveDisplayStatus(receipt)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <FieldCard
                  label="Merchant"
                  value={
                    receipt.merchant_name ??
                    (receipt.status === "processing" ? "Processing..." : "Unknown")
                  }
                />
                <FieldCard
                  label="Receipt date"
                  value={
                    receipt.receipt_date
                      ? formatReceiptDate(receipt.receipt_date, receipt.created_at)
                      : receipt.status === "processing"
                        ? "Processing..."
                        : "Unknown"
                  }
                />
                <FieldCard
                  label="Total"
                  value={
                    receipt.total_amount != null
                      ? formatCurrency(
                          receipt.total_amount,
                          normalizeCurrency(receipt.currency),
                        )
                      : receipt.status === "processing"
                        ? "Processing..."
                        : "Unknown"
                  }
                />
                <FieldCard
                  label="VAT"
                  value={
                    receipt.vat_amount != null
                      ? formatCurrency(
                          receipt.vat_amount,
                          normalizeCurrency(receipt.currency),
                        )
                      : receipt.status === "processing"
                        ? "Processing..."
                        : "Unknown"
                  }
                />
                <FieldCard
                  label="Currency"
                  value={receipt.currency ? normalizeCurrency(receipt.currency) : "Unknown"}
                />
                <FieldCard label="Category" value={receipt.category ?? "Uncategorized"} />
                <FieldCard label="Folder" value={receipt.folder_name ?? "Unsorted"} />
              </div>

              <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  OCR text
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                  {receipt.raw_ocr_text ??
                    (receipt.status === "processing"
                      ? "Extracting OCR text..."
                      : "No OCR text captured.")}
                </p>
              </div>

              {showReceiptDebug ? (
                <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Debug
                  </p>
                  <div className="mt-3 space-y-3 text-sm text-[var(--text-secondary)]">
                    <p>Extraction error: {receipt.extraction_error ?? "None"}</p>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Parsed JSON
                      </p>
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-6 text-white/80">
                        {receipt.parsed_ocr_json ?? "No parsed JSON saved."}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="glass-panel rounded-[28px] p-5">
              <p className="eyebrow">Manual Edit</p>
              <form onSubmit={(event) => void handleSaveEdits(event)} className="mt-4 space-y-3">
                <InputField
                  label="Merchant name"
                  value={editValues.merchant_name}
                  onChange={(value) =>
                    setEditValues((current) => ({ ...current, merchant_name: value }))
                  }
                />
                <InputField
                  label="Receipt date"
                  type="date"
                  value={editValues.receipt_date}
                  onChange={(value) =>
                    setEditValues((current) => ({ ...current, receipt_date: value }))
                  }
                />
                <InputField
                  label="Total amount"
                  type="number"
                  step="0.01"
                  value={editValues.total_amount}
                  onChange={(value) =>
                    setEditValues((current) => ({ ...current, total_amount: value }))
                  }
                />
                <InputField
                  label="VAT amount"
                  type="number"
                  step="0.01"
                  value={editValues.vat_amount}
                  onChange={(value) =>
                    setEditValues((current) => ({ ...current, vat_amount: value }))
                  }
                />
                <InputField
                  label="Category"
                  value={editValues.category}
                  onChange={(value) =>
                    setEditValues((current) => ({ ...current, category: value }))
                  }
                />
                <button
                  type="submit"
                  disabled={isSavingEdits || receipt.status === "processing"}
                  className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#082319] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {receipt.status === "processing"
                    ? "Finish processing first"
                    : isSavingEdits
                      ? "Saving edits..."
                      : "Save changes"}
                </button>
              </form>
            </section>

            <section className="glass-panel rounded-[28px] p-5">
              <p className="eyebrow">Danger Zone</p>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                Delete the receipt record and its private image from storage.
              </p>
              <button
                type="button"
                onClick={() => void handleDeleteReceipt()}
                disabled={isDeleting}
                className="mt-5 w-full rounded-full border border-[rgba(255,139,158,0.28)] bg-[rgba(255,139,158,0.12)] px-4 py-3 text-sm font-medium text-[#ffd8de] transition hover:bg-[rgba(255,139,158,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? "Deleting receipt..." : "Delete receipt"}
              </button>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function resolveDisplayStatus(receipt: ReceiptDetail) {
  if (receipt.status === "done" && isPartiallyRead(receipt)) {
    return "partially read";
  }

  return receipt.status;
}

function isPartiallyRead(receipt: ReceiptDetail) {
  if (!receipt.raw_ocr_text) {
    return false;
  }

  const populatedFields = [
    receipt.merchant_name,
    receipt.receipt_date,
    receipt.total_amount,
    receipt.vat_amount,
    receipt.category,
  ].filter((value) => value !== null && value !== "").length;

  return populatedFields > 0 && populatedFields < 5;
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

type InputFieldProps = {
  label: string;
  onChange: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
};

function InputField({
  label,
  onChange,
  step,
  type = "text",
  value,
}: InputFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-[var(--text-secondary)]">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
      />
    </label>
  );
}
