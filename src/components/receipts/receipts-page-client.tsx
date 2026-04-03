"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/empty-state";
import { StatusBanner } from "@/components/status-banner";
import { fetchReceiptsWithUrls } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate } from "@/lib/utils";
import type { ReceiptListItem } from "@/lib/types";

export function ReceiptsPageClient() {
  const [items, setItems] = useState<ReceiptListItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReceipts = useEffectEvent(async () => {
    setLoading(true);
    setStatusMessage(null);

    if (supabaseEnvError) {
      setStatusMessage(supabaseEnvError);
      setLoading(false);
      return;
    }

    const user = await ensureBrowserSession();
    if (!user) {
      setStatusMessage("You need to sign in to view saved receipts.");
      setLoading(false);
      return;
    }

    const result = await fetchReceiptsWithUrls(user.id);
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
          <Link
            href="/camera"
            className="soft-card rounded-full px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white"
          >
            Capture
          </Link>
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
                        {item.merchant_name ?? "Merchant pending"}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {item.folder_name ?? "Unsorted"}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {item.status}
                    </span>
                  </div>

                  <div className="mt-6 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Date
                      </p>
                      <p className="mt-1 text-sm text-white">
                        {formatReceiptDate(item.receipt_date, item.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Amount
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--accent)]">
                        {formatCurrency(item.total_amount)}
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
