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

type SortOption = "newest" | "highest";

export function ReceiptsPageClient() {
  const [items, setItems] = useState<ReceiptListItem[]>([]);
  const [query, setQuery] = useState("");
  const [merchantFilter, setMerchantFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
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

  const merchantOptions = useMemo(() => {
    return [...new Set(items.map((item) => item.merchant_name).filter(Boolean))]
      .sort((a, b) => a!.localeCompare(b!)) as string[];
  }, [items]);

  const categoryOptions = useMemo(() => {
    return [...new Set(items.map((item) => item.category).filter(Boolean))]
      .sort((a, b) => a!.localeCompare(b!)) as string[];
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (normalizedQuery) {
        const haystack = [
          item.merchant_name,
          item.category,
          item.folder_name,
          item.status,
          item.receipt_date,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }

      if (merchantFilter && item.merchant_name !== merchantFilter) {
        return false;
      }

      if (categoryFilter && item.category !== categoryFilter) {
        return false;
      }

      const effectiveDate = item.receipt_date ?? item.created_at.slice(0, 10);

      if (dateFrom && effectiveDate < dateFrom) {
        return false;
      }

      if (dateTo && effectiveDate > dateTo) {
        return false;
      }

      return true;
    });

    return filtered.sort((left, right) => {
      if (sortBy === "highest") {
        return (right.total_amount ?? -1) - (left.total_amount ?? -1);
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }, [categoryFilter, dateFrom, dateTo, items, merchantFilter, query, sortBy]);

  const insights = useMemo(() => buildInsights(items), [items]);

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

        <section className="glass-panel rounded-[28px] p-4">
          <p className="eyebrow">Insights</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <InsightCard
              label="This month"
              value={formatCurrency(insights.thisMonthSpend, insights.primaryCurrency)}
            />
            <InsightCard
              label="Last month"
              value={formatCurrency(insights.lastMonthSpend, insights.primaryCurrency)}
            />
            <InsightCard
              label="Biggest expense"
              value={
                insights.biggestExpense
                  ? `${insights.biggestExpense.merchant_name ?? "Unknown"} · ${formatCurrency(
                      insights.biggestExpense.total_amount,
                      normalizeCurrency(insights.biggestExpense.currency),
                    )}`
                  : "None yet"
              }
            />
            <InsightCard
              label="Top merchants"
              value={
                insights.topMerchants.length > 0
                  ? insights.topMerchants
                      .map(
                        (merchant) =>
                          `${merchant.name} (${formatCurrency(
                            merchant.total,
                            insights.primaryCurrency,
                          )})`,
                      )
                      .join(" · ")
                  : "No spend yet"
              }
            />
          </div>
        </section>

        <section className="glass-panel mt-4 rounded-[28px] p-4">
          <label className="block">
            <span className="mb-2 block px-1 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Search
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Merchant, folder, date, or status"
              className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)]"
            />
          </label>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <SelectField
              label="Merchant"
              onChange={setMerchantFilter}
              options={merchantOptions}
              value={merchantFilter}
            />
            <SelectField
              label="Category"
              onChange={setCategoryFilter}
              options={categoryOptions}
              value={categoryFilter}
            />
            <InputField
              label="From"
              onChange={setDateFrom}
              type="date"
              value={dateFrom}
            />
            <InputField
              label="To"
              onChange={setDateTo}
              type="date"
              value={dateTo}
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSortBy("newest")}
              className={`rounded-full px-4 py-2 text-sm transition ${
                sortBy === "newest"
                  ? "bg-[var(--accent)] text-[#082319]"
                  : "soft-card text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              Newest first
            </button>
            <button
              type="button"
              onClick={() => setSortBy("highest")}
              className={`rounded-full px-4 py-2 text-sm transition ${
                sortBy === "highest"
                  ? "bg-[var(--accent)] text-[#082319]"
                  : "soft-card text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              Highest amount
            </button>
          </div>
        </section>

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
              title="No receipts match these filters"
              description="Try a different date range, merchant, category, or search term."
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
                      <p className="text-base font-semibold">{renderMerchantLabel(item)}</p>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {item.category ?? item.folder_name ?? "Unsorted"}
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

function buildInsights(items: ReceiptListItem[]) {
  const completed = items.filter(
    (item) => item.total_amount != null && item.status !== "failed",
  );
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthSpend = sumSpend(
    completed.filter((item) => new Date(item.created_at) >= currentMonthStart),
  );
  const lastMonthSpend = sumSpend(
    completed.filter((item) => {
      const created = new Date(item.created_at);
      return created >= lastMonthStart && created < currentMonthStart;
    }),
  );
  const biggestExpense = [...completed].sort(
    (left, right) => (right.total_amount ?? 0) - (left.total_amount ?? 0),
  )[0] ?? null;

  const merchantTotals = completed.reduce<Record<string, number>>((accumulator, item) => {
    const merchant = item.merchant_name ?? "Unknown";
    accumulator[merchant] = (accumulator[merchant] ?? 0) + (item.total_amount ?? 0);
    return accumulator;
  }, {});

  const topMerchants = Object.entries(merchantTotals)
    .map(([name, total]) => ({ name, total }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 3);

  const primaryCurrency =
    completed.find((item) => item.currency)?.currency ?? "GBP";

  return {
    biggestExpense,
    lastMonthSpend,
    primaryCurrency: normalizeCurrency(primaryCurrency),
    thisMonthSpend,
    topMerchants,
  };
}

function sumSpend(items: ReceiptListItem[]) {
  return items.reduce((total, item) => total + (item.total_amount ?? 0), 0);
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

type InsightCardProps = {
  label: string;
  value: string;
};

function InsightCard({ label, value }: InsightCardProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-white">{value}</p>
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
};

function SelectField({ label, onChange, options, value }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-[var(--text-secondary)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm outline-none focus:border-[var(--border-strong)]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

type InputFieldProps = {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
};

function InputField({
  label,
  onChange,
  type = "text",
  value,
}: InputFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-[var(--text-secondary)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm outline-none focus:border-[var(--border-strong)]"
      />
    </label>
  );
}
