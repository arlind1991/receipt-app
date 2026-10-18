import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import sharp from "sharp";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import {
  looksLikeRefusal,
  type OpenAiStageDebug,
  type ReceiptProcessingOutput,
} from "@/lib/receipt-ocr";

// Reads a receipt photo with Claude Haiku 5.5 in a single call: detection (is
// it a receipt, how many, is it readable), transcription and field extraction,
// returned as structured output. Returns the same shape as the OpenAI reader so
// the process route can use either (RECEIPT_OCR_PROVIDER).

export const CLAUDE_RECEIPT_MODEL = "claude-haiku-5-5";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;

export const claudeReceiptOcrEnvError = !anthropicApiKey
  ? "Set ANTHROPIC_API_KEY to enable receipt reading with Claude."
  : null;

// Haiku 5.5 is in the high-resolution vision tier: images up to 2576px on the
// long edge are read without downscaling, which matters for small receipt print.
const MAX_IMAGE_EDGE = 2576;
const REQUEST_TIMEOUT_MS = 60_000;

const client = anthropicApiKey
  ? new Anthropic({ apiKey: anthropicApiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })
  : null;

const CONFIDENCE = { type: "string", enum: ["high", "medium", "low"] } as const;

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_receipt: { type: "boolean" },
    receipt_count: { type: "integer" },
    readable: { type: "boolean" },
    problem: { anyOf: [{ type: "string" }, { type: "null" }] },
    transcription: { type: "string" },
    merchant_name: { anyOf: [{ type: "string" }, { type: "null" }] },
    receipt_date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    total_amount: { anyOf: [{ type: "number" }, { type: "null" }] },
    vat_amount: { anyOf: [{ type: "number" }, { type: "null" }] },
    currency: { anyOf: [{ type: "string" }, { type: "null" }] },
    category: {
      anyOf: [
        { type: "string", enum: EXPENSE_CATEGORIES },
        { type: "null" },
      ],
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        merchant_name: CONFIDENCE,
        receipt_date: CONFIDENCE,
        total_amount: CONFIDENCE,
        vat_amount: CONFIDENCE,
        currency: CONFIDENCE,
      },
      required: ["merchant_name", "receipt_date", "total_amount", "vat_amount", "currency"],
    },
  },
  required: [
    "is_receipt",
    "receipt_count",
    "readable",
    "problem",
    "transcription",
    "merchant_name",
    "receipt_date",
    "total_amount",
    "vat_amount",
    "currency",
    "category",
    "confidence",
  ],
} as const;

function buildSystemPrompt(today: string) {
  return `You read photos of shop receipts and invoices for an expense tracker used by a UK business. Today's date is ${today}.

Decide first whether the photo shows a receipt or invoice, how many separate receipts are visible, and whether the main one is legible enough to read the total. If it isn't a receipt, or the text is too blurred, cut off or dark to read the total, set is_receipt or readable to false, explain why in "problem" in one short sentence for the user, and leave the fields null.

If several receipts are in the photo, read the one that is most fully visible and nearest the centre, and report how many you can see in receipt_count.

transcription: the printed text of that receipt, line by line, as plain text. Leave out handwriting.

Fields - read only what is printed; never guess or calculate:
- merchant_name: the shop or business name as printed in the header (for example "B&Q" or "Waitrose & Partners"), not the address or the card processor.
- receipt_date: the transaction date as YYYY-MM-DD. Many receipts print it only once, in small text at the very bottom next to the time and till number, so check there. UK receipts write dates day first (05/10/2026 is 5 October 2026); a two-digit year 26 means 2026. Ignore other dates such as "refund available until". A receipt can't be dated after today. Null if no date is printed.
- total_amount: the final amount paid including VAT (TOTAL, BALANCE DUE, Invoice Total, amount charged to the card), not a subtotal, as a positive number.
- vat_amount: the VAT amount only when it is printed as a money amount (for example in a VAT summary). Null if not printed. Never use a VAT registration number or a VAT rate.
- currency: ISO 4217 code from the symbol or text (£ is GBP). Null if nothing indicates it.
- category: the HMRC Self Assessment expense category that best fits what was bought (for example fuel, parking and train fares are "Car, van and travel expenses"; materials, plants and supplies used on jobs are "Costs of goods bought for resale or goods used"; tool or equipment repairs are "Repairs and maintenance of property and equipment"). Use "Other business expenses" when nothing else fits.
- confidence: per field, "high" only when every character is sharp and fully visible; "medium" when it's legible but slightly faint, creased or inferred from layout; "low" when any digit is blurred, faded, cut off at the edge of the photo, or could be read two ways. Still give your best reading of a low-confidence field. Use "high" for a field that is correctly null because it isn't printed.`;
}

