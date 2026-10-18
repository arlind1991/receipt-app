"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GardenWowPanel } from "@/components/receipts/gardenwow-panel";
import { StatusBanner } from "@/components/status-banner";
import { BrandHeader, Segmented } from "@/components/ui/brand-header";
import {
  AmountIcon,
  CalendarIcon,
  CategoryIcon,
  ImageIcon,
  StoreIcon,
  TagIcon,
} from "@/components/ui/icons";
import { EXPENSE_CATEGORIES, toExpenseCategory } from "@/lib/categories";
import { imageFileToJpeg } from "@/lib/image-upload";
import {
  attachReceiptImage,
  deleteReceipt,
  fetchReceiptDetail,
  triggerReceiptProcessing,
  updateReceiptFields,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import type { ReceiptDetail, ReceiptEditableFields } from "@/lib/types";

type ReceiptDetailClientProps = {
  receiptId: string;
};

type DetailTab = "info" | "image";

type EditValues = {
  amount: string;
  category: string;
  date: string;
  merchant: string;
  tag: string;
  vat: string;
};

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
  const [isRetrying, setIsRetrying] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const merchantInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const [editValues, setEditValues] = useState<EditValues>(emptyEditValues);

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
    setEditValues(editValuesOf(nextReceipt));
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
    if (receipt && !receipt.merchant_name && receipt.status !== "processing") {
      merchantInputRef.current?.focus();
    }
  }, [receipt]);

  useEffect(() => {
    if (!isImageViewerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImageViewerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImageViewerOpen]);

  const amountInvalid = editValues.amount.trim() !== "" && parseAmount(editValues.amount) == null;
  const vatInvalid = editValues.vat.trim() !== "" && parseAmount(editValues.vat) == null;

  async function handleSave() {
    if (!receipt) {
      return;
    }
    if (amountInvalid || vatInvalid) {
      setStatusBanner({ message: "Enter amounts as numbers, for example 12.50.", tone: "error" });
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
      total_amount: parseAmount(editValues.amount),
      vat_amount: parseAmount(editValues.vat),
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

  async function handleRetry() {
    setIsRetrying(true);
    setStatusBanner(null);
    const result = await triggerReceiptProcessing(receiptId);
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
    }

    const refreshed = await fetchReceipt();
    if (refreshed.ok) {
      applyReceipt(refreshed.data);
    }
    setIsRetrying(false);
  }

  async function handlePhotoPicked(file: File | undefined) {
    if (!file || !receipt) {
      return;
    }

    setIsUploadingPhoto(true);
    setStatusBanner(null);
    try {
      const user = await ensureBrowserSession();
      if (!user) {
        throw new Error("You need to sign in first.");
      }
      const jpeg = await imageFileToJpeg(file);
      const attached = await attachReceiptImage(receipt.id, user.id, jpeg, receipt.image_path);
      if (!attached.ok) {
        throw new Error(attached.error);
      }

      // Re-save the current details so GardenWow (if connected) gets the photo.
      await updateReceiptFields(receipt.id, {
        category: receipt.category,
        currency: receipt.currency,
        folder_id: receipt.folder_id,
        merchant_name: receipt.merchant_name,
        notes: receipt.notes,
        receipt_date: receipt.receipt_date,
        total_amount: receipt.total_amount,
        vat_amount: receipt.vat_amount,
      });

      const refreshed = await fetchReceipt();
      if (refreshed.ok) {
        applyReceipt(refreshed.data);
      }
      setStatusBanner({ message: "Photo saved.", tone: "info" });
    } catch (error) {
      setStatusBanner({
        message: error instanceof Error ? error.message : "The photo couldn't be saved.",
        tone: "error",
      });
    } finally {
      setIsUploadingPhoto(false);
    }
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
    }
  }

  function handlePrint() {
    if (!receipt?.signed_image_url) {
      return;
    }

    window.open(receipt.signed_image_url, "_blank", "noopener,noreferrer");
  }

  const isDirty = useMemo(() => {
    if (!receipt) {
      return false;
    }
    const saved = editValuesOf(receipt);
    return (Object.keys(saved) as Array<keyof EditValues>).some((key) => saved[key] !== editValues[key]);
  }, [editValues, receipt]);

  const isProcessing = receipt?.status === "processing";

  return (
    <main className="min-h-dvh bg-[var(--surface)]">
      <BrandHeader
        title="Receipt"
        left={
          <Link href="/receipts" className="text-[1.05rem] font-semibold text-white">
            Close
          </Link>
        }
        right={
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSavingEdits || !isDirty}
            className="text-[1.05rem] font-semibold text-white disabled:opacity-50"
          >
            {isSavingEdits ? "Saving..." : "Save"}
          </button>
        }
      />

      <section className="mx-auto max-w-md px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+32px)]">
        <Segmented
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { label: "Expense Info", value: "info" },
            { label: "Expense Image", value: "image" },
          ]}
        />

        {statusBanner ? (
          <div className="mt-4">
            <StatusBanner tone={statusBanner.tone} message={statusBanner.message} />
          </div>
        ) : null}

        {loading && !receipt ? (
          <p className="py-10 text-center text-sm text-[var(--text-secondary)]">Loading receipt...</p>
        ) : null}

        {receipt && isProcessing ? (
          <div className="mt-4 rounded-xl bg-[var(--brand-tint)] px-4 py-3 text-sm font-semibold text-[var(--brand-strong)]">
            Reading the receipt... the details will appear here in a few seconds.
          </div>
        ) : null}

        {receipt?.extraction_error ? (
          <div
            className={`mt-4 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm ${
              receipt.status === "failed" ? "danger-card" : "warning-card text-[var(--text-primary)]"
            }`}
          >
            <p>{receipt.extraction_error}</p>
            {receipt.status === "failed" && receipt.image_path ? (
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={isRetrying}
                className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] disabled:opacity-60"
              >
                {isRetrying ? "Reading..." : "Try again"}
              </button>
            ) : null}
          </div>
        ) : null}

        {receipt && activeTab === "info" ? (
          <div className="mt-4">
            <div className="space-y-2">
              <FieldRow icon={<StoreIcon className="h-7 w-7" />}>
                <input
                  ref={merchantInputRef}
                  className="line-field"
                  placeholder="Supplier"
                  value={editValues.merchant}
                  onChange={(event) => setEditValues((current) => ({ ...current, merchant: event.target.value }))}
                />
              </FieldRow>
              <FieldRow icon={<CalendarIcon className="h-7 w-7" />}>
                <input
                  type="date"
                  className="line-field"
                  value={editValues.date}
                  onChange={(event) => setEditValues((current) => ({ ...current, date: event.target.value }))}
                />
              </FieldRow>
              <FieldRow icon={<CategoryIcon className="h-7 w-7" />}>
                <select
                  className="line-field appearance-none"
                  value={editValues.category}
                  onChange={(event) => setEditValues((current) => ({ ...current, category: event.target.value }))}
                >
                  {editValues.category === "" ? <option value="">Choose a category</option> : null}
                  {EXPENSE_CATEGORIES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow icon={<AmountIcon className="h-7 w-7" />}>
                <div className="flex items-center">
                  <span className="text-[1.05rem]">{currencySymbol(receipt.currency)}</span>
                  <input
                    className={`line-field pl-1 ${amountInvalid ? "border-[var(--danger)]" : ""}`}
                    inputMode="decimal"
                    placeholder="Amount"
                    value={editValues.amount}
                    onChange={(event) => setEditValues((current) => ({ ...current, amount: event.target.value }))}
                  />
                </div>
              </FieldRow>
              <FieldRow icon={<span className="block w-7 text-center text-sm font-extrabold">VAT</span>}>
                <input
                  className={`line-field ${vatInvalid ? "border-[var(--danger)]" : ""}`}
                  inputMode="decimal"
                  placeholder="VAT (if shown on the receipt)"
                  value={editValues.vat}
                  onChange={(event) => setEditValues((current) => ({ ...current, vat: event.target.value }))}
                />
              </FieldRow>
              <FieldRow icon={<TagIcon className="h-7 w-7" />}>
                <input
                  className="line-field"
                  placeholder="Tag (e.g. client or job)"
                  value={editValues.tag}
                  onChange={(event) => setEditValues((current) => ({ ...current, tag: event.target.value }))}
                />
              </FieldRow>
            </div>

            <div className="mt-6">
              <GardenWowPanel
                hasUnsavedChanges={isDirty}
                receiptDate={receipt.receipt_date}
                receiptId={receipt.id}
                refreshKey={receipt.updated_at}
                userId={receipt.user_id}
              />
            </div>

            {receipt.raw_ocr_text ? (
              <details className="mt-6 rounded-xl bg-[var(--surface-soft)] px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--text-secondary)]">
                  Text read from the receipt
                </summary>
                <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-[var(--text-secondary)]">
                  {receipt.raw_ocr_text}
                </p>
              </details>
            ) : null}

            <div className="mt-6 divide-y divide-[var(--border-soft)] border-y border-[var(--border-soft)]">
              {receipt.signed_image_url ? (
                <>
                  <ActionRow label="Share" onClick={() => void handleShare()} />
                  <ActionRow label="Print" onClick={handlePrint} />
                </>
              ) : null}
              <ActionRow
                danger
                disabled={isDeleting}
                label={isDeleting ? "Deleting..." : "Delete receipt"}
                onClick={() => void handleDeleteReceipt()}
              />
            </div>
          </div>
        ) : null}

        {receipt && activeTab === "image" ? (
          <div className="mt-4">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                void handlePhotoPicked(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handlePhotoPicked(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {receipt.signed_image_url ? (
              <button type="button" onClick={() => setIsImageViewerOpen(true)} className="block w-full">
                <img
                  src={receipt.signed_image_url}
                  alt={receipt.merchant_name ?? "Receipt image"}
                  className="max-h-[62dvh] w-full rounded-xl bg-[var(--surface-soft)] object-contain"
                />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex h-[46dvh] w-full flex-col items-center justify-center gap-3 rounded-xl bg-[var(--surface-soft)] text-[var(--text-muted)]"
              >
                <ImageIcon className="h-20 w-20" />
                <span className="text-lg">{isUploadingPhoto ? "Saving photo..." : "Add photo"}</span>
              </button>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isUploadingPhoto || isProcessing}
                className="rounded-lg bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-60"
              >
                {receipt.image_path ? "Retake photo" : "Take photo"}
              </button>
              <button
                type="button"
                onClick={() => libraryInputRef.current?.click()}
                disabled={isUploadingPhoto || isProcessing}
                className="secondary-button rounded-lg py-3 font-semibold disabled:opacity-60"
              >
                Choose from library
              </button>
            </div>
          </div>
        ) : null}
      </section>

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
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[var(--text-primary)]"
              >
                Close
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center py-4">
              <div
                className="max-h-full w-full max-w-4xl overflow-auto rounded-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <img
                  src={receipt.signed_image_url}
                  alt={receipt.merchant_name ?? "Receipt image enlarged"}
                  className="mx-auto h-auto w-full rounded-2xl object-contain"
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function FieldRow({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <label className="flex items-center gap-4 py-1">
      <span className="shrink-0 text-[var(--brand)]">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function ActionRow({
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
      className={`w-full px-1 py-4 text-left text-[1.05rem] font-semibold transition hover:bg-[var(--nav-hover)] disabled:opacity-60 ${
        danger ? "text-[var(--danger)]" : "text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}

function emptyEditValues(): EditValues {
  return { amount: "", category: "", date: "", merchant: "", tag: "", vat: "" };
}

function editValuesOf(receipt: ReceiptDetail): EditValues {
  return {
    amount: receipt.total_amount != null ? String(receipt.total_amount) : "",
    // Older receipts may have a pre-HMRC label; show (and save) the matching HMRC category.
    category: toExpenseCategory(receipt.category) ?? "",
    date: receipt.receipt_date ?? "",
    merchant: receipt.merchant_name ?? "",
    tag: receipt.notes ?? "",
    vat: receipt.vat_amount != null ? String(receipt.vat_amount) : "",
  };
}

function parseAmount(value: string) {
  const cleaned = value.replace(/[£$€,\s]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

function currencySymbol(currency: string | null) {
  const code = (currency ?? "GBP").toUpperCase();
  return code === "GBP" ? "£" : code === "EUR" ? "€" : code === "USD" ? "$" : `${code} `;
}
