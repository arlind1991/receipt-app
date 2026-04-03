import { NextRequest, NextResponse } from "next/server";
import { extractReceiptDataFromImage } from "@/lib/receipt-ocr";
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

export async function POST(request: NextRequest, context: RouteContext) {
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
    .select("id, user_id, image_path, status")
    .eq("id", id)
    .eq("user_id", authResult.data.id)
    .single<{ id: string; user_id: string; image_path: string; status: string }>();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  if (receipt.status === "done") {
    return NextResponse.json({ ok: true, status: "done" });
  }

  const { data: image, error: downloadError } = await supabase.storage
    .from("receipts")
    .download(receipt.image_path);

  console.info("[receipt-processing]", {
    image_download_succeeded: !downloadError && !!image,
    receiptId: receipt.id,
    userId: authResult.data.id,
  });

  if (downloadError || !image) {
    await markReceiptFailed(
      supabase,
      receipt.id,
      downloadError?.message ?? "Receipt image could not be loaded.",
    );
    return NextResponse.json(
      { error: downloadError?.message ?? "Receipt image could not be loaded." },
      { status: 500 },
    );
  }

  const arrayBuffer = await image.arrayBuffer();
  const extractionResult = await extractReceiptDataFromImage({
    contentType: image.type || "image/jpeg",
    imageBuffer: Buffer.from(arrayBuffer),
    imageDownloadSucceeded: true,
  });

  if (!extractionResult.ok) {
    await markReceiptFailed(supabase, receipt.id, extractionResult.error);
    return NextResponse.json({ error: extractionResult.error }, { status: 500 });
  }

  console.info("[receipt-processing]", {
    extracted_fields: extractionResult.data.debug.extracted_fields,
    failure_reason: extractionResult.data.failure_reason,
    ocr_text_returned: extractionResult.data.debug.ocr_text_returned,
    receiptId: receipt.id,
    structured_json_returned: extractionResult.data.debug.structured_json_returned,
  });

  const nextStatus = extractionResult.data.should_fail ? "failed" : "done";

  const { error: updateError } = await supabase
    .from("receipts")
    .update({
      merchant_name: extractionResult.data.merchant_name,
      receipt_date: extractionResult.data.receipt_date,
      total_amount: extractionResult.data.total_amount,
      vat_amount: extractionResult.data.vat_amount,
      currency: extractionResult.data.currency,
      category: extractionResult.data.category,
      raw_ocr_text: extractionResult.data.raw_ocr_text || null,
      parsed_ocr_json: extractionResult.data.debug.parsed_json,
      extraction_error:
        extractionResult.data.should_fail || extractionResult.data.is_partial
          ? extractionResult.data.failure_reason ?? extractionResult.data.debug.extraction_error
          : extractionResult.data.debug.extraction_error,
      status: nextStatus,
    })
    .eq("id", receipt.id)
    .eq("user_id", authResult.data.id);

  if (updateError) {
    await markReceiptFailed(supabase, receipt.id, updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    partial: extractionResult.data.is_partial,
    status: nextStatus,
  });
}

async function markReceiptFailed(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  receiptId: string,
  reason: string,
) {
  console.warn("[receipt-processing]", {
    failure_reason: reason,
    receiptId,
  });
  await supabase
    .from("receipts")
    .update({ extraction_error: reason, status: "failed" })
    .eq("id", receiptId);
}
