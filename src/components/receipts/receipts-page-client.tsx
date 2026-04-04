"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/empty-state";
import { StatusBanner } from "@/components/status-banner";
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
import { formatCurrency, formatReceiptDate, normalizeCurrency } from "@/lib/utils";
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
  const [activeTab, setActiveTab] = useState<ReceiptsTab>(() =>
    normalizeReceiptsTab(searchParams.get("tab")),
  );
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
    setActiveTab(normalizeReceiptsTab(searchParams.get("tab")));
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
    () => sortedItems.filter((item) => item.status === "processing"),
    [sortedItems],
  );

  const allItems = useMemo(
    () => sortedItems.filter((item) => item.status !== "processing"),
    [sortedItems],
  );

  const recentItems = useMemo(() => allItems.slice(0, 15), [allItems]);

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

  const visibleItems = activeTab === "recent" ? recentItems : allItems;

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
              onClick={() => handleTabChange("recent", router)}
            />
            <ReceiptsTabButton
              active={activeTab === "all"}
              label="All"
              onClick={() => handleTabChange("all", router)}
            />
            <ReceiptsTabButton
              active={activeTab === "processing"}
              label="Processing"
              onClick={() => handleTabChange("processing", router)}
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
                {activeTab === "processing"
                  ? `${processingListItems.length} item${processingListItems.length === 1 ? "" : "s"}`
                  : `${visibleItems.length} item${visibleItems.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          {loading && activeTab !== "processing" ? (
            <div className="soft-card rounded-[28px] p-6 text-sm text-[var(--text-secondary)]">
              Loading receipts...
            </div>
          ) : null}

          {!loading && activeTab === "processing" && processingListItems.length === 0 ? (
            <EmptyState
              title="No receipts are processing"
              description="Receipts being scanned will appear here until extraction finishes."
            />
          ) : null}

          {!loading && activeTab !== "processing" && visibleItems.length === 0 ? (
            <EmptyState
              title="No receipts yet"
              description="Scan your first receipt to start building your expense list."
            />
          ) : null}

          {activeTab === "processing" && processingListItems.length > 0 ? (
            <div className="glass-panel overflow-hidden rounded-[28px]">
              <div className="divide-y divide-[var(--border-soft)]">
                {processingListItems.map((item) =>
                  item.kind === "queue" ? (
                    <ProcessingQueueRow key={item.item.receipt_id} item={item.item} />
                  ) : (
                    <ProcessingRemoteRow key={item.item.id} item={item.item} />
                  ),
                )}
              </div>
            </div>
          ) : null}

          {activeTab !== "processing" && !loading && visibleItems.length > 0 ? (
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

function ProcessingQueueRow({ item }: { item: ReceiptProcessingQueueItem }) {
  return (
    <Link
      href={`/receipts/${item.receipt_id}`}
      className="grid grid-cols-[4.5rem_1fr] gap-4 px-4 py-4 transition hover:bg-[var(--nav-hover)]"
    >
      <div className="overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-[var(--surface-muted)]">
        {item.thumbnail_data_url ? (
          <img
            src={item.thumbnail_data_url}
            alt="Captured receipt"
            className="h-[4.5rem] w-[4.5rem] object-cover"
          />
        ) : (
          <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center text-xs text-[var(--text-muted)]">
            Receipt
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Receipt in progress</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.status_text}</p>
          </div>
          <QueueStatusPill state={item.state} />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {formatReceiptDate(null, item.created_at)}
        </p>
      </div>
    </Link>
  );
}

function ProcessingRemoteRow({ item }: { item: ReceiptListItem }) {
  return (
    <Link
      href={`/receipts/${item.id}`}
      className="grid grid-cols-[4.5rem_1fr] gap-4 px-4 py-4 transition hover:bg-[var(--nav-hover)]"
    >
      <div className="overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-[var(--surface-muted)]">
        {item.signed_image_url ? (
          <img
            src={item.signed_image_url}
            alt="Receipt preview"
            className="h-[4.5rem] w-[4.5rem] object-cover"
          />
        ) : (
          <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center text-xs text-[var(--text-muted)]">
            Receipt
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {item.merchant_name ?? "Receipt in progress"}
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {buildProcessingStatus(item)}
            </p>
          </div>
          <QueueStatusPill state="processing" />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {formatReceiptDate(item.receipt_date, item.created_at)}
        </p>
      </div>
    </Link>
  );
}

function QueueStatusPill({
  state,
}: {
  state: ReceiptProcessingQueueItem["state"];
}) {
  const tone =
    state === "needs_review"
      ? "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300"
      : "border-[var(--border-soft)] bg-[var(--surface-muted)] text-[var(--text-secondary)]";

  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${tone}`}>
      {state === "extracting"
        ? "Extracting"
        : state === "needs_review"
          ? "Review"
          : "Processing"}
    </span>
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
          {item.merchant_name ?? "Unknown merchant"}
        </p>
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
          {item.category ?? item.folder_name ?? "Unsorted"}
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {item.total_amount != null
            ? formatCurrency(item.total_amount, normalizeCurrency(item.currency))
            : "Unknown"}
        </p>
      </div>
    </Link>
  );
}

function handleTabChange(tab: ReceiptsTab, router: ReturnType<typeof useRouter>) {
  router.replace(`/receipts?tab=${tab}`, { scroll: false });
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
