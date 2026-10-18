"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { StatusBanner } from "@/components/status-banner";
import { BrandHeader, TabStrip } from "@/components/ui/brand-header";
import { CameraIcon } from "@/components/ui/icons";
import { toExpenseCategory } from "@/lib/categories";
import {
  getReceiptProcessingQueue,
  removeReceiptProcessingQueueItem,
  updateReceiptProcessingQueueItem,
} from "@/lib/local-storage";
import {
  fetchReceiptDetail,
  fetchReceiptsWithUrls,
  triggerReceiptProcessing,
} from "@/lib/receipt-service";
import { ensureBrowserSession, supabaseEnvError } from "@/lib/supabase/session";
import { formatCurrency, normalizeCurrency } from "@/lib/utils";
import type { ReceiptListItem, ReceiptProcessingQueueItem } from "@/lib/types";

type ReceiptsTab = "recent" | "all" | "processing";

type ReceiptLoadResult =
  | { ok: true; data: { items: ReceiptListItem[]; userId: string } }
  | { ok: false; error: string };

type ProcessingListItem =
  | { kind: "queue"; item: ReceiptProcessingQueueItem }
  | { kind: "remote"; item: ReceiptListItem };

const PROCESSING_POLL_MS = 1100;

export function ReceiptsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ReceiptListItem[]>([]);
  const [queueItems, setQueueItems] = useState<ReceiptProcessingQueueItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReceiptsTab>("all");
  const queueWorkerReceiptIdRef = useRef<string | null>(null);

  async function fetchReceipts(): Promise<ReceiptLoadResult> {
    if (supabaseEnvError) {
      return { ok: false, error: supabaseEnvError };
    }

    const user = await ensureBrowserSession();
    if (!user) {
      return {
        ok: false,
        error: "You need to sign in to view receipts.",
      };
    }

    const result = await fetchReceiptsWithUrls(user.id);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      data: {
        items: result.data,
        userId: user.id,
      },
    };
  }

  function syncQueue(userId: string | null) {
    setQueueItems(getReceiptProcessingQueue(userId ?? undefined));
  }

  async function runReceiptLoad(showSpinner = true) {
    if (showSpinner) {
      setLoading(true);
    }
    setStatusMessage(null);

    const result = await fetchReceipts();
    if (!result.ok) {
      setStatusMessage(result.error);
      setLoading(false);
      return;
    }

    setCurrentUserId(result.data.userId);
    setItems(result.data.items);
    syncQueue(result.data.userId);
    setLoading(false);
  }

  const loadReceipts = useEffectEvent(async (showSpinner = true) => {
    await runReceiptLoad(showSpinner);
  });

  const refreshQueue = useEffectEvent(() => {
    syncQueue(currentUserId);
  });

  useEffect(() => {
    void loadReceipts();
  }, []);

  useEffect(() => {
    const nextTab = normalizeReceiptsTab(searchParams.get("tab"));
    setActiveTab((current) => (current === nextTab ? current : nextTab));
  }, [searchParams]);

  useEffect(() => {
    const handleStorage = () => {
      refreshQueue();
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  async function handleRefresh() {
    await runReceiptLoad();
  }

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => getReceiptTimestamp(right) - getReceiptTimestamp(left)),
    [items],
  );

  const processingReceipts = useMemo(
    () => sortedItems.filter((item) => isProcessingStatus(item.status)),
    [sortedItems],
  );

  const allItems = useMemo(
    () => sortedItems.filter((item) => isCompletedOrNeedsReviewStatus(item.status)),
    [sortedItems],
  );

  const processingListItems = useMemo(() => {
    const queuedIds = new Set(queueItems.map((item) => item.receipt_id));
    const merged: ProcessingListItem[] = [
      ...queueItems.map((item) => ({ kind: "queue" as const, item })),
      ...processingReceipts
        .filter((item) => !queuedIds.has(item.id))
        .map((item) => ({ kind: "remote" as const, item })),
    ];

    return merged.sort((left, right) => {
      const rightTimestamp =
        right.kind === "queue"
          ? new Date(right.item.created_at).getTime()
          : getReceiptTimestamp(right.item);
      const leftTimestamp =
        left.kind === "queue"
          ? new Date(left.item.created_at).getTime()
          : getReceiptTimestamp(left.item);
      return rightTimestamp - leftTimestamp;
    });
  }, [processingReceipts, queueItems]);


  useEffect(() => {
    if (queueItems.length === 0 && processingReceipts.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadReceipts(false);
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [processingReceipts.length, queueItems.length]);

  useEffect(() => {
    if (queueItems.length === 0 || items.length === 0) {
      return;
    }

    const completedReceiptIds = new Set(
      items.filter((item) => item.status !== "processing").map((item) => item.id),
    );
    let removedAny = false;

    for (const item of queueItems) {
      if (completedReceiptIds.has(item.receipt_id)) {
        removeReceiptProcessingQueueItem(item.receipt_id);
        removedAny = true;
      }
    }

    if (removedAny) {
      refreshQueue();
    }
  }, [items, queueItems]);

  const processNextQueueItem = useEffectEvent(async () => {
    if (queueWorkerReceiptIdRef.current) {
      return;
    }

    const nextItem = queueItems.find((item) => item.state !== "needs_review");
    if (!nextItem) {
      return;
    }

    const user = await ensureBrowserSession();
    if (!user) {
      return;
    }

    queueWorkerReceiptIdRef.current = nextItem.receipt_id;
    updateReceiptProcessingQueueItem(nextItem.receipt_id, (item) => ({
      ...item,
      state: "processing",
      status_text: "Processing",
    }));
    refreshQueue();

    try {
      const triggerResult = await triggerReceiptProcessing(nextItem.receipt_id);
      if (!triggerResult.ok) {
        updateReceiptProcessingQueueItem(nextItem.receipt_id, (item) => ({
          ...item,
          state: "needs_review",
          status_text: "Needs review",
        }));
        await loadReceipts(false);
        removeReceiptProcessingQueueItem(nextItem.receipt_id);
        refreshQueue();
        return;
      }

      updateReceiptProcessingQueueItem(nextItem.receipt_id, (item) => ({
        ...item,
        state: "extracting",
        status_text: "Extracting details",
      }));
      refreshQueue();

      while (true) {
        const detailResult = await fetchReceiptDetail(nextItem.receipt_id, user.id);
        if (!detailResult.ok) {
          throw new Error(detailResult.error);
        }

        if (detailResult.data.status !== "processing") {
          removeReceiptProcessingQueueItem(nextItem.receipt_id);
          refreshQueue();
          await loadReceipts(false);
          return;
        }

        await wait(PROCESSING_POLL_MS);
      }
    } catch {
      updateReceiptProcessingQueueItem(nextItem.receipt_id, (item) => ({
        ...item,
        state: "needs_review",
        status_text: "Needs review",
      }));
      refreshQueue();
    } finally {
      queueWorkerReceiptIdRef.current = null;
    }
  });

  useEffect(() => {
    if (queueItems.length === 0) {
      return;
    }

    void processNextQueueItem();
  }, [queueItems]);

  const processingCount = processingListItems.length;
  const monthSummary = useMemo(() => summarizeThisMonth(allItems), [allItems]);
  const allGroups = useMemo(() => groupByDay(allItems), [allItems]);
  const recentByAdded = useMemo(
    () =>
      [...allItems]
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, 15),
    [allItems],
  );

  return (
    <main className="tab-screen">
      <BrandHeader
        left={
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="rounded-full px-1 py-1 text-sm font-semibold text-white/90 hover:text-white"
          >
            Refresh
          </button>
        }
        right={
          <Link href="/camera" aria-label="Scan a receipt" className="text-white/95 hover:text-white">
            <CameraIcon className="h-7 w-7" />
          </Link>
        }
      >
        <div className="mx-auto max-w-md px-6 pt-2 pb-7 text-center">
          <p className="text-sm font-bold tracking-[0.08em] text-[var(--brand-ink)] uppercase">
            Spent this month
          </p>
          <p className="mt-1 text-[2.6rem] leading-tight font-extrabold">
            {formatCurrency(monthSummary.total, "GBP")}
          </p>
          <p className="text-sm font-semibold text-white/85">
            {monthSummary.count} receipt{monthSummary.count === 1 ? "" : "s"}
            {monthSummary.otherCurrencies ? " · other currencies not included" : ""}
          </p>
        </div>
        <TabStrip
          value={activeTab}
          onChange={(tab) => handleTabChange(tab, router, setActiveTab)}
          tabs={[
            { label: "Recent", value: "recent" },
            { label: "All", value: "all" },
            { badge: processingCount || undefined, label: "Processing", value: "processing" },
          ]}
        />
      </BrandHeader>

      <section className="mx-auto w-full max-w-md">
        {statusMessage ? (
          <div className="p-4">
            <StatusBanner tone="error" message={statusMessage} />
          </div>
        ) : null}

        {loading && activeTab !== "processing" ? (
          <p className="px-6 py-10 text-center text-sm text-[var(--text-secondary)]">Loading receipts...</p>
        ) : null}

        {!loading && activeTab === "processing" && processingCount === 0 ? (
          <EmptyList text="Nothing is being read right now. Receipts you scan appear here until they're done." />
        ) : null}

        {!loading && activeTab !== "processing" && allItems.length === 0 ? (
          <EmptyList text="Start saving by scanning your receipts & invoices" />
        ) : null}

        {activeTab === "processing" && processingCount > 0 ? (
          <div className="divide-y divide-[var(--border-soft)] bg-[var(--surface)]">
            {processingListItems.map((item) =>
              item.kind === "queue" ? (
                <ProcessingQueueRow key={item.item.receipt_id} item={item.item} />
              ) : (
                <ProcessingRemoteRow key={item.item.id} item={item.item} />
              ),
            )}
          </div>
        ) : null}

        {activeTab === "all" && !loading
          ? allGroups.map((group) => (
              <section key={group.key}>
                <h2 className="sticky top-0 z-10 flex justify-between bg-[var(--app-bg)] px-4 pt-4 pb-2 text-xs font-bold tracking-[0.06em] text-[var(--text-secondary)] uppercase">
                  <span>{group.label}</span>
                  <span className="tracking-normal normal-case">{formatCurrency(group.total, "GBP")}</span>
                </h2>
                <div className="divide-y divide-[var(--border-soft)] bg-[var(--surface)]">
                  {group.items.map((item) => (
                    <ExpenseRow key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))
          : null}

        {activeTab === "recent" && !loading && recentByAdded.length > 0 ? (
          <div className="mt-3 divide-y divide-[var(--border-soft)] bg-[var(--surface)]">
            {recentByAdded.map((item) => (
              <ExpenseRow key={item.id} item={item} showAdded />
            ))}
          </div>
        ) : null}
      </section>

      <AppNav />
    </main>
  );
}

function EmptyList({ text }: { text: string }) {
  return (
    <p className="mx-auto max-w-xs px-6 py-16 text-center text-xl leading-snug font-bold text-[var(--brand-strong)]">
      {text}
    </p>
  );
}

function ExpenseRow({ item, showAdded = false }: { item: ReceiptListItem; showAdded?: boolean }) {
  const needsReview = buildRowStatus(item) === "Needs review";
  const category = toExpenseCategory(item.category);
  const day = new Date(`${(item.receipt_date ?? item.created_at).slice(0, 10)}T00:00:00`);

  return (
    <Link
      href={`/receipts/${item.id}`}
      className="flex items-center gap-4 px-4 py-4 transition hover:bg-[var(--nav-hover)]"
    >
      <div className="w-11 shrink-0 text-center text-[var(--text-secondary)]">
        <p className="text-xl leading-none font-semibold">{day.getDate()}</p>
        <p className="mt-1 border-t border-[var(--text-muted)] pt-1 text-[0.68rem] font-bold tracking-wide uppercase">
          {day.toLocaleDateString("en-GB", { month: "short" })}
        </p>
      </div>
      <div className="min-w-0 flex-1 border-l border-[var(--border-soft)] pl-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[1.05rem] font-bold text-[var(--text-strong)]">
            {item.merchant_name ?? "Unknown supplier"}
          </p>
          <p className="shrink-0 text-[1.05rem] font-bold text-[var(--text-strong)]">
            {item.total_amount != null
              ? formatCurrency(item.total_amount, normalizeCurrency(item.currency))
              : "–"}
          </p>
        </div>
        <p
          className={`mt-1 truncate text-sm ${
            needsReview ? "font-semibold text-[var(--pink)]" : "text-[var(--text-secondary)]"
          }`}
        >
          {needsReview ? "Needs review" : (category ?? "No category")}
        </p>
        {showAdded ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">Added {relativeDay(item.created_at)}</p>
        ) : null}
      </div>
    </Link>
  );
}

function ProcessingQueueRow({ item }: { item: ReceiptProcessingQueueItem }) {
  return (
    <Link
      href={`/receipts/${item.receipt_id}`}
      className="flex items-center gap-4 px-4 py-4 transition hover:bg-[var(--nav-hover)]"
    >
      <Thumbnail src={item.thumbnail_data_url} />
      <div className="min-w-0 flex-1">
        <p className="text-[1.02rem] font-bold text-[var(--text-strong)]">Reading receipt...</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.status_text}</p>
      </div>
      <QueueStatusPill state={item.state} />
    </Link>
  );
}

function ProcessingRemoteRow({ item }: { item: ReceiptListItem }) {
  return (
    <Link
      href={`/receipts/${item.id}`}
      className="flex items-center gap-4 px-4 py-4 transition hover:bg-[var(--nav-hover)]"
    >
      <Thumbnail src={item.signed_image_url} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[1.02rem] font-bold text-[var(--text-strong)]">
          {item.merchant_name ?? "Reading receipt..."}
        </p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{buildProcessingStatus(item)}</p>
      </div>
      <QueueStatusPill state="processing" />
    </Link>
  );
}

function Thumbnail({ src }: { src: string | null }) {
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--surface-muted)]">
      {src ? <img src={src} alt="Receipt" className="h-14 w-14 object-cover" /> : null}
    </div>
  );
}

