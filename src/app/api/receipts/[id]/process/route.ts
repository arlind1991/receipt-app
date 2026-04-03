import { NextRequest, NextResponse } from "next/server";
import {
  extractReceiptDataFromImage,
  getReceiptOcrModels,
} from "@/lib/receipt-ocr";
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

  const { ocrModel, structuredModel } = getReceiptOcrModels();
  console.info("[receipt-processing:start]", {
    image_path: receipt.image_path,
    models: { ocrModel, structuredModel },
    receipt_id: receipt.id,
  });

  const { data: image, error: downloadError } = await supabase.storage
    .from("receipts")
    .download(receipt.image_path);

  if (downloadError || !image) {
    const reason = downloadError?.message ?? "Receipt image could not be loaded.";
    console.warn("[receipt-processing:image]", {
      image_download_success: false,
      image_path: receipt.image_path,
      receipt_id: receipt.id,
      reason,
    });
    await markReceiptFailed(supabase, receipt.id, reason);
    return NextResponse.json({ error: reason }, { status: 500 });
  }

  const arrayBuffer = await image.arrayBuffer();
  console.info("[receipt-processing:image]", {
    byte_size: arrayBuffer.byteLength,
    content_type: image.type || "image/jpeg",
    image_download_success: true,
    image_path: receipt.image_path,
    receipt_id: receipt.id,
  });

  const extractionResult = await extractReceiptDataFromImage({
    contentType: image.type || "image/jpeg",
    imageBuffer: Buffer.from(arrayBuffer),
    imageDownloadSucceeded: true,
  });

  if (!extractionResult.ok) {
    console.warn("[receipt-processing:exception]", {
      failure_reason: extractionResult.error,
      receipt_id: receipt.id,
    });
    await markReceiptFailed(supabase, receipt.id, extractionResult.error);
    return NextResponse.json({ error: extractionResult.error }, { status: 500 });
  }

  console.info("[receipt-processing:openai]", {
    final_extracted_fields: extractionResult.data.debug.extracted_fields,
    models: {
      ocr: extractionResult.data.debug.ocr_stage.model,
      structured: extractionResult.data.debug.structured_stage.model,
    },
    ocr_empty_reason: extractionResult.data.debug.ocr_stage.empty_reason,
    ocr_request_image_input_sent: extractionResult.data.debug.ocr_stage.image_input_sent,
    ocr_request_shape: extractionResult.data.debug.ocr_stage.request_shape,
    ocr_response_field_read: extractionResult.data.debug.ocr_stage.response_field_read,
    ocr_response_empty: extractionResult.data.debug.ocr_stage.response_empty,
    ocr_text_returned: extractionResult.data.debug.ocr_text_returned,
    raw_ocr_response_text: extractionResult.data.debug.ocr_stage.assistant_text.slice(0, 1500),
    receipt_id: receipt.id,
    structured_empty_reason: extractionResult.data.debug.structured_stage.empty_reason,
    structured_request_shape: extractionResult.data.debug.structured_stage.request_shape,
    structured_response_field_read:
      extractionResult.data.debug.structured_stage.response_field_read,
    structured_json_returned: extractionResult.data.debug.structured_json_returned,
    structured_raw_assistant_content:
      extractionResult.data.debug.structured_stage.assistant_text.slice(0, 1500),
  });

  const nextStatus = extractionResult.data.should_fail ? "failed" : "done";
  const extractionError =
    extractionResult.data.failure_reason ??
    (extractionResult.data.is_partial
      ? "Structured extraction was incomplete; saved partial OCR results."
      : null);
  const parsedDebugJson = JSON.stringify(
    {
      extracted_fields: extractionResult.data.debug.extracted_fields,
      heuristic_debug: extractionResult.data.debug.heuristic_debug,
      ocr_stage: extractionResult.data.debug.ocr_stage,
      structured_stage: extractionResult.data.debug.structured_stage,
      structured_text: extractionResult.data.parsed_json_text,
    },
    null,
    2,
  );

  console.info("[receipt-processing:result]", {
    exact_failure_reason: extractionError,
    extracted_fields: extractionResult.data.debug.extracted_fields,
    final_fields: {
      category: extractionResult.data.category,
      currency: extractionResult.data.currency,
      merchant_name: extractionResult.data.merchant_name,
      receipt_date: extractionResult.data.receipt_date,
      receipt_time: extractionResult.data.debug.heuristic_debug.receipt_time,
      total_amount: extractionResult.data.total_amount,
      vat_amount: extractionResult.data.vat_amount,
    },
    final_status: nextStatus,
    parsed_json_result: extractionResult.data.parsed_json_text,
    receipt_id: receipt.id,
  });

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
      parsed_ocr_json: parsedDebugJson,
      extraction_error: extractionError,
      status: nextStatus,
    })
    .eq("id", receipt.id)
    .eq("user_id", authResult.data.id);

  if (updateError) {
    console.warn("[receipt-processing:update]", {
      receipt_id: receipt.id,
      reason: updateError.message,
    });
    await markReceiptFailed(supabase, receipt.id, updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    debug: {
      image_download_succeeded: extractionResult.data.debug.image_download_succeeded,
      ocr_text_returned: extractionResult.data.debug.ocr_text_returned,
      parsed_json_result: extractionResult.data.parsed_json_text,
      raw_model_response:
        extractionResult.data.debug.structured_stage.assistant_text ||
        extractionResult.data.debug.ocr_stage.assistant_text,
      response_empty:
        extractionResult.data.debug.structured_stage.response_empty &&
        extractionResult.data.debug.ocr_stage.response_empty,
    },
    partial: extractionResult.data.is_partial,
    status: nextStatus,
  });
}

async function markReceiptFailed(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  receiptId: string,
  reason: string,
) {
  console.warn("[receipt-processing:failed]", {
    exact_failure_reason: reason,
    receipt_id: receiptId,
  });
  await supabase
    .from("receipts")
    .update({ extraction_error: reason, status: "failed" })
    .eq("id", receiptId);
}
