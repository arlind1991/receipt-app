type ConfidenceLevel = "low" | "medium" | "high" | null;
type StructuredReceiptFields = {
  category: string | null;
  currency: string | null;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
};
type ParsedReceiptPayload = StructuredReceiptFields & {
  notes: string | null;
  field_confidence: {
    merchant: ConfidenceLevel;
    receipt_date: ConfidenceLevel;
    total_amount: ConfidenceLevel;
  };
  raw_ocr_text: string;
};
type OpenAiStageDebug = {
  assistant_text: string;
  empty_reason: string | null;
  image_input_sent: boolean;
  model: string;
  raw_response_body: string;
  request_shape: string;
  response_field_read: string;
  response_empty: boolean;
};
type HeuristicDebug = {
  candidate_merchant_line: string | null;
  candidate_receipt_date_line: string | null;
  candidate_receipt_time_line: string | null;
  candidate_total_line: string | null;
  candidate_vat_line: string | null;
  receipt_time: string | null;
};
type ReceiptProcessingOutput = ParsedReceiptPayload & {
  debug: {
    extracted_fields: string[];
    failure_stage: "none" | "ocr" | "structured" | "final";
    handwriting_detected: boolean;
    handwriting_stage: OpenAiStageDebug;
    heuristic_debug: HeuristicDebug;
    image_download_succeeded: boolean;
    ocr_text_returned: boolean;
    ocr_stage: OpenAiStageDebug;
    preprocessing: {
      contrast_enhanced: boolean;
      crop_applied: boolean;
      detected_receipt_count: number;
      grayscale_applied: boolean;
      sharpen_applied: boolean;
      shadow_reduction_applied: boolean;
      straighten_applied: boolean;
      trim_applied: boolean;
    } | null;
    printed_text_stage: OpenAiStageDebug;
    structured_json_returned: boolean;
    structured_stage: OpenAiStageDebug;
  };
  failure_reason: string | null;
  is_partial: boolean;
  parsed_json_text: string | null;
  should_fail: boolean;
};

const openAiApiKey = process.env.OPENAI_API_KEY;
const OCR_MODEL = "gpt-4o-mini";
const STRUCTURED_MODEL = "gpt-4o-mini";
const HANDWRITING_MODEL = "gpt-4o-mini";

export const receiptOcrEnvError = !openAiApiKey
  ? "Set OPENAI_API_KEY to enable receipt OCR processing."
  : null;

export function getReceiptOcrModels() {
  return { handwritingModel: HANDWRITING_MODEL, ocrModel: OCR_MODEL, structuredModel: STRUCTURED_MODEL };
}

