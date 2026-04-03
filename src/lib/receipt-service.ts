import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  FolderRow,
  ReceiptDetail,
  ReceiptEditableFields,
  ReceiptInsert,
  ReceiptListItem,
  ReceiptRow,
  Result,
} from "@/lib/types";

type SaveReceiptInput = {
  blob: Blob;
  folderId: string | null;
  userId: string;
};

type ReceiptSelectRow = ReceiptRow & {
  folders: { name: string } | null;
};

export async function fetchFolders(userId: string): Promise<Result<FolderRow[]>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const { data, error } = await supabase
    .from("folders")
    .select("id, user_id, name, created_at")
    .eq("user_id", userId)
    .order("name", { ascending: true })
    .returns<FolderRow[]>();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data ?? [] };
}

export async function createFolder(
  userId: string,
  name: string,
): Promise<Result<FolderRow>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const { data, error } = await supabase
    .from("folders")
    .insert({ name, user_id: userId })
    .select("id, user_id, name, created_at")
    .single<FolderRow>();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data };
}

export async function saveReceipt({
  blob,
  folderId,
  userId,
}: SaveReceiptInput): Promise<Result<{ id: string }>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const receiptId = crypto.randomUUID();
  const imagePath = buildReceiptImagePath(userId, receiptId);

  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(imagePath, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const payload: ReceiptInsert = {
    id: receiptId,
    user_id: userId,
    folder_id: folderId,
    image_path: imagePath,
    status: "processing",
    merchant_name: null,
    receipt_date: null,
    total_amount: null,
    vat_amount: null,
    currency: null,
    category: null,
    raw_ocr_text: null,
    parsed_ocr_json: null,
    extraction_error: null,
  };

  const { error: insertError } = await supabase.from("receipts").insert(payload);

  if (insertError) {
    await supabase.storage.from("receipts").remove([imagePath]);
    return { ok: false, error: insertError.message };
  }

  return { ok: true, data: { id: receiptId } };
}

export async function fetchReceiptsWithUrls(
  userId: string,
): Promise<Result<ReceiptListItem[]>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, user_id, folder_id, image_path, status, merchant_name, receipt_date, total_amount, vat_amount, currency, category, raw_ocr_text, parsed_ocr_json, extraction_error, created_at, updated_at, folders(name)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<ReceiptSelectRow[]>();

  if (error) {
    return { ok: false, error: error.message };
  }

  const receipts = data ?? [];
  const signedUrlMap = await createSignedUrlMap(receipts.map((item) => item.image_path));

  return {
    ok: true,
    data: receipts.map((item) => ({
      ...item,
      folder_name: item.folders?.name ?? null,
      signed_image_url: signedUrlMap[item.image_path] ?? null,
    })),
  };
}

export async function fetchReceiptDetail(
  receiptId: string,
  userId: string,
): Promise<Result<ReceiptDetail>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, user_id, folder_id, image_path, status, merchant_name, receipt_date, total_amount, vat_amount, currency, category, raw_ocr_text, parsed_ocr_json, extraction_error, created_at, updated_at, folders(name)",
    )
    .eq("id", receiptId)
    .eq("user_id", userId)
    .single<ReceiptSelectRow>();

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data: signedUrlData } = await supabase.storage
    .from("receipts")
    .createSignedUrl(data.image_path, 60 * 60);

  return {
    ok: true,
    data: {
      ...data,
      folder_name: data.folders?.name ?? null,
      signed_image_url: signedUrlData?.signedUrl ?? null,
    },
  };
}

export async function triggerReceiptProcessing(receiptId: string): Promise<Result<void>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "You need to sign in before processing receipts." };
  }

  const response = await fetch(`/api/receipts/${receiptId}/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: json?.error ?? "Receipt processing failed.",
    };
  }

  return { ok: true, data: undefined };
}

export async function updateReceiptFields(
  receiptId: string,
  fields: ReceiptEditableFields,
): Promise<Result<void>> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "You need to sign in before editing receipts." };
  }

  const response = await fetch(`/api/receipts/${receiptId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: json?.error ?? "Could not update receipt fields.",
    };
  }

  return { ok: true, data: undefined };
}

export async function deleteReceipt(receiptId: string): Promise<Result<void>> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "You need to sign in before deleting receipts." };
  }

  const response = await fetch(`/api/receipts/${receiptId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: json?.error ?? "Could not delete the receipt.",
    };
  }

  return { ok: true, data: undefined };
}

export async function deleteAllUserReceipts(): Promise<Result<void>> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "You need to sign in before deleting test data." };
  }

  const response = await fetch("/api/dev/receipts", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: json?.error ?? "Could not delete test receipts.",
    };
  }

  return { ok: true, data: undefined };
}

export async function refreshAllAppCaches() {
  if (typeof window === "undefined") {
    return;
  }

  if ("caches" in window) {
    const keys = await window.caches.keys();
    await Promise.all(keys.map((key) => window.caches.delete(key)));
  }

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
  }
}

async function getAccessToken() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ?? null;
}

async function createSignedUrlMap(imagePaths: string[]) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || imagePaths.length === 0) {
    return {} as Record<string, string>;
  }

  const uniquePaths = [...new Set(imagePaths)];
  const { data } = await supabase.storage
    .from("receipts")
    .createSignedUrls(uniquePaths, 60 * 60);

  const map: Record<string, string> = {};
  data?.forEach((item, index) => {
    if (item.signedUrl) {
      map[uniquePaths[index]] = item.signedUrl;
    }
  });

  return map;
}

function buildReceiptImagePath(userId: string, receiptId: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `${userId}/${year}/${month}/receipt-${receiptId}.jpg`;
}
