"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import { BrandHeader, TabStrip } from "@/components/ui/brand-header";
import { ChevronRightIcon } from "@/components/ui/icons";
import { EXPENSE_CATEGORIES, toExpenseCategory } from "@/lib/categories";
import { fetchReceiptsWithUrls } from "@/lib/receipt-service";
import { ensureBrowserSession } from "@/lib/supabase/session";
import type { ReceiptListItem } from "@/lib/types";
import { formatCurrency, normalizeCurrency } from "@/lib/utils";

type ReportTab = "categories" | "tags";

const UNCATEGORISED = "Uncategorised";

export function ReportsScreen() {
  const [receipts, setReceipts] = useState<ReceiptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReportTab>("categories");
  const [taxYear, setTaxYear] = useState(() => taxYearOf(todayIso()));
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const user = await ensureBrowserSession();
      if (!user) {
        setError("You need to sign in to see reports.");
        setLoading(false);
        return;
      }
      const result = await fetchReceiptsWithUrls(user.id);
      if (result.ok) {
        setReceipts(result.data.filter((item) => item.status !== "processing" && item.status !== "uploading"));
      } else {
        setError(result.error);
      }
      setLoading(false);
    })();
  }, []);

  // The current tax year and the one before, plus any older year with receipts.
  const taxYears = useMemo(() => {
    const current = taxYearOf(todayIso());
    const years = new Set([current, current - 1]);
    for (const item of receipts) {
      years.add(taxYearOf(receiptDay(item)));
    }
    return [...years].sort((left, right) => right - left).slice(0, 4);
  }, [receipts]);

  const inYear = useMemo(
    () =>
      receipts.filter(
        (item) =>
          taxYearOf(receiptDay(item)) === taxYear &&
          item.total_amount != null &&
          normalizeCurrency(item.currency) === "GBP",
      ),
    [receipts, taxYear],
  );

  const yearTotal = inYear.reduce((sum, item) => sum + Number(item.total_amount), 0);

  const categoryGroups = useMemo(() => {
    const groups = new Map<string, ReceiptListItem[]>(EXPENSE_CATEGORIES.map((name) => [name, []]));
    for (const item of inYear) {
      const name = toExpenseCategory(item.category) ?? UNCATEGORISED;
      groups.set(name, [...(groups.get(name) ?? []), item]);
    }
    return [...groups.entries()]
      .filter(([name, items]) => name !== UNCATEGORISED || items.length > 0)
      .map(([name, items]) => ({ items, name, total: sum(items) }));
  }, [inYear]);

  const tagGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: ReceiptListItem[] }>();
    for (const item of inYear) {
      const tag = item.notes?.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const group = groups.get(key) ?? { items: [], label: tag };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => ({ items: group.items, name: group.label, total: sum(group.items) }))
      .sort((left, right) => right.total - left.total);
  }, [inYear]);

  const groups = tab === "categories" ? categoryGroups : tagGroups;

  return (
    <main className="tab-screen">
      <BrandHeader title="Reports">
        <div className="mx-auto flex max-w-md gap-3 overflow-x-auto px-6 pt-1">
          {taxYears.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => {
                setTaxYear(year);
                setOpenGroup(null);
              }}
              className={`min-w-[7.5rem] flex-1 border-b-[3px] pb-2 text-lg font-bold transition ${
                year === taxYear ? "border-white text-white" : "border-white/30 text-white/55"
              }`}
            >
              {formatTaxYear(year)}
            </button>
          ))}
        </div>
        <div className="mx-auto max-w-md px-6 pt-5 pb-7">
          <p className="text-[1.45rem] leading-snug font-bold">
            Your {formatTaxYear(taxYear)} expenses total is {formatCurrency(yearTotal, "GBP")}
          </p>
          <p className="mt-2 text-sm font-semibold text-white/80">
            {inYear.length} receipt{inYear.length === 1 ? "" : "s"} · tax year 6 April {taxYear} to 5 April{" "}
            {taxYear + 1}
          </p>
        </div>
        <TabStrip
          value={tab}
          onChange={(next) => {
            setTab(next);
            setOpenGroup(null);
          }}
          tabs={[
            { label: "Tax categories", value: "categories" },
            { label: "Tags", value: "tags" },
          ]}
        />
      </BrandHeader>

      <section className="mx-auto w-full max-w-md">
        {error ? (
          <div className="p-4">
            <StatusBanner tone="error" message={error} />
          </div>
        ) : null}

        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-[var(--text-secondary)]">Loading...</p>
        ) : null}

        {!loading && tab === "tags" && tagGroups.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <p className="text-lg text-[var(--text-secondary)]">No tags in this tax year yet</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Add a tag to a receipt (for example a client or job name) to see totals per tag here.
            </p>
          </div>
        ) : null}

        {!loading ? (
          <div className="divide-y divide-[var(--border-soft)]">
            {groups.map((group) => {
              const open = openGroup === group.name;
              return (
                <div key={group.name} className="bg-[var(--surface)]">
                  <button
                    type="button"
                    onClick={() => setOpenGroup(open ? null : group.name)}
                    disabled={group.items.length === 0}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left transition enabled:hover:bg-[var(--nav-hover)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.05rem] leading-snug text-[var(--text-strong)]">
                        {group.name}
                      </span>
                      <span className="mt-1 block text-lg font-semibold text-[var(--pink)]">
                        {formatCurrency(group.total, "GBP")}
                      </span>
                    </span>
                    <ChevronRightIcon
                      className={`h-5 w-5 shrink-0 text-[var(--text-muted)] transition ${open ? "rotate-90" : ""}`}
                    />
                  </button>
                  {open ? (
                    <div className="border-t border-[var(--border-soft)] bg-[var(--surface-soft)]">
                      {group.items
                        .sort((left, right) => receiptDay(right).localeCompare(receiptDay(left)))
                        .map((item) => (
                          <Link
                            key={item.id}
                            href={`/receipts/${item.id}`}
                            className="flex items-baseline justify-between gap-3 px-5 py-3 text-sm hover:bg-[var(--nav-hover)]"
                          >
                            <span className="min-w-0 truncate text-[var(--text-primary)]">
                              {new Date(`${receiptDay(item)}T00:00:00`).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}{" "}
                              · {item.merchant_name ?? "Unknown supplier"}
                            </span>
                            <span className="shrink-0 font-semibold">
                              {formatCurrency(item.total_amount, "GBP")}
                            </span>
                          </Link>
                        ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {!loading && receipts.some((item) => normalizeCurrency(item.currency) !== "GBP") ? (
          <p className="px-5 py-4 text-xs text-[var(--text-muted)]">
            Receipts in other currencies aren&apos;t included in these totals.
          </p>
        ) : null}
      </section>

      <AppNav />
    </main>
  );
}

function sum(items: ReceiptListItem[]) {
  return items.reduce((total, item) => total + Number(item.total_amount ?? 0), 0);
}

function receiptDay(item: ReceiptListItem) {
  return (item.receipt_date ?? item.created_at).slice(0, 10);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// UK tax years run 6 April to 5 April; returns the starting calendar year.
function taxYearOf(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return month > 4 || (month === 4 && day >= 6) ? year : year - 1;
}

function formatTaxYear(startYear: number) {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
