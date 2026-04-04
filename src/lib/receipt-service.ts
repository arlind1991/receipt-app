import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  DuplicateReceiptCandidate,
  FolderRow,
  ReceiptDetectionResult,
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
    processed_ocr_image_path: null,
    status: "processing",
    merchant_name: null,
    merchant_confidence: null,
    receipt_date: null,
    receipt_date_confidence: null,
    total_amount: null,
    total_amount_confidence: null,
    vat_amount: null,
    currency: null,
    category: null,
    raw_ocr_text: null,
    handwritten_notes: null,
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
      "id, user_id, folder_id, image_path, processed_ocr_image_path, status, merchant_name, merchant_confidence, receipt_date, receipt_date_confidence, total_amount, total_amount_confidence, vat_amount, currency, category, raw_ocr_text, handwritten_notes, parsed_ocr_json, extraction_error, created_at, updated_at, folders(name)",
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

export async function fetchReceiptCount(userId: string): Promise<Result<number>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  const { count, error } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data: count ?? 0 };
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
      "id, user_id, folder_id, image_path, processed_ocr_image_path, status, merchant_name, merchant_confidence, receipt_date, receipt_date_confidence, total_amount, total_amount_confidence, vat_amount, currency, category, raw_ocr_text, handwritten_notes, parsed_ocr_json, extraction_error, created_at, updated_at, folders(name)",
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

export async function analyzeCapturedReceipt(blob: Blob): Promise<Result<ReceiptDetectionResult>> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { ok: false, error: "You need to sign in before scanning receipts." };
  }

  const formData = new FormData();
  formData.append("image", blob, "receipt.jpg");

  const response = await fetch("/api/capture/analyze", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      error: json?.error ?? "Could not analyze the captured image.",
    };
  }

  const json = (await response.json()) as ReceiptDetectionResult;
  return { ok: true, data: json };
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

export async function detectPotentialDuplicates(params: {
  merchantName: string | null;
  receiptDate: string | null;
  receiptId: string;
  totalAmount: number | null;
  userId: string;
}): Promise<Result<DuplicateReceiptCandidate[]>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase environment variables are missing." };
  }

  if (!params.merchantName || !params.receiptDate || params.totalAmount == null) {
    return { ok: true, data: [] };
  }

  const { data, error } = await supabase
    .from("receipts")
    .select("id, merchant_name, receipt_date, total_amount, created_at")
    .eq("user_id", params.userId)
    .eq("receipt_date", params.receiptDate)
    .eq("total_amount", params.totalAmount)
    .neq("id", params.receiptId)
    .returns<
      Array<{
        id: string;
        merchant_name: string | null;
        receipt_date: string | null;
        total_amount: number | null;
        created_at: string;
      }>
    >();

  if (error) {
    return { ok: false, error: error.message };
  }

  const normalizedMerchant = normalizeMerchantForMatch(params.merchantName);
  const duplicates = (data ?? [])
    .map((item) => ({
      ...item,
      similarity: merchantSimilarity(
        normalizedMerchant,
        normalizeMerchantForMatch(item.merchant_name),
      ),
    }))
    .filter((item) => item.similarity >= 0.55)
    .sort((left, right) => right.similarity - left.similarity);

  return { ok: true, data: duplicates };
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

function normalizeMerchantForMatch(value: string | null) {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(ltd|limited|store|shop|uk|inc|llc|co|company|restaurants?|cafe|coffee)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function merchantSimilarity(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  if (union === 0) {
    return 0;
  }

  const jaccard = intersection / union;
  if (left.includes(right) || right.includes(left)) {
    return Math.max(jaccard, 0.7);
  }

  return jaccard;
}
