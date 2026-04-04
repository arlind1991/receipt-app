"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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

type ReceiptDetailClientProps = {
  receiptId: string;
};

type DetailTab = "info" | "image";

export function ReceiptDetailClient({ receiptId }: ReceiptDetailClientProps) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    message: string;
    tone: "error" | "info";
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const merchantInputRef = useRef<HTMLInputElement | null>(null);
  const [editValues, setEditValues] = useState({
    amount: "",
    category: "",
    date: "",
    merchant: "",
    tag: "",
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

    return fetchReceiptDetail(receiptId, user.id);
  }

  function applyReceipt(nextReceipt: ReceiptDetail) {
    setReceipt(nextReceipt);
    setEditValues({
      amount: nextReceipt.total_amount != null ? String(nextReceipt.total_amount) : "",
      category: nextReceipt.category ?? "",
      date: nextReceipt.receipt_date ?? "",
      merchant: nextReceipt.merchant_name ?? "",
      tag: nextReceipt.notes ?? "",
    });
  }

  const loadReceipt = useEffectEvent(async () => {
    setLoading(true);
    setStatusBanner(null);

    const result = await fetchReceipt();
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
      setLoading(false);
      return;
    }

    applyReceipt(result.data);
    setLoading(false);
  });

  useEffect(() => {
    void loadReceipt();
  }, [receiptId]);

  const triggerProcessing = useEffectEvent(async () => {
    const result = await triggerReceiptProcessing(receiptId);
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
      return;
    }

    await loadReceipt();
  });

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

  useEffect(() => {
    if (receipt && !receipt.merchant_name) {
      merchantInputRef.current?.focus();
    }
  }, [receipt]);

  useEffect(() => {
    if (!isImageViewerOpen && !isMoreMenuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImageViewerOpen(false);
        setIsMoreMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImageViewerOpen, isMoreMenuOpen]);

  async function handleSave() {
    if (!receipt) {
      return;
    }

    setIsSavingEdits(true);
    setStatusBanner(null);

    const payload: ReceiptEditableFields = {
      category: editValues.category.trim() || null,
      currency: receipt.currency,
      folder_id: receipt.folder_id,
      merchant_name: editValues.merchant.trim() || null,
      notes: editValues.tag.trim() || null,
      receipt_date: editValues.date || null,
      total_amount: editValues.amount ? Number(editValues.amount) : null,
      vat_amount: receipt.vat_amount,
    };

    const result = await updateReceiptFields(receipt.id, payload);
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
      setIsSavingEdits(false);
      return;
    }

    const refreshed = await fetchReceipt();
    if (!refreshed.ok) {
      setStatusBanner({ message: refreshed.error, tone: "error" });
      setIsSavingEdits(false);
      return;
    }

    applyReceipt(refreshed.data);
    setIsSavingEdits(false);
    setStatusBanner({ message: "Changes saved.", tone: "info" });
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
    const result = await deleteReceipt(receipt.id);
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
      setIsDeleting(false);
      return;
    }

    router.replace("/receipts");
    router.refresh();
  }

  async function handleShare() {
    if (!receipt?.signed_image_url) {
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          text: receipt.merchant_name ?? "Receipt",
          title: "Receipt",
          url: receipt.signed_image_url,
        });
      } else {
        await navigator.clipboard.writeText(receipt.signed_image_url);
        setStatusBanner({ message: "Receipt image link copied.", tone: "info" });
      }
    } catch {
      setStatusBanner({ message: "Could not share this receipt.", tone: "error" });
    } finally {
      setIsMoreMenuOpen(false);
    }
  }

  function handlePrint() {
    if (!receipt?.signed_image_url) {
      return;
    }

    window.open(receipt.signed_image_url, "_blank", "noopener,noreferrer");
    setIsMoreMenuOpen(false);
  }

  function handleAddNote() {
    setActiveTab("info");
    setIsMoreMenuOpen(false);
  }

  const isDirty = useMemo(() => {
    if (!receipt) {
      return false;
    }

    return (
      (receipt.merchant_name ?? "") !== editValues.merchant ||
      (receipt.receipt_date ?? "") !== editValues.date ||
      (receipt.category ?? "") !== editValues.category ||
      (receipt.total_amount != null ? String(receipt.total_amount) : "") !== editValues.amount ||
      (receipt.notes ?? "") !== editValues.tag
    );
  }, [editValues, receipt]);

  return (
    <main className="app-shell app-shell-with-nav">
      <section className="mx-auto w-full max-w-md pb-32">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/receipts"
            className="secondary-button rounded-full px-4 py-2 text-sm transition"
          >
            Close
          </Link>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Edit Receipt</p>
          <button
            type="button"
            onClick={() => setIsMoreMenuOpen(true)}
            className="secondary-button rounded-full px-4 py-2 text-sm transition"
          >
            More
          </button>
        </div>

        <section className="glass-panel rounded-[28px] p-3">
          <div className="grid grid-cols-2 gap-2">
            <DetailTabButton
              active={activeTab === "info"}
              label="Expense Info"
              onClick={() => setActiveTab("info")}
            />
            <DetailTabButton
              active={activeTab === "image"}
              label="Expense Image"
              onClick={() => setActiveTab("image")}
            />
          </div>
        </section>

        {statusBanner ? (
          <div className="mt-4">
            <StatusBanner tone={statusBanner.tone} message={statusBanner.message} />
          </div>
        ) : null}

        {loading ? (
          <div className="soft-card mt-4 rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
            Loading receipt...
          </div>
        ) : null}

        {receipt && !loading ? (
          <div className="mt-4 space-y-4">
            <section className="glass-panel rounded-[28px] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {receipt.merchant_name ?? "Unknown merchant"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {formatReceiptDate(receipt.receipt_date, receipt.created_at)}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {receipt.status}
                </span>
              </div>
            </section>

            {activeTab === "info" ? (
              <section className="glass-panel rounded-[28px] p-5">
                <div className="space-y-4">
                  <InputField
                    inputRef={merchantInputRef}
                    label="Merchant"
                    value={editValues.merchant}
                    onChange={(value) =>
                      setEditValues((current) => ({ ...current, merchant: value }))
                    }
                  />
                  <InputField
                    label="Date"
                    type="date"
                    value={editValues.date}
                    onChange={(value) =>
                      setEditValues((current) => ({ ...current, date: value }))
                    }
                  />
                  <InputField
                    label="Category"
                    value={editValues.category}
                    onChange={(value) =>
                      setEditValues((current) => ({ ...current, category: value }))
                    }
                  />
                  <InputField
                    label="Amount"
                    type="number"
                    step="0.01"
                    value={editValues.amount}
                    onChange={(value) =>
                      setEditValues((current) => ({ ...current, amount: value }))
                    }
                  />
                  <InputField
                    label="Tag"
                    value={editValues.tag}
                    onChange={(value) =>
                      setEditValues((current) => ({ ...current, tag: value }))
                    }
                  />
                </div>

                <div className="mt-5 rounded-[22px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    OCR text
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                    {receipt.raw_ocr_text ?? "No OCR text captured."}
                  </p>
                </div>
              </section>
            ) : (
              <section className="glass-panel overflow-hidden rounded-[28px]">
                {receipt.signed_image_url ? (
                  <button
                    type="button"
                    onClick={() => setIsImageViewerOpen(true)}
                    className="block w-full text-left"
                  >
                    <img
                      src={receipt.signed_image_url}
                      alt={receipt.merchant_name ?? "Receipt image"}
                      className="h-auto max-h-[68dvh] w-full object-contain bg-[var(--surface-soft)]"
                    />
                  </button>
                ) : (
                  <div className="flex min-h-[360px] items-center justify-center text-sm text-[var(--text-muted)]">
                    Receipt image unavailable
                  </div>
                )}
              </section>
            )}
          </div>
        ) : null}
      </section>

      {receipt && activeTab === "info" ? (
        <section className="floating-action-bar">
          <div className="glass-panel rounded-[30px] px-4 py-4 shadow-[0_20px_60px_rgba(2,9,17,0.5)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Expense Info</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {receipt.currency
                    ? formatCurrency(receipt.total_amount, normalizeCurrency(receipt.currency))
                    : "Edit and save changes"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSavingEdits || !isDirty}
                className="shrink-0 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingEdits ? "Saving..." : isDirty ? "Save changes" : "Saved"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {receipt?.signed_image_url && isImageViewerOpen ? (
        <section
          className="fixed inset-0 z-[70] bg-[var(--overlay-backdrop)]"
          onClick={() => setIsImageViewerOpen(false)}
        >
          <div className="flex min-h-dvh flex-col px-4 py-[max(1rem,env(safe-area-inset-top,0px))]">
            <div className="mx-auto flex w-full max-w-4xl justify-end">
              <button
                type="button"
                onClick={() => setIsImageViewerOpen(false)}
                className="secondary-button rounded-full px-4 py-2 text-sm font-medium"
              >
                Close
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center py-4">
              <div
                className="max-h-full w-full max-w-4xl overflow-auto rounded-[28px]"
                onClick={(event) => event.stopPropagation()}
              >
                <img
                  src={receipt.signed_image_url}
                  alt={receipt.merchant_name ?? "Receipt image enlarged"}
                  className="mx-auto h-auto w-full rounded-[28px] object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isMoreMenuOpen ? (
        <section
          className="fixed inset-0 z-[75] bg-[rgba(5,10,18,0.46)]"
          onClick={() => setIsMoreMenuOpen(false)}
        >
          <div className="flex min-h-dvh items-end justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
            <div
              className="glass-panel w-full max-w-md rounded-[30px] p-3"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreMenuButton label="Add note" onClick={handleAddNote} />
              <MoreMenuButton label="Share" onClick={() => void handleShare()} />
              <MoreMenuButton label="Print" onClick={handlePrint} />
              <MoreMenuButton
                danger
                disabled={isDeleting}
                label={isDeleting ? "Deleting..." : "Delete"}
                onClick={() => void handleDeleteReceipt()}
              />
              <MoreMenuButton label="Cancel" onClick={() => setIsMoreMenuOpen(false)} />
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function DetailTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
          : "secondary-button"
      }`}
    >
      {label}
    </button>
  );
}

function InputField({
  inputRef,
  label,
  onChange,
  step,
  type = "text",
  value,
}: {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  label: string;
  onChange: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-[var(--text-secondary)]">{label}</span>
      <input
        ref={inputRef}
        type={type}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-control w-full rounded-2xl px-4 py-3 text-sm outline-none"
      />
    </label>
  );
}

function MoreMenuButton({
  danger = false,
  disabled = false,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-[22px] px-4 py-4 text-left text-sm font-medium transition ${
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger-bg)]"
          : "text-[var(--text-primary)] hover:bg-[var(--nav-hover)]"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {label}
    </button>
  );
}