type ClaudeReceiptResult = {
  is_receipt: boolean;
  receipt_count: number;
  readable: boolean;
  problem: string | null;
  transcription: string;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  currency: string | null;
  category: string | null;
  confidence: Record<
    "merchant_name" | "receipt_date" | "total_amount" | "vat_amount" | "currency",
    "high" | "medium" | "low"
  >;
};

export type ClaudeReceiptOptions = {
  effort?: "low" | "medium" | "high";
  today?: string;
};

// The image should already be decodable by sharp (HEIC converted to JPEG first).
export async function extractReceiptDataWithClaude(params: {
  imageBuffer: Buffer;
  options?: ClaudeReceiptOptions;
}) {
  const effort = params.options?.effort ?? "low";
  const today = params.options?.today ?? new Date().toISOString().slice(0, 10);
  const stage = emptyStage();
  stage.request_shape = JSON.stringify({
    model: CLAUDE_RECEIPT_MODEL,
    output_config: { effort, format: "json_schema" },
    messages: [{ role: "user", content: [{ type: "image" }, { type: "text" }] }],
  });

  if (!client) {
    const reason = claudeReceiptOcrEnvError!;
    return { ok: false as const, error: reason, data: failure(stage, reason) };
  }

  const image = await sharp(params.imageBuffer, { failOn: "none" })
    .rotate()
    .resize({ fit: "inside", height: MAX_IMAGE_EDGE, width: MAX_IMAGE_EDGE, withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  let response: Awaited<ReturnType<typeof client.messages.parse>>;
  try {
    response = await client.messages.parse({
      model: CLAUDE_RECEIPT_MODEL,
      max_tokens: 8000,
      system: buildSystemPrompt(today),
      output_config: {
        effort,
        format: jsonSchemaOutputFormat(RECEIPT_SCHEMA, { transform: false }),
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") },
            },
            { type: "text", text: "Read this receipt photo." },
          ],
        },
      ],
    });
  } catch (error) {
    const reason = describeClaudeError(error);
    stage.empty_reason = reason;
    return { ok: true as const, data: failure(stage, reason) };
  }

  stage.raw_response_body = JSON.stringify({
    id: response.id,
    stop_reason: response.stop_reason,
    usage: response.usage,
  });

  // Check stop_reason before reading content: a refusal or a cut-off response
  // may not match the schema.
  if (response.stop_reason === "refusal") {
    const reason =
      "This photo couldn't be read. Retake it showing just the receipt, flat and in good light.";
    stage.empty_reason = `Refused (${response.stop_details?.category ?? "no category"}).`;
    return { ok: true as const, data: failure(stage, reason) };
  }
  if (response.stop_reason === "max_tokens") {
    const reason = "Reading the receipt was cut off. Try again.";
    stage.empty_reason = "Hit max_tokens before the structured output finished.";
    return { ok: true as const, data: failure(stage, reason) };
  }

  const parsed = response.parsed_output as ClaudeReceiptResult | null;
  if (!parsed) {
    const reason = "Claude returned an unreadable response. Try again.";
    stage.empty_reason = "parsed_output was null.";
    return { ok: true as const, data: failure(stage, reason) };
  }

  const transcription = (parsed.transcription ?? "").replace(/\r/g, "").trim();
  stage.assistant_text = JSON.stringify(parsed);
  stage.response_empty = false;

  if (!parsed.is_receipt) {
    const reason = `This doesn't look like a receipt${parsed.problem ? `: ${trimSentence(parsed.problem)}` : "."}`;
    return { ok: true as const, data: failure(stage, reason, transcription) };
  }
  if (!parsed.readable || looksLikeRefusal(transcription)) {
    const reason = `The receipt couldn't be read${parsed.problem ? `: ${trimSentence(parsed.problem)}` : "."} Retake it closer, flat and in good light.`;
    return { ok: true as const, data: failure(stage, reason, transcription) };
  }

  const fields = {
    merchant_name: cleanText(parsed.merchant_name),
    receipt_date: cleanDate(parsed.receipt_date, today),
    total_amount: cleanAmount(parsed.total_amount),
    vat_amount: cleanAmount(parsed.vat_amount),
    currency: cleanCurrency(parsed.currency),
    category: cleanText(parsed.category),
  };
  // VAT can't exceed the total; drop it rather than store an impossible value.
  if (fields.vat_amount != null && fields.total_amount != null && fields.vat_amount > fields.total_amount) {
    fields.vat_amount = null;
  }

  const lowConfidence = (["merchant_name", "receipt_date", "total_amount"] as const).filter(
    (field) => fields[field] != null && parsed.confidence[field] === "low",
  );
  const missing = (["merchant_name", "receipt_date", "total_amount"] as const).filter(
    (field) => fields[field] == null,
  );
  const extracted = [
    transcription ? "raw_ocr_text" : null,
    ...Object.entries(fields).filter(([, value]) => value != null).map(([key]) => key),
  ].filter((value): value is string => Boolean(value));

  const notes =
    parsed.receipt_count > 1
      ? `${parsed.receipt_count} receipts were in the photo; this one was read. Photograph the others separately.`
      : null;

  return {
    ok: true as const,
    data: {
      ...fields,
      notes: null,
      field_confidence: {
        merchant: fields.merchant_name ? parsed.confidence.merchant_name : null,
        receipt_date: fields.receipt_date ? parsed.confidence.receipt_date : null,
        total_amount: fields.total_amount != null ? parsed.confidence.total_amount : null,
      },
      raw_ocr_text: transcription,
      debug: {
        extracted_fields: extracted,
        failure_stage: "none",
        heuristic_debug: {
          candidate_merchant_line: null,
          candidate_receipt_date_line: null,
          candidate_receipt_time_line: null,
          candidate_total_line: null,
          candidate_vat_line: null,
          receipt_time: null,
        },
        image_download_succeeded: true,
        ocr_text_returned: transcription.length > 0,
        ocr_stage: stage,
        preprocessing: null,
        printed_text_stage: stage,
        structured_json_returned: true,
        structured_stage: stage,
      },
      failure_reason: notes,
      // Partial when a field the user needs is missing or Claude was unsure of it.
      is_partial: missing.length > 0 || lowConfidence.length > 0,
      parsed_json_text: JSON.stringify({ ...parsed, transcription: undefined }),
      should_fail: false,
    } satisfies ReceiptProcessingOutput,
  };
}

