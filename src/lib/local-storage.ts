const LAST_USED_FOLDER_KEY = "snapreceipt:last-folder-id";

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