export async function extractReceiptDataFromImage(params: {
  contentType: string;
  imageBuffer: Buffer;
  imageDownloadSucceeded?: boolean;
  originalContentType?: string;
  originalImageBuffer?: Buffer;
  preprocessing?: ReceiptProcessingOutput["debug"]["preprocessing"];
}) {
  const debug: ReceiptProcessingOutput["debug"] = {
    extracted_fields: [],
    failure_stage: "none",
    handwriting_detected: false,
    handwriting_stage: emptyStageDebug(HANDWRITING_MODEL, true),
    heuristic_debug: emptyHeuristicDebug(),
    image_download_succeeded: params.imageDownloadSucceeded ?? true,
    ocr_text_returned: false,
    ocr_stage: emptyStageDebug(OCR_MODEL, true),
    preprocessing: params.preprocessing ?? null,
    printed_text_stage: emptyStageDebug(OCR_MODEL, true),
    structured_json_returned: false,
    structured_stage: emptyStageDebug(STRUCTURED_MODEL, false),
  };

  if (receiptOcrEnvError) {
    return { ok: false as const, error: receiptOcrEnvError, data: buildFailureOutput(debug, receiptOcrEnvError) };
  }

  const printed = await extractPrintedReceiptTextFromImage({ contentType: params.contentType, imageBuffer: params.imageBuffer });
  debug.printed_text_stage = printed.debug;
  debug.ocr_stage = printed.debug;
  debug.ocr_text_returned = printed.debug.assistant_text.trim().length > 0;
  const rawText = normalizeRawText(printed.ok ? printed.data : printed.debug.assistant_text);

  let structuredFields = emptyStructuredFields();
  let parsedJsonText: string | null = null;
  let structuredError: string | null = null;
  if (rawText) {
    const structured = await extractStructuredFieldsFromOcrText(rawText);
    debug.structured_stage = structured.debug;
    parsedJsonText = structured.debug.assistant_text || null;
    if (structured.ok) {
      debug.structured_json_returned = true;
      structuredFields = structured.data;
    } else {
      structuredError = structured.error;
      debug.failure_stage = "structured";
    }
  } else {
    debug.failure_stage = "ocr";
  }

  const heuristic = applyReceiptHeuristics(rawText, structuredFields);
  debug.heuristic_debug = heuristic.debug;
  const originalBuffer = params.originalImageBuffer ?? params.imageBuffer;
  const originalType = params.originalContentType ?? params.contentType;
  const handwriting = await extractHandwrittenNotesFromImage({ contentType: originalType, imageBuffer: originalBuffer, printedText: rawText });
  debug.handwriting_stage = handwriting.debug;
  debug.handwriting_detected = Boolean(handwriting.ok && handwriting.data);
  const confidence = scoreFieldConfidence(rawText, heuristic.debug, structuredFields, heuristic.fields);
  debug.extracted_fields = listExtractedFields(rawText, heuristic.fields, handwriting.ok ? handwriting.data : null);

  const shouldFail = rawText.length === 0 && debug.extracted_fields.length === 0;
  const failureReason = shouldFail ? (printed.ok ? "No usable OCR text or extracted fields were recovered." : printed.error) : structuredError;
  if (shouldFail) debug.failure_stage = "final";

  return {
    ok: true as const,
    data: {
      ...heuristic.fields,
      notes: handwriting.ok ? handwriting.data : null,
      field_confidence: {
        merchant: confidence.merchant,
        receipt_date: confidence.receipt_date,
        total_amount: confidence.total_amount,
      },
      raw_ocr_text: rawText,
      debug,
      failure_reason: failureReason,
      is_partial: rawText.length > 0 && debug.extracted_fields.length < 10,
      parsed_json_text: parsedJsonText,
      should_fail: shouldFail,
    } satisfies ReceiptProcessingOutput,
  };
}

function emptyStageDebug(model: string, imageInputSent: boolean): OpenAiStageDebug {
  return { assistant_text: "", empty_reason: null, image_input_sent: imageInputSent, model, raw_response_body: "", request_shape: "", response_field_read: "output_text/output[*].content[*].text", response_empty: false };
}
function emptyHeuristicDebug(): HeuristicDebug {
  return { candidate_merchant_line: null, candidate_receipt_date_line: null, candidate_receipt_time_line: null, candidate_total_line: null, candidate_vat_line: null, receipt_time: null };
}

async function extractPrintedReceiptTextFromImage(params: { contentType: string; imageBuffer: Buffer }) {
  const prompt = "Layer 1 OCR. Transcribe printed receipt text exactly as shown. Preserve line breaks. Ignore handwriting and annotations. Return plain text only.";
  return requestImageText({ contentType: params.contentType, imageBuffer: params.imageBuffer, model: OCR_MODEL, prompt });
}

async function extractHandwrittenNotesFromImage(params: { contentType: string; imageBuffer: Buffer; printedText: string }) {
  const prompt = "Extract only handwritten notes, pen marks, or handwritten annotations from this receipt image. Ignore printed text. Return empty text if there is no handwriting.";
  const attempt = await requestImageText({ contentType: params.contentType, imageBuffer: params.imageBuffer, model: HANDWRITING_MODEL, prompt });
  const normalized = normalizeHandwrittenNotes(attempt.debug.assistant_text, params.printedText);
  return { ok: true as const, data: normalized, debug: { ...attempt.debug, assistant_text: normalized ?? "" } };
}

