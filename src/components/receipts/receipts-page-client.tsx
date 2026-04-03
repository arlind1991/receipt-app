"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/empty-state";
import { StatusBanner } from "@/components/status-banner";
import { fetchReceiptsWithUrls } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate, normalizeCurrency } from "@/lib/utils";
import type { ReceiptListItem } from "@/lib/types";

const showReceiptDebug =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_RECEIPT_DEBUG === "true";

export function ReceiptsPageClient() {
  const [items, setItems] = useState<ReceiptListItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchReceipts() {
    if (supabaseEnvError) {
      return { ok: false as const, error: supabaseEnvError };
    }

    const user = await ensureBrowserSession();
    if (!user) {
      return {
        ok: false as const,
        error: "You need to sign in to view saved receipts.",
      };
    }

    return fetchReceiptsWithUrls(user.id);
  }

  const loadReceipts = useEffectEvent(async () => {
    setLoading(true);
    setStatusMessage(null);

    const result = await fetchReceipts();
    if (!result.ok) {
      setStatusMessage(result.error);
      setLoading(false);
      return;
    }

    setItems(result.data);
    setLoading(false);
  });

  useEffect(() => {
    void loadReceipts();
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setStatusMessage(null);

    const result = await fetchReceipts();
    if (!result.ok) {
      setStatusMessage(result.error);
      setLoading(false);
      return;
    }

    setItems(result.data);
    setLoading(false);
  }

  useEffect(() => {
    if (!items.some((item) => item.status === "processing")) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadReceipts();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items;
    }

    return items.filter((item) =>
      [
        item.merchant_name,
        item.category,
        item.folder_name,
        item.status,
        item.receipt_date,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  return (
    <main className="app-shell pb-28">
      <section className="mx-auto w-full max-w-md">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Library</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Saved receipts</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
            >
              Refresh
            </button>
            <Link
              href="/camera"
              className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
            >
              Capture
            </Link>
          </div>
        </div>

        <label className="glass-panel block rounded-[24px] p-3">
          <span className="mb-2 block px-1 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Search
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Merchant, folder, date, or status"
            className="w-full border-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[var(--text-muted)]"
          />
        </label>

        {statusMessage ? (
          <div className="mt-4">
            <StatusBanner tone="error" message={statusMessage} />
          </div>
        ) : null}

        <section className="thin-scrollbar mt-5 flex flex-col gap-4">
          {loading ? (
            <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
              Loading saved receipts...
            </div>
          ) : null}

          {!loading && filteredItems.length === 0 ? (
            <EmptyState
              title="No receipts saved yet"
              description="Take your first receipt photo from the capture screen and it will show up here."
            />
          ) : null}

          {filteredItems.map((item) => (
            <Link
              key={item.id}
              href={`/receipts/${item.id}`}
              className="glass-panel overflow-hidden rounded-[28px] transition hover:-translate-y-0.5"
            >
              <div className="grid grid-cols-[112px_1fr] gap-4 p-3">
                <div className="overflow-hidden rounded-[22px] bg-white/6">
                  {item.signed_image_url ? (
                    <img
                      src={item.signed_image_url}
                      alt={item.merchant_name ?? "Receipt image"}
                      className="h-full min-h-[112px] w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[112px] items-center justify-center text-xs text-[var(--text-muted)]">
                      No image
                    </div>
                  )}
                </div>
                <div className="min-w-0 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">
                        {renderMerchantLabel(item)}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {item.folder_name ?? "Unsorted"}
                      </p>
                      {showReceiptDebug && item.extraction_error ? (
                        <p className="mt-2 text-xs text-[var(--danger)]">
                          {item.extraction_error}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill status={resolveDisplayStatus(item)} />
                  </div>

                  <div className="mt-6 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Date
                      </p>
                      <p className="mt-1 text-sm text-white">
                        {item.receipt_date
                          ? formatReceiptDate(item.receipt_date, item.created_at)
                          : item.status === "processing"
                            ? "Extracting..."
                            : "Unknown"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Amount
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--accent)]">
                        {item.total_amount != null
                          ? formatCurrency(item.total_amount, normalizeCurrency(item.currency))
                          : item.status === "processing"
                            ? "..."
                            : "Unknown"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </section>

      <AppNav />
    </main>
  );
}

function renderMerchantLabel(item: ReceiptListItem) {
  if (item.merchant_name) {
    return item.merchant_name;
  }

  if (item.status === "processing") {
    return "Processing receipt...";
  }

  if (item.status === "failed") {
    return "Extraction failed";
  }

  return "Unknown merchant";
}

function resolveDisplayStatus(item: ReceiptListItem) {
  if (item.status === "done" && isPartiallyRead(item)) {
    return "partially read";
  }

  return item.status;
}

function isPartiallyRead(item: ReceiptListItem) {
  if (!item.raw_ocr_text) {
    return false;
  }

  const populatedFields = [
    item.merchant_name,
    item.receipt_date,
    item.total_amount,
    item.vat_amount,
    item.category,
  ].filter((value) => value !== null && value !== "").length;

  return populatedFields > 0 && populatedFields < 5;
}

function StatusPill({ status }: { status: string }) {
  const className =
    status === "done"
      ? "bg-[rgba(143,247,208,0.14)] text-[var(--accent)]"
      : status === "partially read"
        ? "bg-[rgba(255,214,102,0.16)] text-[#ffd666]"
      : status === "failed"
        ? "bg-[rgba(255,139,158,0.14)] text-[var(--danger)]"
        : "bg-white/8 text-[var(--text-secondary)]";

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${className}`}>
      {status}
    </span>
  );
}