function QueueStatusPill({ state }: { state: ReceiptProcessingQueueItem["state"] }) {
  const review = state === "needs_review";
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-[0.7rem] font-bold tracking-wide uppercase ${
        review ? "bg-[var(--danger-bg)] text-[var(--pink)]" : "bg-[var(--brand-tint)] text-[var(--brand-strong)]"
      }`}
    >
      {state === "extracting" ? "Reading" : review ? "Review" : "Processing"}
    </span>
  );
}

function summarizeThisMonth(items: ReceiptListItem[]) {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let total = 0;
  let count = 0;
  let otherCurrencies = false;
  for (const item of items) {
    const date = item.receipt_date ?? item.created_at.slice(0, 10);
    if (!date.startsWith(monthPrefix)) continue;
    count += 1;
    if (item.total_amount == null) continue;
    if (normalizeCurrency(item.currency) === "GBP") total += Number(item.total_amount);
    else otherCurrencies = true;
  }
  return { count, otherCurrencies, total };
}

// Groups receipts (already newest first) by receipt date, with a heading per day.
function groupByDay(items: ReceiptListItem[]) {
  const groups: Array<{ items: ReceiptListItem[]; key: string; label: string; total: number }> = [];
  for (const item of items) {
    const key = (item.receipt_date ?? item.created_at).slice(0, 10);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { items: [], key, label: dayLabel(key), total: 0 };
      groups.push(group);
    }
    group.items.push(item);
    if (item.total_amount != null && normalizeCurrency(item.currency) === "GBP") {
      group.total += Number(item.total_amount);
    }
  }
  return groups;
}

function dayLabel(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function relativeDay(timestamp: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(timestamp);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return new Date(timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function handleTabChange(
  tab: ReceiptsTab,
  router: ReturnType<typeof useRouter>,
  setActiveTab: (tab: ReceiptsTab) => void,
) {
  setActiveTab(tab);
  router.replace(`/receipts?tab=${tab}`, { scroll: false });
}

function isProcessingStatus(status: string) {
  return status === "processing" || status === "uploading";
}

function isCompletedOrNeedsReviewStatus(status: string) {
  return status === "done" || status === "completed" || status === "failed" || status === "needs_review";
}

function buildRowStatus(item: ReceiptListItem) {
  if (item.status === "failed" || item.extraction_error || isReceiptIncomplete(item)) {
    return "Needs review";
  }

  return item.notes ? "Tagged" : "Saved";
}

function buildProcessingStatus(item: ReceiptListItem) {
  if (item.extraction_error) {
    return "Needs review";
  }

  if (item.raw_ocr_text) {
    return "Extracting details";
  }

  return "Processing";
}

function isReceiptIncomplete(item: ReceiptListItem) {
  return !item.merchant_name || !item.receipt_date || item.total_amount == null;
}

function getReceiptTimestamp(item: ReceiptListItem) {
  return new Date(item.receipt_date ?? item.created_at).getTime();
}

function normalizeReceiptsTab(value: string | null): ReceiptsTab {
  return value === "recent" || value === "processing" || value === "all" ? value : "all";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