async function requestImageText(params: { contentType: string; imageBuffer: Buffer; model: string; prompt: string }) {
  const imageDataUrl = `data:${params.contentType};base64,${params.imageBuffer.toString("base64")}`;
  const payload = {
    model: params.model,
    input: [
      { role: "system", content: [{ type: "input_text", text: params.prompt }] },
      { role: "user", content: [{ type: "input_text", text: params.prompt }, { type: "input_image", image_url: imageDataUrl, detail: "high" }] },
    ],
    max_output_tokens: 2400,
  };
  const requestShape = JSON.stringify({ model: payload.model, input: [{ role: "system" }, { role: "user", content: [{ type: "input_text" }, { type: "input_image", image_url: "[data-url]", detail: "high" }] }], max_output_tokens: payload.max_output_tokens });
  const attempt = await sendOpenAiRequest(payload, { imageInputSent: true, model: params.model, requestShape });
  if (!attempt.ok || !attempt.debug.assistant_text.trim()) {
    return { ok: false as const, error: attempt.debug.empty_reason ?? "OpenAI image transcription returned an empty response.", debug: attempt.debug };
  }
  return { ok: true as const, data: normalizeRawText(attempt.debug.assistant_text), debug: attempt.debug };
}

async function extractStructuredFieldsFromOcrText(rawText: string) {
  const payload = {
    model: STRUCTURED_MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: "Layer 2 parsing. Parse printed receipt OCR text into structured fields. Use null when uncertain. receipt_date must be YYYY-MM-DD. total_amount and vat_amount must be numbers. currency must be a 3-letter ISO code when known." }] },
      { role: "user", content: [{ type: "input_text", text: `Parse this printed receipt OCR text into structured data:\n\n${rawText}` }] },
    ],
    text: { format: { type: "json_schema", name: "receipt_text_parse", schema: { type: "object", additionalProperties: false, properties: { merchant_name: { type: ["string", "null"] }, receipt_date: { type: ["string", "null"] }, total_amount: { type: ["number", "null"] }, vat_amount: { type: ["number", "null"] }, currency: { type: ["string", "null"] }, category: { type: ["string", "null"] } }, required: ["merchant_name", "receipt_date", "total_amount", "vat_amount", "currency", "category"] } } },
    max_output_tokens: 800,
  };
  const requestShape = JSON.stringify({ model: payload.model, input: [{ role: "system" }, { role: "user", content: [{ type: "input_text", text: "[printed-ocr-text]" }] }], text: { format: { type: "json_schema", name: "receipt_text_parse" } }, max_output_tokens: payload.max_output_tokens });
  const attempt = await sendOpenAiRequest(payload, { imageInputSent: false, model: STRUCTURED_MODEL, requestShape });
  if (!attempt.ok || !attempt.debug.assistant_text.trim()) {
    return { ok: false as const, error: attempt.debug.empty_reason ?? "OpenAI structured extraction returned an empty response.", debug: attempt.debug };
  }
  try {
    return { ok: true as const, data: sanitizeStructuredFields(JSON.parse(attempt.debug.assistant_text) as StructuredReceiptFields), debug: attempt.debug };
  } catch {
    return { ok: false as const, error: `OpenAI structured extraction returned malformed JSON: ${attempt.debug.assistant_text.slice(0, 400)}`, debug: { ...attempt.debug, empty_reason: "Structured response was non-empty but JSON parsing failed." } };
  }
}

async function sendOpenAiRequest(payload: object, meta: { imageInputSent: boolean; model: string; requestShape: string }) {
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openAiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const rawResponseBody = await response.text();
  const extracted = extractAssistantText(safeParseJson(rawResponseBody));
  return {
    ok: response.ok,
    debug: { assistant_text: extracted.text, empty_reason: extracted.emptyReason, image_input_sent: meta.imageInputSent, model: meta.model, raw_response_body: rawResponseBody, request_shape: meta.requestShape, response_field_read: extracted.source, response_empty: extracted.text.trim().length === 0 } satisfies OpenAiStageDebug,
  };
}

