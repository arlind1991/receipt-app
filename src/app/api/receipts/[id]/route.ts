import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUserFromAccessToken,
  getSupabaseAdminClient,
  supabaseServerEnvError,
} from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (supabaseServerEnvError) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Missing session token." }, { status: 401 });
  }

  const authResult = await getAuthenticatedUserFromAccessToken(accessToken);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const payload = (await request.json()) as {
    category?: string | null;
    currency?: string | null;
    folder_id?: string | null;
    merchant_name?: string | null;
    receipt_date?: string | null;
    total_amount?: number | null;
    vat_amount?: number | null;
  };

  const { id } = await context.params;
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const nextFolderId = normalizeFolderId(payload.folder_id);
  if (nextFolderId) {
    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .select("id")
      .eq("id", nextFolderId)
      .eq("user_id", authResult.data.id)
      .maybeSingle<{ id: string }>();

    if (folderError) {
      return NextResponse.json({ error: folderError.message }, { status: 400 });
    }

    if (!folder) {
      return NextResponse.json({ error: "Folder not found." }, { status: 400 });
    }
  }

  const updatePayload = {
    currency: normalizeCurrency(payload.currency),
    folder_id: nextFolderId,
    merchant_name: normalizeText(payload.merchant_name),
    receipt_date: normalizeDate(payload.receipt_date),
    total_amount: normalizeNumber(payload.total_amount),
    vat_amount: normalizeNumber(payload.vat_amount),
    category: normalizeText(payload.category),
    status: "done",
  };

  const { error } = await supabase
    .from("receipts")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", authResult.data.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (supabaseServerEnvError) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Missing session token." }, { status: 401 });
  }

  const authResult = await getAuthenticatedUserFromAccessToken(accessToken);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseServerEnvError }, { status: 500 });
  }

  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .select("id, image_path, processed_ocr_image_path")
    .eq("id", id)
    .eq("user_id", authResult.data.id)
    .single<{ id: string; image_path: string; processed_ocr_image_path: string | null }>();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  const { error: storageError } = await supabase.storage
    .from("receipts")
    .remove([receipt.image_path, receipt.processed_ocr_image_path].filter(Boolean) as string[]);

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("receipts")
    .delete()
    .eq("id", id)
    .eq("user_id", authResult.data.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCurrency(value: string | null | undefined) {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && trimmed.length === 3 ? trimmed : null;
}

function normalizeFolderId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
