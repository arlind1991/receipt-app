const LAST_USED_FOLDER_KEY = "snapreceipt:last-folder-id";
const RECEIPT_PROCESSING_QUEUE_KEY = "snapreceipt:receipt-processing-queue";
const THEME_PREFERENCE_KEY = "snapreceipt:theme-preference";
const RECEIPT_VIEW_MODE_KEY = "snapreceipt:receipt-view-mode";

export type ThemePreference = "system" | "light" | "dark";
export type ReceiptViewMode = "list" | "gallery";

type ReceiptProcessingQueueState =
  | "queued"
  | "uploading"
  | "processing"
  | "extracting"
  | "needs_review";

export type ReceiptProcessingQueueItem = {
  created_at: string;
  receipt_id: string;
  state: ReceiptProcessingQueueState;
  status_text: string;
  thumbnail_data_url: string | null;
  user_id: string;
};

export function getLastUsedFolderId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(LAST_USED_FOLDER_KEY);
}

export function setLastUsedFolderId(folderId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!folderId) {
    window.localStorage.removeItem(LAST_USED_FOLDER_KEY);
    return;
  }

  window.localStorage.setItem(LAST_USED_FOLDER_KEY, folderId);
}

export function clearAppLocalState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LAST_USED_FOLDER_KEY);
  window.localStorage.removeItem(RECEIPT_PROCESSING_QUEUE_KEY);
  window.localStorage.removeItem(THEME_PREFERENCE_KEY);
  window.localStorage.removeItem(RECEIPT_VIEW_MODE_KEY);
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const value = window.localStorage.getItem(THEME_PREFERENCE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function setThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(THEME_PREFERENCE_KEY, preference);
}

export function getReceiptViewMode(): ReceiptViewMode {
  if (typeof window === "undefined") {
    return "gallery";
  }

  const value = window.localStorage.getItem(RECEIPT_VIEW_MODE_KEY);
  return value === "list" || value === "gallery" ? value : "gallery";
}

export function setReceiptViewMode(mode: ReceiptViewMode) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RECEIPT_VIEW_MODE_KEY, mode);
}

export function getReceiptProcessingQueue(userId?: string) {
  if (typeof window === "undefined") {
    return [] as ReceiptProcessingQueueItem[];
  }

  try {
    const rawValue = window.localStorage.getItem(RECEIPT_PROCESSING_QUEUE_KEY);
    if (!rawValue) {
      return [] as ReceiptProcessingQueueItem[];
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as ReceiptProcessingQueueItem[];
    }

    const queue = parsed.filter(isReceiptProcessingQueueItem);
    return userId ? queue.filter((item) => item.user_id === userId) : queue;
  } catch {
    return [] as ReceiptProcessingQueueItem[];
  }
}

export function setReceiptProcessingQueue(items: ReceiptProcessingQueueItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(RECEIPT_PROCESSING_QUEUE_KEY, JSON.stringify(items));
}

export function enqueueReceiptProcessingItems(items: ReceiptProcessingQueueItem[]) {
  if (typeof window === "undefined" || items.length === 0) {
    return;
  }

  const existing = getReceiptProcessingQueue();
  const byId = new Map(existing.map((item) => [item.receipt_id, item]));
  for (const item of items) {
    byId.set(item.receipt_id, item);
  }

  setReceiptProcessingQueue([...byId.values()]);
}

export function updateReceiptProcessingQueueItem(
  receiptId: string,
  updater: (item: ReceiptProcessingQueueItem) => ReceiptProcessingQueueItem,
) {
  if (typeof window === "undefined") {
    return;
  }

  const next = getReceiptProcessingQueue().map((item) =>
    item.receipt_id === receiptId ? updater(item) : item,
  );
  setReceiptProcessingQueue(next);
}

export function removeReceiptProcessingQueueItem(receiptId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const next = getReceiptProcessingQueue().filter((item) => item.receipt_id !== receiptId);
  setReceiptProcessingQueue(next);
}

function isReceiptProcessingQueueItem(value: unknown): value is ReceiptProcessingQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReceiptProcessingQueueItem>;
  return (
    typeof candidate.created_at === "string" &&
    typeof candidate.receipt_id === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.status_text === "string" &&
    (candidate.thumbnail_data_url === null || typeof candidate.thumbnail_data_url === "string") &&
    typeof candidate.user_id === "string"
  );
}
