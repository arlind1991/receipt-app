"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import {
  detectPotentialDuplicates,
  fetchFolders,
  deleteReceipt,
  fetchReceiptDetail,
  triggerReceiptProcessing,
  updateReceiptFields,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate, normalizeCurrency } from "@/lib/utils";
import type {
  DuplicateReceiptCandidate,
  FolderRow,
  ReceiptDetail,
  ReceiptEditableFields,
} from "@/lib/types";

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
  const [statusBanner, setStatusBanner] = useState<{
    message: string;
    tone: "error" | "info";
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateReceiptCandidate[]>([]);
  const merchantInputRef = useRef<HTMLInputElement | null>(null);
  const receiptDateInputRef = useRef<HTMLInputElement | null>(null);
  const totalInputRef = useRef<HTMLInputElement | null>(null);
  const vatInputRef = useRef<HTMLInputElement | null>(null);
  const currencyInputRef = useRef<HTMLInputElement | null>(null);
  const categoryInputRef = useRef<HTMLInputElement | null>(null);
  const folderSelectRef = useRef<HTMLSelectElement | null>(null);
  const [editValues, setEditValues] = useState({
    currency: "",
    folder_id: "",
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

  async function fetchAvailableFolders() {
    if (supabaseEnvError) {
      return { ok: false as const, error: supabaseEnvError };
    }

    const user = await ensureBrowserSession();
    if (!user) {
      return {
        ok: false as const,
        error: "You need to sign in to load folders.",
      };
    }

    return fetchFolders(user.id);
  }

  async function refreshDuplicateCandidates(nextReceipt: {
    id: string;
    merchant_name: string | null;
    receipt_date: string | null;
    total_amount: number | null;
  }) {
    const user = await ensureBrowserSession();
    if (!user) {
      setDuplicateCandidates([]);
      return;
    }

    const result = await detectPotentialDuplicates({
      merchantName: nextReceipt.merchant_name,
      receiptDate: nextReceipt.receipt_date,
      receiptId: nextReceipt.id,
      totalAmount: nextReceipt.total_amount,
      userId: user.id,
    });

    if (!result.ok) {
      setDuplicateCandidates([]);
      return;
    }

    setDuplicateCandidates(result.data);
  }

  function applyReceipt(nextReceipt: ReceiptDetail) {
    setReceipt(nextReceipt);
    setEditValues({
      currency: nextReceipt.currency ?? "",
      folder_id: nextReceipt.folder_id ?? "",
      merchant_name: nextReceipt.merchant_name ?? "",
      receipt_date: nextReceipt.receipt_date ?? "",
      total_amount:
        nextReceipt.total_amount != null ? String(nextReceipt.total_amount) : "",
      vat_amount: nextReceipt.vat_amount != null ? String(nextReceipt.vat_amount) : "",
      category: nextReceipt.category ?? "",
    });
    void refreshDuplicateCandidates(nextReceipt);
  }

  function updateEditField(
    field: keyof typeof editValues,
    value: string,
  ) {
    setEditValues((current) => ({ ...current, [field]: value }));
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

  async function handleRefresh() {
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
  }

  const triggerProcessing = useEffectEvent(async () => {
    const result = await triggerReceiptProcessing(receiptId);
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
    }

    const refreshed = await fetchReceipt();
    if (!refreshed.ok) {
      setStatusBanner({ message: refreshed.error, tone: "error" });
      return;
    }

    applyReceipt(refreshed.data);
  });

  useEffect(() => {
    void loadReceipt();
  }, [receiptId]);

  useEffect(() => {
    const loadFolders = async () => {
      const result = await fetchAvailableFolders();
      if (!result.ok) {
        return;
      }

      setFolders(result.data);
    };

    void loadFolders();
  }, []);

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
    if (!receipt) {
      return;
    }

    const firstMissingField = getFirstMissingField(receipt);
    if (!firstMissingField) {
      return;
    }

    const target =
      firstMissingField === "merchant_name"
        ? merchantInputRef.current
        : firstMissingField === "receipt_date"
          ? receiptDateInputRef.current
          : firstMissingField === "total_amount"
            ? totalInputRef.current
            : firstMissingField === "vat_amount"
              ? vatInputRef.current
              : firstMissingField === "currency"
                ? currencyInputRef.current
                : categoryInputRef.current;

    target?.focus();
  }, [receipt]);

  useEffect(() => {
    if (!receipt) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshDuplicateCandidates({
        id: receipt.id,
        merchant_name: editValues.merchant_name.trim() || null,
        receipt_date: editValues.receipt_date || null,
        total_amount: editValues.total_amount ? Number(editValues.total_amount) : null,
      });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editValues.merchant_name, editValues.receipt_date, editValues.total_amount, receipt]);

  async function handleSaveEdits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!receipt) {
      return;
    }

    setIsSavingEdits(true);
    setStatusBanner(null);

    const payload: ReceiptEditableFields = {
      currency: editValues.currency.trim().toUpperCase() || null,
      folder_id: editValues.folder_id || null,
      merchant_name: editValues.merchant_name.trim() || null,
      receipt_date: editValues.receipt_date || null,
      total_amount: editValues.total_amount ? Number(editValues.total_amount) : null,
      vat_amount: editValues.vat_amount ? Number(editValues.vat_amount) : null,
      category: editValues.category.trim() || null,
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
    router.replace("/receipts");
    router.refresh();
  }

  function handleDone() {
    router.replace("/receipts");
    router.refresh();
  }

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

  async function handleDeleteReceipt() {
    if (!receipt) {
      return;
    }

    const confirmed = window.confirm("Delete this receipt and its stored image?");
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setStatusBanner(null);

    const result = await deleteReceipt(receipt.id);
    if (!result.ok) {
      setStatusBanner({ message: result.error, tone: "error" });
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

  const missingFields = useMemo(() => {
    if (!receipt) {
      return [];
    }

    return getMissingFields(receipt);
  }, [receipt]);

  const isDirty = useMemo(() => {
    if (!receipt) {
      return false;
    }

    return !matchesReceiptEditValues(receipt, editValues);
  }, [editValues, receipt]);

  const saveDisabled = !receipt || receipt.status === "processing" || isSavingEdits || !isDirty;

  return (
    <main className="app-shell app-shell-with-nav">
      <section className="mx-auto w-full max-w-md pb-36">
        <div className="mb-5 flex items-center justify-between">
          <Link
            href="/receipts"
            className="secondary-button rounded-full px-4 py-2 text-sm transition"
          >
            Back
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="secondary-button rounded-full px-4 py-2 text-sm transition"
            >
              Refresh
            </button>
            <span className="eyebrow">Receipt Detail</span>
          </div>
        </div>

        {statusBanner ? (
          <StatusBanner tone={statusBanner.tone} message={statusBanner.message} />
        ) : null}

        {loading ? (
          <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
            Loading receipt...
          </div>
        ) : null}

        {receipt ? (
          <div className="space-y-4">
            {statusDescription ? <StatusBanner message={statusDescription} /> : null}

            {missingFields.length > 0 && receipt.status !== "processing" ? (
              <StatusBanner
                message={`Missing ${missingFields.join(", ")}. Tap a field below or edit the form to complete the receipt.`}
              />
            ) : null}

            {duplicateCandidates.length > 0 ? (
              <StatusBanner
                tone="error"
                message={`Possible duplicate detected. ${formatDuplicateSummary(duplicateCandidates)} You can still save this receipt if it is genuinely separate.`}
              />
            ) : null}

            <section className="glass-panel overflow-hidden rounded-[32px]">
              {receipt.signed_image_url ? (
                <button
                  type="button"
                  onClick={() => setIsImageViewerOpen(true)}
                  className="block w-full text-left"
                >
                  <img
                    src={receipt.signed_image_url}
                    alt={receipt.merchant_name ?? "Receipt image"}
                    className="h-auto max-h-[56dvh] w-full object-cover"
                  />
                  <div className="flex items-center justify-between border-t border-[var(--border-soft)] bg-[var(--card-soft)] px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        Tap to enlarge
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        Open a larger full-screen view of the receipt image.
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      View
                    </span>
                  </div>
                </button>
              ) : (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-[var(--text-muted)]">
                  Receipt image unavailable
                </div>
              )}
            </section>

            <section className="glass-panel rounded-[28px] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Saved Fields</p>
                <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {resolveDisplayStatus(receipt)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <FieldCard
                  missing={!receipt.merchant_name && receipt.status !== "processing"}
                  label="Merchant"
                  onClick={() => merchantInputRef.current?.focus()}
                  value={
                    receipt.merchant_name ??
                    (receipt.status === "processing" ? "Processing..." : "Unknown")
                  }
                />
                <FieldCard
                  missing={!receipt.receipt_date && receipt.status !== "processing"}
                  label="Receipt date"
                  onClick={() => receiptDateInputRef.current?.focus()}
                  value={
                    receipt.receipt_date
                      ? formatReceiptDate(receipt.receipt_date, receipt.created_at)
                      : receipt.status === "processing"
                        ? "Processing..."
                        : "Unknown"
                  }
                />
                <FieldCard
                  missing={receipt.total_amount == null && receipt.status !== "processing"}
                  label="Total"
                  onClick={() => totalInputRef.current?.focus()}
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
                  missing={receipt.vat_amount == null && receipt.status !== "processing"}
                  label="VAT"
                  onClick={() => vatInputRef.current?.focus()}
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
                  missing={!receipt.currency && receipt.status !== "processing"}
                  onClick={() => currencyInputRef.current?.focus()}
                  value={receipt.currency ? normalizeCurrency(receipt.currency) : "Unknown"}
                />
                <FieldCard
                  missing={!receipt.category && receipt.status !== "processing"}
                  label="Category"
                  onClick={() => categoryInputRef.current?.focus()}
                  value={receipt.category ?? "Uncategorized"}
                />
                <FieldCard
                  label="Folder"
                  onClick={() => folderSelectRef.current?.focus()}
                  value={receipt.folder_name ?? "Unsorted"}
                />
              </div>

              <div className="mt-4 rounded-[24px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
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

              {receipt.notes ? (
                <div className="mt-4 rounded-[24px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Notes
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                    {receipt.notes}
                  </p>
                </div>
              ) : null}

              {showReceiptDebug ? (
                <div className="mt-4 rounded-[24px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Debug
                  </p>
                  <div className="mt-3 space-y-3 text-sm text-[var(--text-secondary)]">
                    <p>Extraction error: {receipt.extraction_error ?? "None"}</p>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Parsed JSON
                      </p>
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3 text-xs leading-6 text-[var(--text-primary)]">
                        {receipt.parsed_ocr_json ?? "No parsed JSON saved."}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="glass-panel rounded-[28px] p-5">
              <p className="eyebrow">Manual Edit</p>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                Tap any missing field above or edit directly here. Save stays pinned below so you
                do not need to scroll back through the form.
              </p>
              <form
                id="receipt-edit-form"
                onSubmit={(event) => void handleSaveEdits(event)}
                className="mt-4 space-y-3"
              >
                <InputField
                  label="Merchant name"
                  inputRef={merchantInputRef}
                  value={editValues.merchant_name}
                  onChange={(value) => updateEditField("merchant_name", value)}
                />
                <InputField
                  label="Receipt date"
                  inputRef={receiptDateInputRef}
                  type="date"
                  value={editValues.receipt_date}
                  onChange={(value) => updateEditField("receipt_date", value)}
                />
                <InputField
                  label="Total amount"
                  inputRef={totalInputRef}
                  type="number"
                  step="0.01"
                  value={editValues.total_amount}
                  onChange={(value) => updateEditField("total_amount", value)}
                />
                <InputField
                  label="VAT amount"
                  inputRef={vatInputRef}
                  type="number"
                  step="0.01"
                  value={editValues.vat_amount}
                  onChange={(value) => updateEditField("vat_amount", value)}
                />
                <InputField
                  label="Currency"
                  inputRef={currencyInputRef}
                  value={editValues.currency}
                  onChange={(value) => updateEditField("currency", value.toUpperCase().slice(0, 3))}
                />
                <InputField
                  label="Category"
                  inputRef={categoryInputRef}
                  value={editValues.category}
                  onChange={(value) => updateEditField("category", value)}
                />
                <SelectField
                  label="Folder"
                  selectRef={folderSelectRef}
                  value={editValues.folder_id}
                  onChange={(value) => updateEditField("folder_id", value)}
                  options={[
                    { label: "Unsorted", value: "" },
                    ...folders.map((folder) => ({
                      label: folder.name,
                      value: folder.id,
                    })),
                  ]}
                />
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
                className="danger-card mt-5 w-full rounded-full px-4 py-3 text-sm font-medium transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? "Deleting receipt..." : "Delete receipt"}
              </button>
            </section>
          </div>
        ) : null}
      </section>

      {receipt ? (
        <section className="floating-action-bar">
          <div className="glass-panel rounded-[30px] px-4 py-4 shadow-[0_20px_60px_rgba(2,9,17,0.5)]">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="eyebrow">Review</p>
              </div>

              {isDirty ? (
                <button
                  type="submit"
                  form="receipt-edit-form"
                  disabled={saveDisabled}
                  className="shrink-0 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingEdits ? "Saving..." : "Save changes"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDone}
                  className="shrink-0 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition hover:bg-[var(--accent-strong)]"
                >
                  Done
                </button>
              )}
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
  missing?: boolean;
  onClick?: () => void;
  value: string;
};

function FieldCard({
  label,
  missing = false,
  onClick,
  value,
}: FieldCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[22px] border p-4 text-left ${
        missing
          ? "warning-card"
          : "border-[var(--border-soft)] bg-[var(--card-soft)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>
      </div>
      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{value}</p>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Tap to edit</p>
    </button>
  );
}

type InputFieldProps = {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  label: string;
  onChange: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
};

function InputField({
  inputRef,
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

function getMissingFields(receipt: ReceiptDetail) {
  const fields: string[] = [];

  if (!receipt.merchant_name) fields.push("merchant");
  if (!receipt.receipt_date) fields.push("receipt date");
  if (receipt.total_amount == null) fields.push("total");
  if (receipt.vat_amount == null) fields.push("VAT");
  if (!receipt.currency) fields.push("currency");
  if (!receipt.category) fields.push("category");

  return fields;
}

function getFirstMissingField(receipt: ReceiptDetail) {
  if (!receipt.merchant_name) return "merchant_name";
  if (!receipt.receipt_date) return "receipt_date";
  if (receipt.total_amount == null) return "total_amount";
  if (receipt.vat_amount == null) return "vat_amount";
  if (!receipt.currency) return "currency";
  if (!receipt.category) return "category";
  return null;
}

function matchesReceiptEditValues(
  receipt: ReceiptDetail,
  editValues: {
    currency: string;
    folder_id: string;
    merchant_name: string;
    receipt_date: string;
    total_amount: string;
    vat_amount: string;
    category: string;
  },
) {
  return (
    (receipt.currency ?? "") === editValues.currency &&
    (receipt.folder_id ?? "") === editValues.folder_id &&
    (receipt.merchant_name ?? "") === editValues.merchant_name &&
    (receipt.receipt_date ?? "") === editValues.receipt_date &&
    (receipt.total_amount != null ? String(receipt.total_amount) : "") === editValues.total_amount &&
    (receipt.vat_amount != null ? String(receipt.vat_amount) : "") === editValues.vat_amount &&
    (receipt.category ?? "") === editValues.category
  );
}

function formatDuplicateSummary(duplicates: DuplicateReceiptCandidate[]) {
  const [first] = duplicates;
  if (!first) {
    return "A receipt with the same details was found.";
  }

  const merchant = first.merchant_name ?? "Another receipt";
  const date = first.receipt_date ?? "the same date";
  const total =
    first.total_amount != null ? ` and total ${first.total_amount.toFixed(2)}` : "";

  if (duplicates.length === 1) {
    return `${merchant} already exists on ${date}${total}.`;
  }

  return `${merchant} is one of ${duplicates.length} similar receipts on ${date}${total}.`;
}

type SelectFieldProps = {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  selectRef?: React.RefObject<HTMLSelectElement | null>;
  value: string;
};

function SelectField({ label, onChange, options, selectRef, value }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-[var(--text-secondary)]">{label}</span>
      <select
        ref={selectRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-control w-full rounded-2xl px-4 py-3 text-sm outline-none"
      >
        {options.map((option) => (
          <option key={option.value || "empty"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
