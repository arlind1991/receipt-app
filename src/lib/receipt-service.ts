import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  FolderRow,
  ReceiptDetail,
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
  const stub = buildStubReceipt();

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
    status: "uploaded",
    merchant_name: stub.merchant_name,
    receipt_date: stub.receipt_date,
    total_amount: stub.total_amount,
    vat_amount: stub.vat_amount,
    category: stub.category,
    raw_ocr_text: stub.raw_ocr_text,
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
      "id, user_id, folder_id, image_path, status, merchant_name, receipt_date, total_amount, vat_amount, category, raw_ocr_text, created_at, updated_at, folders(name)",
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
      "id, user_id, folder_id, image_path, status, merchant_name, receipt_date, total_amount, vat_amount, category, raw_ocr_text, created_at, updated_at, folders(name)",
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

function buildStubReceipt() {
  const now = new Date();

  return {
    merchant_name: "Pending OCR",
    receipt_date: now.toISOString().slice(0, 10),
    total_amount: 0,
    vat_amount: 0,
    category: "Uncategorized",
    raw_ocr_text:
      "OCR not implemented yet. This placeholder row was created immediately after upload.",
  };
}

function buildReceiptImagePath(userId: string, receiptId: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `${userId}/${year}/${month}/receipt-${receiptId}.jpg`;
}
