const LAST_USED_FOLDER_KEY = "snapreceipt:last-folder-id";
const THEME_PREFERENCE_KEY = "snapreceipt:theme-preference";
const RECEIPT_VIEW_MODE_KEY = "snapreceipt:receipt-view-mode";

export type ThemePreference = "system" | "light" | "dark";
export type ReceiptViewMode = "list" | "gallery";

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
