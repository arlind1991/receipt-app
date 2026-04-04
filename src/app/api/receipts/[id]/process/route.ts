import { NextRequest, NextResponse } from "next/server";
import {
  extractReceiptDataFromImage,
  getReceiptOcrModels,
} from "@/lib/receipt-ocr";
import { preprocessReceiptImageForOcr } from "@/lib/receipt-image-processing";
import { isMissingOptionalReceiptColumnError } from "@/lib/receipt-schema";
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

  const { handwritingModel, ocrModel, structuredModel } = getReceiptOcrModels();
  console.info("[receipt-processing:start]", {
    image_path: receipt.image_path,
    models: { handwritingModel, ocrModel, structuredModel },
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

  const originalImageBuffer = Buffer.from(arrayBuffer);
  const originalContentType = image.type || "image/jpeg";
  const preprocessing = await preprocessReceiptImageForOcr({
    contentType: originalContentType,
    imageBuffer: originalImageBuffer,
  });

  if (preprocessing.debug.detected_receipt_count > 1) {
    const reason = "Multiple receipts detected in one image. Scan each receipt separately.";
    await markReceiptFailed(supabase, receipt.id, reason);
    return NextResponse.json({ error: reason }, { status: 409 });
  }

  const processedImagePath = buildProcessedReceiptImagePath(receipt.image_path);
  const { error: processedUploadError } = await supabase.storage
    .from("receipts")
    .upload(processedImagePath, preprocessing.ocrBuffer, {
      contentType: preprocessing.contentType,
      upsert: true,
    });

  if (processedUploadError) {
    console.warn("[receipt-processing:processed-image]", {
      receipt_id: receipt.id,
      reason: processedUploadError.message,
    });
  }

  const extractionResult = await extractReceiptDataFromImage({
    contentType: preprocessing.contentType,
    imageBuffer: preprocessing.ocrBuffer,
    imageDownloadSucceeded: true,
    originalContentType,
    originalImageBuffer,
    preprocessing: preprocessing.debug,
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
      handwriting_notes: extractionResult.data.handwritten_notes,
      heuristic_debug: extractionResult.data.debug.heuristic_debug,
      handwriting_stage: extractionResult.data.debug.handwriting_stage,
      ocr_stage: extractionResult.data.debug.ocr_stage,
      preprocessing: extractionResult.data.debug.preprocessing,
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
      handwritten_notes: extractionResult.data.handwritten_notes,
      merchant_confidence: extractionResult.data.merchant_confidence,
      merchant_name: extractionResult.data.merchant_name,
      receipt_date: extractionResult.data.receipt_date,
      receipt_date_confidence: extractionResult.data.receipt_date_confidence,
      receipt_time: extractionResult.data.debug.heuristic_debug.receipt_time,
      total_amount: extractionResult.data.total_amount,
      total_amount_confidence: extractionResult.data.total_amount_confidence,
      vat_amount: extractionResult.data.vat_amount,
    },
    final_status: nextStatus,
    parsed_json_result: extractionResult.data.parsed_json_text,
    receipt_id: receipt.id,
  });

  const baseUpdate = {
    merchant_name: extractionResult.data.merchant_name,
    merchant_confidence: extractionResult.data.merchant_confidence,
    receipt_date: extractionResult.data.receipt_date,
    receipt_date_confidence: extractionResult.data.receipt_date_confidence,
    total_amount: extractionResult.data.total_amount,
    total_amount_confidence: extractionResult.data.total_amount_confidence,
    vat_amount: extractionResult.data.vat_amount,
    currency: extractionResult.data.currency,
    category: extractionResult.data.category,
    raw_ocr_text: extractionResult.data.raw_ocr_text || null,
    parsed_ocr_json: parsedDebugJson,
    extraction_error: extractionError,
    status: nextStatus,
  };

  const { error: updateError } = await supabase
    .from("receipts")
    .update(baseUpdate)
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

  await updateOptionalReceiptColumn({
    receiptId: receipt.id,
    supabase,
    update: { handwritten_notes: extractionResult.data.handwritten_notes },
    userId: authResult.data.id,
  });

  await updateOptionalReceiptColumn({
    receiptId: receipt.id,
    supabase,
    update: { processed_ocr_image_path: processedUploadError ? null : processedImagePath },
    userId: authResult.data.id,
  });

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

function buildProcessedReceiptImagePath(imagePath: string) {
  return imagePath.replace(/receipt-/, "ocr-processed-");
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

async function updateOptionalReceiptColumn({
  receiptId,
  supabase,
  update,
  userId,
}: {
  receiptId: string;
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
  update: Record<string, string | null>;
  userId: string;
}) {
  const value = Object.values(update)[0];
  if (value === undefined) {
    return;
  }

  const { error } = await supabase
    .from("receipts")
    .update(update)
    .eq("id", receiptId)
    .eq("user_id", userId);

  if (!error || isMissingOptionalReceiptColumnError(error.message)) {
    return;
  }

  console.warn("[receipt-processing:optional-update]", {
    receipt_id: receiptId,
    reason: error.message,
    update,
  });
}
