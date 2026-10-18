"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/components/status-banner";
import { BrandHeader, Segmented } from "@/components/ui/brand-header";
import {
  AmountIcon,
  CalendarIcon,
  CameraIcon,
  CategoryIcon,
  ImageIcon,
  StoreIcon,
} from "@/components/ui/icons";
import { DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORIES } from "@/lib/categories";
import { imageFileToJpeg } from "@/lib/image-upload";
import { enqueueReceiptProcessingItems } from "@/lib/local-storage";
import { createManualReceipt } from "@/lib/receipt-service";
import { ensureBrowserSession } from "@/lib/supabase/session";

type Tab = "info" | "image";

export function AddReceiptScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("info");
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(todayIso);
  const [category, setCategory] = useState<string>(DEFAULT_EXPENSE_CATEGORY);
  const [amount, setAmount] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const parsedAmount = parseAmount(amount);
  const amountInvalid = amount.trim() !== "" && parsedAmount == null;
  const canSave = !saving && !preparingPhoto && !amountInvalid && (parsedAmount != null || photo != null);

  async function handlePhotoPicked(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreparingPhoto(true);
    try {
      const jpeg = await imageFileToJpeg(file);
      setPhoto(jpeg);
      setPhotoUrl(URL.createObjectURL(jpeg));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "That photo couldn't be used.");
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function handleSave() {
    if (!canSave) {
      setError(
        amountInvalid
          ? "Enter the amount as a number, for example 12.50."
          : "Enter the amount, or add a photo in Expense Image so it can be read.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    const user = await ensureBrowserSession();
    if (!user) {
      setError("You need to sign in first.");
      setSaving(false);
      return;
    }

    const result = await createManualReceipt({
      category,
      image: photo,
      merchantName: supplier.trim() || null,
      receiptDate: date || null,
      totalAmount: parsedAmount,
      userId: user.id,
    });

    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }

    if (result.data.status === "processing") {
      enqueueReceiptProcessingItems([
        {
          created_at: new Date().toISOString(),
          receipt_id: result.data.id,
          state: "queued",
          status_text: "Reading the photo",
          thumbnail_data_url: null,
          user_id: user.id,
        },
      ]);
      router.replace("/receipts?tab=processing");
      return;
    }

    router.replace("/receipts?tab=all");
  }

  return (
    <main className="min-h-dvh bg-[var(--surface)]">
      <BrandHeader
        title="Add Receipt"
        left={
          <Link href="/receipts" className="text-[1.05rem] font-semibold text-white">
            Cancel
          </Link>
        }
        right={
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="text-[1.05rem] font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        }
      />

      <section className="mx-auto max-w-md px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { label: "Expense Info", value: "info" },
            { label: "Expense Image", value: "image" },
          ]}
        />

        {error ? (
          <div className="mt-4">
            <StatusBanner tone="error" message={error} />
          </div>
        ) : null}

        {tab === "info" ? (
          <div className="mt-4 space-y-2">
            <FieldRow icon={<StoreIcon className="h-7 w-7" />}>
              <input
                className="line-field"
                placeholder="Supplier"
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                autoComplete="off"
              />
            </FieldRow>
            <FieldRow icon={<CalendarIcon className="h-7 w-7" />}>
              <input
                type="date"
                className="line-field"
                value={date}
                max={todayIso()}
                onChange={(event) => setDate(event.target.value)}
              />
            </FieldRow>
            <FieldRow icon={<CategoryIcon className="h-7 w-7" />}>
              <select
                className="line-field appearance-none"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {EXPENSE_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow icon={<AmountIcon className="h-7 w-7" />}>
              <div className="flex items-center">
                <span className="text-[1.05rem] text-[var(--text-primary)]">£</span>
                <input
                  className={`line-field pl-1 ${amountInvalid ? "border-[var(--danger)]" : ""}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </FieldRow>

            <div className="pt-8 text-center">
              <p className="text-sm text-[var(--text-secondary)]">Have the receipt with you?</p>
              <Link
                href="/camera"
                className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-[var(--pink)] px-5 py-2.5 text-[1.02rem] font-semibold text-[var(--pink)] transition hover:bg-[var(--danger-bg)]"
              >
                <CameraIcon className="h-6 w-6" />
                Scan receipt to autofill
              </Link>
              <p className="mx-auto mt-3 max-w-xs text-xs leading-5 text-[var(--text-muted)]">
                Or add a photo in Expense Image and leave the amount empty: it will be read and filled in for you.
              </p>
            </div>
          </div>
        ) : (
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

            {photoUrl ? (
              <img
                src={photoUrl}
                alt="Receipt photo"
                className="max-h-[58dvh] w-full rounded-xl bg-[var(--surface-soft)] object-contain"
              />
            ) : (
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex h-[46dvh] w-full flex-col items-center justify-center gap-3 rounded-xl bg-[var(--surface-soft)] text-[var(--text-muted)]"
              >
                <ImageIcon className="h-20 w-20" />
                <span className="text-lg">{preparingPhoto ? "Preparing photo..." : "Add photo"}</span>
              </button>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={preparingPhoto}
                className="rounded-lg bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-60"
              >
                {photoUrl ? "Retake photo" : "Take photo"}
              </button>
              <button
                type="button"
                onClick={() => libraryInputRef.current?.click()}
                disabled={preparingPhoto}
                className="secondary-button rounded-lg py-3 font-semibold disabled:opacity-60"
              >
                Choose from library
              </button>
            </div>
            {photoUrl ? (
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  setPhotoUrl(null);
                }}
                className="mt-3 w-full py-2 text-sm font-semibold text-[var(--danger)]"
              >
                Remove photo
              </button>
            ) : null}
          </div>
        )}
      </section>
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

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseAmount(value: string) {
  const cleaned = value.replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}