function extractAssistantText(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") return { emptyReason: "Response body was not valid JSON.", source: "none", text: "" };
  const candidate = responseJson as { output?: Array<{ content?: Array<{ text?: string }> }>; output_text?: string };
  if (candidate.output_text?.trim()) return { emptyReason: null, source: "output_text", text: candidate.output_text.trim() };
  const parts = candidate.output?.flatMap((item) => item.content ?? []).map((part) => part.text?.trim() ?? "").filter(Boolean) ?? [];
  if (parts.length) return { emptyReason: null, source: "output[*].content[*].text", text: parts.join("\n").trim() };
  return { emptyReason: "No text was present in output_text or output[*].content[*].text.", source: "output_text/output[*].content[*].text", text: "" };
}
function safeParseJson(value: string) { try { return JSON.parse(value) as unknown; } catch { return null; } }

function applyReceiptHeuristics(rawText: string, fields: StructuredReceiptFields) {
  const merged = { ...fields };
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const merchantCandidate = scoreMerchantCandidate(lines);
  const totalCandidate = findAmountCandidate(rawText, ["TOTAL", "GRAND TOTAL", "AMOUNT PAID", "CARD PAYMENT", "BALANCE DUE", "TO PAY"]);
  const vatCandidate = findAmountCandidate(rawText, ["VAT", "TAX", "VAT AMOUNT", "VAT @"]);
  const dateCandidate = findDateCandidate(lines);
  const timeCandidate = findTimeCandidate(lines);
  if (!merged.merchant_name) merged.merchant_name = merchantCandidate.value;
  if (merged.total_amount == null) merged.total_amount = totalCandidate.amount;
  if (merged.vat_amount == null) merged.vat_amount = vatCandidate.amount;
  if (!merged.currency) merged.currency = inferCurrency(rawText);
  if (!merged.receipt_date) merged.receipt_date = dateCandidate.date;
  merged.category = resolveReceiptCategory({ aiCategory: merged.category, merchantName: merged.merchant_name });
  return { debug: { candidate_merchant_line: merchantCandidate.line, candidate_receipt_date_line: dateCandidate.line, candidate_receipt_time_line: timeCandidate.line, candidate_total_line: totalCandidate.line, candidate_vat_line: vatCandidate.line, receipt_time: timeCandidate.time }, fields: merged };
}

function scoreFieldConfidence(
  rawText: string,
  heuristicDebug: HeuristicDebug,
  structuredFields: StructuredReceiptFields,
  merged: StructuredReceiptFields,
): {
  merchant: ConfidenceLevel;
  receipt_date: ConfidenceLevel;
  total_amount: ConfidenceLevel;
} {
  const merchant = !merged.merchant_name ? null : heuristicDebug.candidate_merchant_line?.toLowerCase() === merged.merchant_name.toLowerCase() && structuredFields.merchant_name ? "high" : structuredFields.merchant_name ? "medium" : "low";
  const receipt_date = !merged.receipt_date ? null : containsKeyword(heuristicDebug.candidate_receipt_date_line ?? "", ["date", "transaction date", "receipt date", "issued"]) ? "high" : structuredFields.receipt_date ? "medium" : "low";
  const totalLine = heuristicDebug.candidate_total_line ?? "";
  const total_amount = merged.total_amount == null ? null : containsKeyword(totalLine, ["grand total", "amount paid", "balance due", "to pay"]) || (containsKeyword(totalLine, ["total"]) && !containsKeyword(totalLine, ["subtotal"])) ? "high" : structuredFields.total_amount != null && rawText.toLowerCase().includes("total") ? "medium" : "low";
  return { merchant, receipt_date, total_amount };
}