function describeClaudeError(error: unknown) {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "Claude took too long to read the receipt. Try again.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach Claude. Check the connection and try again.";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Claude rate limit reached. Try again in a minute.";
  }
  if (error instanceof Anthropic.APIError) {
    if (error.type === "billing_error") {
      return "Anthropic account is out of credits, so receipts can't be read. Add credits in the Claude Console (Billing), then try again.";
    }
    if (error.type === "overloaded_error") {
      return "Claude is busy right now. Try again in a minute.";
    }
    return `Claude request failed (HTTP ${error.status ?? "?"}): ${error.message}`;
  }
  return `Claude request failed: ${error instanceof Error ? error.message : String(error)}`;
}

function emptyStage(): OpenAiStageDebug {
  return {
    assistant_text: "",
    empty_reason: null,
    image_input_sent: true,
    model: CLAUDE_RECEIPT_MODEL,
    raw_response_body: "",
    request_shape: "",
    response_field_read: "parsed_output",
    response_empty: true,
  };
}

function failure(stage: OpenAiStageDebug, reason: string, transcription = ""): ReceiptProcessingOutput {
  return {
    category: null,
    currency: null,
    merchant_name: null,
    receipt_date: null,
    total_amount: null,
    vat_amount: null,
    notes: null,
    field_confidence: { merchant: null, receipt_date: null, total_amount: null },
    raw_ocr_text: transcription,
    debug: {
      extracted_fields: [],
      failure_stage: "final",
      heuristic_debug: {
        candidate_merchant_line: null,
        candidate_receipt_date_line: null,
        candidate_receipt_time_line: null,
        candidate_total_line: null,
        candidate_vat_line: null,
        receipt_time: null,
      },
      image_download_succeeded: true,
      ocr_text_returned: transcription.length > 0,
      ocr_stage: stage,
      preprocessing: null,
      printed_text_stage: stage,
      structured_json_returned: false,
      structured_stage: stage,
    },
    failure_reason: reason,
    is_partial: false,
    parsed_json_text: null,
    should_fail: true,
  };
}

function trimSentence(value: string) {
  return value.trim().replace(/\.+$/, "") + ".";
}

function cleanText(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function cleanAmount(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

function cleanCurrency(value: string | null) {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

function cleanDate(value: string | null, today: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  // Allow a day of slack for time zones; anything later is a misread.
  const latest = new Date(`${today}T00:00:00Z`).getTime() + 86_400_000;
  return parsed.getTime() <= latest ? value : null;
}
