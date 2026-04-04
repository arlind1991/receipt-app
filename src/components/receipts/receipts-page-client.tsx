"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/empty-state";
import { StatusBanner } from "@/components/status-banner";
import { getReceiptViewMode, setReceiptViewMode, type ReceiptViewMode } from "@/lib/local-storage";
import { fetchReceiptsWithUrls } from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, formatReceiptDate, normalizeCurrency } from "@/lib/utils";
import type { ReceiptListItem } from "@/lib/types";

const showReceiptDebug =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_RECEIPT_DEBUG === "true";

type SortOption = "newest" | "highest";

type ReceiptSection = {
  items: ReceiptListItem[];
  key: string;
  title: string;
};

export function ReceiptsPageClient() {
  const [items, setItems] = useState<ReceiptListItem[]>([]);
  const [query, setQuery] = useState("");
  const [merchantFilter, setMerchantFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [viewMode, setViewMode] = useState<ReceiptViewMode>(() => getReceiptViewMode());
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

  function handleViewModeChange(nextMode: ReceiptViewMode) {
    setReceiptViewMode(nextMode);
    setViewMode(nextMode);
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

      const effectiveDate = getEffectiveDateValue(item);

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

      return getReceiptTimestamp(right) - getReceiptTimestamp(left);
    });
  }, [categoryFilter, dateFrom, dateTo, items, merchantFilter, query, sortBy]);

  const insights = useMemo(() => buildInsights(items), [items]);
  const sections = useMemo(() => buildReceiptSections(filteredItems), [filteredItems]);

  return (
    <main className="app-shell app-shell-with-nav">
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
              className="secondary-button rounded-full px-4 py-2 text-sm transition"
            >
              Refresh
            </button>
            <Link
              href="/camera"
              className="secondary-button rounded-full px-4 py-2 text-sm transition"
            >
              Capture
            </Link>
          </div>
        </div>

        <section className="glass-panel rounded-[28px] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Insights</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleViewModeChange("gallery")}
                className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                  viewMode === "gallery"
                    ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
                    : "secondary-button"
                }`}
              >
                Gallery
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange("list")}
                className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                  viewMode === "list"
                    ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
                    : "secondary-button"
                }`}
              >
                List
              </button>
            </div>
          </div>

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
              className="field-control w-full rounded-2xl px-4 py-3 text-sm outline-none"
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
            <InputField label="From" onChange={setDateFrom} type="date" value={dateFrom} />
            <InputField label="To" onChange={setDateTo} type="date" value={dateTo} />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSortBy("newest")}
              className={`rounded-full px-4 py-2 text-sm transition ${
                sortBy === "newest"
                  ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
                  : "secondary-button"
              }`}
            >
              Newest first
            </button>
            <button
              type="button"
              onClick={() => setSortBy("highest")}
              className={`rounded-full px-4 py-2 text-sm transition ${
                sortBy === "highest"
                  ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
                  : "secondary-button"
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

        <section className="thin-scrollbar mt-5 flex flex-col gap-6">
          {loading ? (
            <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
              Loading saved receipts...
            </div>
          ) : null}

          {!loading && sections.length === 0 ? (
            <EmptyState
              title="No receipts match these filters"
              description="Try a different date range, merchant, category, or search term."
            />
          ) : null}

          {sections.map((section) => (
            <ReceiptSectionBlock
              key={section.key}
              section={section}
              viewMode={viewMode}
            />
          ))}
        </section>
      </section>

      <AppNav />
    </main>
  );
}

function ReceiptSectionBlock({
  section,
  viewMode,
}: {
  section: ReceiptSection;
  viewMode: ReceiptViewMode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{section.title}</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {section.items.length} receipt{section.items.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {viewMode === "gallery" ? (
        <div className="grid grid-cols-3 gap-3">
          {section.items.map((item) => (
            <GalleryReceiptCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {section.items.map((item) => (
            <ListReceiptCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function GalleryReceiptCard({ item }: { item: ReceiptListItem }) {
  return (
    <Link
      href={`/receipts/${item.id}`}
      className="glass-panel overflow-hidden rounded-[24px] transition hover:-translate-y-0.5"
    >
      <div className="aspect-[0.78] overflow-hidden bg-[var(--surface-soft)]">
        {item.signed_image_url ? (
          <img
            src={item.signed_image_url}
            alt={item.merchant_name ?? "Receipt image"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-[var(--text-muted)]">
            No image
          </div>
        )}
      </div>

      <div className="space-y-2 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
            {renderMerchantLabel(item)}
          </p>
          <StatusPill compact status={resolveDisplayStatus(item)} />
        </div>
        <p className="truncate text-xs text-[var(--text-secondary)]">
          {item.total_amount != null
            ? formatCurrency(item.total_amount, normalizeCurrency(item.currency))
            : item.status === "processing"
              ? "Extracting..."
              : "Unknown"}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {formatReceiptDate(item.receipt_date, item.created_at)}
        </p>
      </div>
    </Link>
  );
}

function ListReceiptCard({ item }: { item: ReceiptListItem }) {
  return (
    <Link
      href={`/receipts/${item.id}`}
      className="glass-panel overflow-hidden rounded-[24px] transition hover:-translate-y-0.5"
    >
      <div className="grid grid-cols-[80px_1fr] gap-3 p-3">
        <div className="overflow-hidden rounded-[18px] bg-[var(--surface-soft)]">
          {item.signed_image_url ? (
            <img
              src={item.signed_image_url}
              alt={item.merchant_name ?? "Receipt image"}
              className="h-full min-h-[80px] w-full object-cover"
            />
          ) : (
            <div className="flex min-h-[80px] items-center justify-center px-2 text-center text-[11px] text-[var(--text-muted)]">
              No image
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {renderMerchantLabel(item)}
              </p>
              <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                {item.category ?? item.folder_name ?? "Unsorted"}
              </p>
              {showReceiptDebug && item.extraction_error ? (
                <p className="mt-1 text-[11px] text-[var(--danger)]">{item.extraction_error}</p>
              ) : null}
            </div>
            <StatusPill compact status={resolveDisplayStatus(item)} />
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Date
              </p>
              <p className="mt-1 text-xs text-[var(--text-primary)]">
                {formatReceiptDate(item.receipt_date, item.created_at)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Amount
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--accent-strong)]">
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

function buildReceiptSections(items: ReceiptListItem[]) {
  const grouped = new Map<string, ReceiptSection>();

  items.forEach((item) => {
    const sectionMeta = getSectionMeta(item);
    const existing = grouped.get(sectionMeta.key);

    if (existing) {
      existing.items.push(item);
      return;
    }

    grouped.set(sectionMeta.key, {
      items: [item],
      key: sectionMeta.key,
      title: sectionMeta.title,
    });
  });

  return [...grouped.values()];
}

function getSectionMeta(item: ReceiptListItem) {
  const now = new Date();
  const date = new Date(getEffectiveDateValue(item));
  const startOfThisWeek = getStartOfWeek(now);
  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (date >= startOfThisWeek) {
    return { key: "this-week", title: "This week" };
  }

  if (date >= startOfLastWeek && date < startOfThisWeek) {
    return { key: "last-week", title: "Last week" };
  }

  if (date >= startOfThisMonth) {
    return { key: "this-month", title: "This month" };
  }

  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    title: new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
    }).format(date),
  };
}

function getStartOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + diff);
  return next;
}

function getEffectiveDateValue(item: ReceiptListItem) {
  return item.receipt_date ?? item.created_at.slice(0, 10);
}

function getReceiptTimestamp(item: ReceiptListItem) {
  return new Date(item.receipt_date ?? item.created_at).getTime();
}

function StatusPill({ status, compact = false }: { status: string; compact?: boolean }) {
  const className =
    status === "done"
      ? "bg-[var(--success-bg)] text-[var(--accent-strong)]"
      : status === "partially read"
        ? "warning-card text-[var(--warning)]"
        : status === "failed"
          ? "danger-card"
          : "bg-[var(--surface-soft)] text-[var(--text-secondary)]";

  return (
    <span
      className={`rounded-full px-3 py-1 uppercase tracking-[0.14em] ${compact ? "text-[10px]" : "text-[11px]"} ${className}`}
    >
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
    <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--card-soft)] p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-[var(--text-primary)]">{value}</p>
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
        className="field-control w-full rounded-2xl px-4 py-3 text-sm outline-none"
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
        className="field-control w-full rounded-2xl px-4 py-3 text-sm outline-none"
      />
    </label>
  );
}