function sanitizeStructuredFields(result: StructuredReceiptFields) {
  return { merchant_name: normalizeNullableString(result.merchant_name), receipt_date: normalizeDate(result.receipt_date), total_amount: normalizeNullableNumber(result.total_amount), vat_amount: normalizeNullableNumber(result.vat_amount), currency: normalizeCurrency(result.currency), category: normalizeNullableString(result.category) };
}
function normalizeHandwrittenNotes(value: string, printedText: string) {
  const printedLines = new Set(printedText.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean));
  const noteLines = normalizeRawText(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => !printedLines.has(line.toLowerCase()) && !/^none$/i.test(line) && !/^no handwriting$/i.test(line));
  return noteLines.length ? noteLines.join("\n") : null;
}
function extractBestAmountFromLine(line: string) {
  const matches = [...line.matchAll(/(?:£|\$|€)?\s?(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2}))/g)];
  return matches.length ? normalizeNumberString(matches[matches.length - 1]?.[1] ?? "") : null;
}
function inferCurrency(rawText: string) { if (rawText.includes("£") || /\bGBP\b/i.test(rawText)) return "GBP"; if (rawText.includes("$") || /\bUSD\b/i.test(rawText)) return "USD"; if (rawText.includes("€") || /\bEUR\b/i.test(rawText)) return "EUR"; return null; }
function resolveReceiptCategory(params: { aiCategory: string | null; merchantName: string | null }) {
  const name = params.merchantName?.toLowerCase() ?? "";
  if (containsKeyword(name, ["tesco", "sainsbury", "aldi", "lidl", "waitrose", "morrisons", "asda", "market", "grocer"])) return "Groceries";
  if (containsKeyword(name, ["uber", "train", "rail", "air", "airport", "hotel", "travel", "flight", "taxi"])) return "Travel";
  if (containsKeyword(name, ["cafe", "coffee", "restaurant", "pizza", "burger", "bar", "kitchen", "grill"])) return "Dining";
  if (containsKeyword(name, ["shell", "bp", "esso", "fuel", "petrol", "diesel"])) return "Fuel";
  if (containsKeyword(name, ["boots", "pharmacy", "clinic", "dentist", "optician", "health"])) return "Healthcare";
  if (containsKeyword(name, ["amazon", "shop", "store", "ikea", "argos", "retail", "fashion"])) return "Shopping";
  return normalizeNullableString(params.aiCategory);
}
function containsKeyword(value: string, keywords: string[]) { const normalized = value.toLowerCase(); return keywords.some((keyword) => normalized.includes(keyword.toLowerCase())); }
function scoreMerchantCandidate(lines: string[]) {
  const candidates = lines.slice(0, 8).map((line, index) => { let score = 0; const letters = (line.match(/[A-Za-z]/g) ?? []).length; const digits = (line.match(/\d/g) ?? []).length; if (letters >= 4) score += 3; if (line.length >= 4 && line.length <= 32) score += 2; if (index < 3) score += 2; if (digits === 0) score += 2; if (digits > letters) score -= 3; if (containsKeyword(line, ["vat", "tax", "receipt", "invoice", "tel", "phone"])) score -= 4; if (/\b\d{5,}\b/.test(line) || /@|www\.|\.com/i.test(line)) score -= 2; if (containsKeyword(line, ["road", "street", "avenue", "lane", "postcode"])) score -= 3; return { line, score }; });
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return !best || best.score < 2 ? { line: null, value: null } : { line: best.line, value: best.line.replace(/\s{2,}/g, " ") };
}
function findAmountCandidate(rawText: string, keywords: string[]) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); const lowerHalfStart = Math.floor(lines.length / 2); const candidates: Array<{ amount: number | null; line: string; score: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]; if (!containsKeyword(line, keywords)) continue; const amount = extractBestAmountFromLine(line) ?? extractBestAmountFromLine(lines[index + 1] ?? ""); if (amount == null) continue;
    let score = index >= lowerHalfStart ? 3 : 0; if (containsKeyword(line, ["grand total", "amount paid", "balance due", "to pay"])) score += 4; if (containsKeyword(line, ["total"])) score += 2; if (containsKeyword(line, ["subtotal"])) score -= 4; if (containsKeyword(line, ["vat", "tax"]) && !containsKeyword(line, ["total"])) score -= 3; candidates.push({ amount, line, score });
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return { amount: best?.amount ?? null, line: best?.line ?? null };
}
function findDateCandidate(lines: string[]) { for (const line of lines) if (containsKeyword(line, ["date", "transaction date", "receipt date", "issued"])) { const date = extractDateFromLine(line); if (date) return { date, line }; } for (const line of lines) { const date = extractDateFromLine(line); if (date) return { date, line }; } return { date: null, line: null }; }
function findTimeCandidate(lines: string[]) { for (const line of lines) { const time = extractTimeFromLine(line); if (time) return { line, time }; } return { line: null, time: null }; }
function extractDateFromLine(line: string) {
  for (const pattern of [/\b(\d{4}-\d{2}-\d{2})\b/, /\b(\d{2}[/-]\d{2}[/-]\d{4})\b/, /\b(\d{2}\.\d{2}\.\d{4})\b/, /\b(\d{2}[/-]\d{2}[/-]\d{2})\b/, /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/]) {
    const candidate = line.match(pattern)?.[1]; if (!candidate) continue; const normalized = normalizeDateCandidate(candidate); if (normalized) return normalized;
  }
  return null;
}
function extractTimeFromLine(line: string) { return line.match(/\b(\d{2}:\d{2}:\d{2})\b/)?.[1] ?? line.match(/\b(\d{2}:\d{2})\b/)?.[1] ?? line.match(/\b(\d{1,2}:\d{2}\s?(?:AM|PM))\b/i)?.[1] ?? null; }
function listExtractedFields(rawText: string, fields: StructuredReceiptFields, notes: string | null) { const extracted: string[] = []; if (rawText) extracted.push("raw_ocr_text"); if (notes) extracted.push("notes"); if (fields.merchant_name) extracted.push("merchant_name"); if (fields.receipt_date) extracted.push("receipt_date"); if (fields.total_amount != null) extracted.push("total_amount"); if (fields.vat_amount != null) extracted.push("vat_amount"); if (fields.currency) extracted.push("currency"); if (fields.category) extracted.push("category"); return extracted; }
function buildFailureOutput(debug: ReceiptProcessingOutput["debug"], failureReason: string): ReceiptProcessingOutput { return { ...emptyStructuredFields(), notes: null, field_confidence: { merchant: null, receipt_date: null, total_amount: null }, raw_ocr_text: "", debug, failure_reason: failureReason, is_partial: false, parsed_json_text: null, should_fail: true }; }
function emptyStructuredFields(): StructuredReceiptFields { return { merchant_name: null, receipt_date: null, total_amount: null, vat_amount: null, currency: null, category: null }; }
function normalizeNullableString(value: string | null) { const trimmed = value?.trim(); return trimmed ? trimmed : null; }
function normalizeNullableNumber(value: number | null) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function normalizeCurrency(value: string | null) { const trimmed = value?.trim().toUpperCase(); return trimmed && trimmed.length === 3 ? trimmed : null; }
function normalizeDate(value: string | null) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }
function normalizeRawText(value: string) { return value.replace(/\r/g, "").trim(); }
function normalizeNumberString(value: string) { const parsed = Number(value.replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function normalizeDateCandidate(candidate: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  const monthNamed = candidate.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthNamed) { const month = monthNameToNumber(monthNamed[2]); return month ? `${monthNamed[3]}-${month}-${monthNamed[1].padStart(2, "0")}` : null; }
  const parts = candidate.includes(".") ? candidate.split(".") : candidate.split(/[/-]/); if (parts.length !== 3) return null;
  const [first, second, third] = parts; if (third.length === 4) return `${third}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`; if (third.length === 2) return `20${third}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`; return null;
}
function monthNameToNumber(monthName: string) { return ({ jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" } as Record<string, string>)[monthName.slice(0, 3).toLowerCase()] ?? null; }
