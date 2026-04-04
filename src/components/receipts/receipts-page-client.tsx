"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/empty-state";
import { StatusBanner } from "@/components/status-banner";
import { fetchReceiptsWithUrls } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate, normalizeCurrency } from "@/lib/utils";
import type { ReceiptListItem } from "@/lib/types";

type ReceiptsTab = "recent" | "all" | "processing";

export function ReceiptsPageClient() {
  const [items, setItems] = useState<ReceiptListItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReceiptsTab>("all");

  async function fetchReceipts() {
    if (supabaseEnvError) {
      return { ok: false as const, error: supabaseEnvError };
    }

    const user = await ensureBrowserSession();
    if (!user) {
      return {
        ok: false as const,
        error: "You need to sign in to view receipts.",
      };
    }

    return fetchReceiptsWithUrls(user.id);
  }

  async function runReceiptLoad() {
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

  const loadReceipts = useEffectEvent(async () => {
    await runReceiptLoad();
  });

  useEffect(() => {
    void loadReceipts();
  }, []);

  async function handleRefresh() {
    await runReceiptLoad();
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

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => getReceiptTimestamp(right) - getReceiptTimestamp(left)),
    [items],
  );

  const allItems = useMemo(
    () => sortedItems.filter((item) => item.status !== "processing"),
    [sortedItems],
  );

  const recentItems = useMemo(() => allItems.slice(0, 15), [allItems]);

  const processingItems = useMemo(
    () => sortedItems.filter((item) => item.status === "processing"),
    [sortedItems],
  );

  const visibleItems =
    activeTab === "recent"
      ? recentItems
      : activeTab === "processing"
        ? processingItems
        : allItems;

  return (
    <main className="app-shell app-shell-with-nav">
      <section className="mx-auto w-full max-w-md">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Receipts</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Expense receipts</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="secondary-button rounded-full px-4 py-2 text-sm transition"
            >
              Refresh
            </button>
            <Link
              href="/camera"
              className="secondary-button rounded-full px-4 py-2 text-sm transition"
            >
              Scan
            </Link>
          </div>
        </div>

        <section className="glass-panel rounded-[28px] p-3">
          <div className="grid grid-cols-3 gap-2">
            <ReceiptsTabButton
              active={activeTab === "recent"}
              label="Recent"
              onClick={() => setActiveTab("recent")}
            />
            <ReceiptsTabButton
              active={activeTab === "all"}
              label="All"
              onClick={() => setActiveTab("all")}
            />
            <ReceiptsTabButton
              active={activeTab === "processing"}
              label="Processing"
              onClick={() => setActiveTab("processing")}
            />
          </div>
        </section>

        {statusMessage ? (
          <div className="mt-4">
            <StatusBanner tone="error" message={statusMessage} />
          </div>
        ) : null}

        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="text-base font-semibold text-[var(--text-primary)]">
                {activeTab === "recent"
                  ? "Recent receipts"
                  : activeTab === "processing"
                    ? "Processing now"
                    : "All receipts"}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
              Loading receipts...
            </div>
          ) : null}

          {!loading && visibleItems.length === 0 ? (
            <EmptyState
              title={
                activeTab === "processing"
                  ? "No receipts are processing"
                  : "No receipts yet"
              }
              description={
                activeTab === "processing"
                  ? "Receipts being scanned will appear here until extraction finishes."
                  : "Scan your first receipt to start building your expense list."
              }
            />
          ) : null}

          {!loading && visibleItems.length > 0 ? (
            <div className="glass-panel overflow-hidden rounded-[28px]">
              <div className="grid grid-cols-[92px_1fr_auto] gap-3 border-b border-[var(--border-soft)] px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <span>Date</span>
                <span>Merchant</span>
                <span>Amount</span>
              </div>
              <div>
                {visibleItems.map((item) => (
                  <ReceiptManagerRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <AppNav />
    </main>
  );
}

function ReceiptsTabButton({
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

function ReceiptManagerRow({ item }: { item: ReceiptListItem }) {
  return (
    <Link
      href={`/receipts/${item.id}`}
      className="grid grid-cols-[92px_1fr_auto] gap-3 border-b border-[var(--border-soft)] px-4 py-4 transition hover:bg-[var(--nav-hover)] last:border-b-0"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {formatReceiptDate(item.receipt_date, item.created_at)}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{buildRowStatus(item)}</p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
          {item.merchant_name ?? (item.status === "processing" ? "Processing receipt..." : "Unknown merchant")}
        </p>
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
          {item.category ?? item.folder_name ?? "Unsorted"}
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {item.total_amount != null
            ? formatCurrency(item.total_amount, normalizeCurrency(item.currency))
            : item.status === "processing"
              ? "Scanning..."
              : "Unknown"}
        </p>
      </div>
    </Link>
  );
}

function buildRowStatus(item: ReceiptListItem) {
  if (item.status === "processing") {
    return "Processing";
  }

  if (item.status === "failed") {
    return "Needs review";
  }

  return item.notes ? "Tagged" : "Saved";
}

function getReceiptTimestamp(item: ReceiptListItem) {
  return new Date(item.receipt_date ?? item.created_at).getTime();
}
