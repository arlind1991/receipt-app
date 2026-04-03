type StructuredReceiptFields = {
  category: string | null;
  currency: string | null;
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
};

type ParsedReceiptPayload = StructuredReceiptFields & {
  raw_ocr_text: string;
};

type OpenAiStageDebug = {
  assistant_text: string;
  empty_reason: string | null;
  fallback_used?: boolean;
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
    heuristic_debug: HeuristicDebug;
    image_download_succeeded: boolean;
    ocr_text_returned: boolean;
    ocr_stage: OpenAiStageDebug;
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

export const receiptOcrEnvError = !openAiApiKey
  ? "Set OPENAI_API_KEY to enable receipt OCR processing."
  : null;

export function getReceiptOcrModels() {
  return {
    ocrModel: OCR_MODEL,
    structuredModel: STRUCTURED_MODEL,
  };
}

export async function extractReceiptDataFromImage(params: {
  contentType: string;
  imageBuffer: Buffer;
  imageDownloadSucceeded?: boolean;
}) {
  const baseDebug: ReceiptProcessingOutput["debug"] = {
    extracted_fields: [] as string[],
    failure_stage: "none" as ReceiptProcessingOutput["debug"]["failure_stage"],
    heuristic_debug: {
      candidate_merchant_line: null,
      candidate_receipt_date_line: null,
      candidate_receipt_time_line: null,
      candidate_total_line: null,
      candidate_vat_line: null,
      receipt_time: null,
    },
    image_download_succeeded: params.imageDownloadSucceeded ?? true,
    ocr_text_returned: false,
    ocr_stage: {
      assistant_text: "",
      empty_reason: null,
      image_input_sent: true,
      model: OCR_MODEL,
      raw_response_body: "",
      request_shape: "",
      response_field_read: "output_text/output[*].content[*].text",
      response_empty: false,
    },
    structured_json_returned: false,
    structured_stage: {
      assistant_text: "",
      empty_reason: null,
      image_input_sent: false,
      model: STRUCTURED_MODEL,
      raw_response_body: "",
      request_shape: "",
      response_field_read: "output_text/output[*].content[*].text",
      response_empty: false,
    },
  };

  if (receiptOcrEnvError) {
    return {
      ok: false as const,
      error: receiptOcrEnvError,
      data: buildFailureOutput(baseDebug, receiptOcrEnvError),
    };
  }

  const rawOcrResult = await extractRawOcrTextFromImage(params);
  baseDebug.ocr_stage = rawOcrResult.debug;
  baseDebug.ocr_text_returned = rawOcrResult.debug.assistant_text.trim().length > 0;

  const rawText = normalizeRawText(
    rawOcrResult.ok ? rawOcrResult.data : rawOcrResult.debug.assistant_text,
  );

  let structuredFields = emptyStructuredFields();
  let parsedJsonText: string | null = null;
  let structuredError: string | null = null;

  if (rawText.length > 0) {
    const structuredResult = await extractStructuredFieldsFromOcrText(rawText);
    baseDebug.structured_stage = structuredResult.debug;
    parsedJsonText = structuredResult.debug.assistant_text || null;

    if (structuredResult.ok) {
      baseDebug.structured_json_returned = true;
      structuredFields = structuredResult.data;
    } else {
      structuredError = structuredResult.error;
      baseDebug.failure_stage = "structured";
    }
  } else {
    baseDebug.failure_stage = "ocr";
  }

  const heuristicResult = applyFallbackHeuristics(rawText, structuredFields);
  const merged = heuristicResult.fields;
  baseDebug.heuristic_debug = heuristicResult.debug;
  const extractedFields = listExtractedFields(rawText, merged);
  baseDebug.extracted_fields = extractedFields;

  const shouldFail = rawText.length === 0 && extractedFields.length === 0;
  const failureReason = shouldFail
    ? rawOcrResult.ok
      ? "No usable OCR text or extracted fields were recovered."
      : rawOcrResult.error
    : structuredError;

  if (shouldFail) {
    baseDebug.failure_stage = "final";
  }

  const output: ReceiptProcessingOutput = {
    ...merged,
    raw_ocr_text: rawText,
    debug: baseDebug,
    failure_reason: failureReason,
    is_partial: rawText.length > 0 && extractedFields.length < 7,
    parsed_json_text: parsedJsonText,
    should_fail: shouldFail,
  };

  return {
    ok: true as const,
    data: output,
  };
}

async function extractRawOcrTextFromImage(params: {
  contentType: string;
  imageBuffer: Buffer;
}) {
  const imageDataUrl = `data:${params.contentType};base64,${params.imageBuffer.toString("base64")}`;
  const payload = {
    model: OCR_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You perform OCR on receipt images. Return only the readable receipt text, preserving line breaks when possible. Do not summarize.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Read all useful text from this receipt image. Return plain text only.",
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
    max_output_tokens: 2000,
  };
  const requestShape = JSON.stringify({
    model: payload.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text" }],
      },
      {
        role: "user",
        content: [
          { type: "input_text" },
          { detail: "high", type: "input_image", image_url: "[data-url]" },
        ],
      },
    ],
    max_output_tokens: payload.max_output_tokens,
  });

  const primaryAttempt = await sendOpenAiRequest(payload, {
    imageInputSent: true,
    model: OCR_MODEL,
    requestShape,
  });

  if (primaryAttempt.ok && primaryAttempt.debug.assistant_text.trim()) {
    return {
      ok: true as const,
      data: normalizeRawText(primaryAttempt.debug.assistant_text),
      debug: primaryAttempt.debug,
    };
  }

  const fallbackPayload = {
    ...payload,
    input: [
      payload.input[0],
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Transcribe all visible text from this receipt exactly as shown.",
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
  };
  const fallbackRequestShape = JSON.stringify({
    model: fallbackPayload.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text" }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Transcribe all visible text from this receipt exactly as shown." },
          { detail: "high", type: "input_image", image_url: "[data-url]" },
        ],
      },
    ],
    max_output_tokens: fallbackPayload.max_output_tokens,
  });

  const fallbackAttempt = await sendOpenAiRequest(fallbackPayload, {
    imageInputSent: true,
    model: OCR_MODEL,
    requestShape: fallbackRequestShape,
  });
  fallbackAttempt.debug.fallback_used = true;

  if (fallbackAttempt.ok && fallbackAttempt.debug.assistant_text.trim()) {
    return {
      ok: true as const,
      data: normalizeRawText(fallbackAttempt.debug.assistant_text),
      debug: fallbackAttempt.debug,
    };
  }

  const failingAttempt = fallbackAttempt.debug.assistant_text.trim()
    ? fallbackAttempt
    : primaryAttempt;

  return {
    ok: false as const,
    error:
      failingAttempt.debug.empty_reason ??
      "OpenAI OCR text extraction returned an empty response.",
    debug: failingAttempt.debug,
  };
}

async function extractStructuredFieldsFromOcrText(rawText: string) {
  const payload = {
    model: STRUCTURED_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You parse OCR'd receipt text into structured fields. Use null when uncertain. receipt_date must be YYYY-MM-DD. total_amount and vat_amount must be numbers. currency must be a 3-letter ISO code when known.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Parse this OCR text from a receipt into structured data:\n\n${rawText}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "receipt_text_parse",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            merchant_name: { type: ["string", "null"] },
            receipt_date: { type: ["string", "null"] },
            total_amount: { type: ["number", "null"] },
            vat_amount: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            category: { type: ["string", "null"] },
          },
          required: [
            "merchant_name",
            "receipt_date",
            "total_amount",
            "vat_amount",
            "currency",
            "category",
          ],
        },
      },
    },
    max_output_tokens: 800,
  };
  const requestShape = JSON.stringify({
    model: payload.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text" }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: "[ocr-text]" }],
      },
    ],
    text: { format: { type: "json_schema", name: "receipt_text_parse" } },
    max_output_tokens: payload.max_output_tokens,
  });

  const attempt = await sendOpenAiRequest(payload, {
    imageInputSent: false,
    model: STRUCTURED_MODEL,
    requestShape,
  });

  if (!attempt.ok) {
    return {
      ok: false as const,
      error: `OpenAI structured extraction failed: ${attempt.debug.raw_response_body}`,
      debug: attempt.debug,
    };
  }

  if (!attempt.debug.assistant_text.trim()) {
    return {
      ok: false as const,
      error:
        attempt.debug.empty_reason ??
        "OpenAI structured extraction returned an empty response.",
      debug: attempt.debug,
    };
  }

  try {
    const parsed = JSON.parse(attempt.debug.assistant_text) as StructuredReceiptFields;
    return {
      ok: true as const,
      data: sanitizeStructuredFields(parsed),
      debug: attempt.debug,
    };
  } catch {
    return {
      ok: false as const,
      error: `OpenAI structured extraction returned malformed JSON: ${attempt.debug.assistant_text.slice(0, 400)}`,
      debug: {
        ...attempt.debug,
        empty_reason: "Structured response was non-empty but JSON parsing failed.",
      },
    };
  }
}

async function sendOpenAiRequest(
  payload: object,
  meta: { imageInputSent: boolean; model: string; requestShape: string },
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawResponseBody = await response.text();
  const parsedResponse = safeParseJson(rawResponseBody);
  const extracted = extractAssistantText(parsedResponse);

  const debug: OpenAiStageDebug = {
    assistant_text: extracted.text,
    empty_reason: extracted.emptyReason,
    image_input_sent: meta.imageInputSent,
    model: meta.model,
    raw_response_body: rawResponseBody,
    request_shape: meta.requestShape,
    response_field_read: extracted.source,
    response_empty: extracted.text.trim().length === 0,
  };

  return {
    ok: response.ok,
    debug,
  };
}

function extractAssistantText(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return {
      emptyReason: "Response body was not valid JSON.",
      source: "none",
      text: "",
    };
  }

  const candidate = responseJson as {
    output?: Array<{
      content?: Array<{
        text?: string;
        type?: string;
      }>;
      type?: string;
    }>;
    output_text?: string;
  };

  const outputText = candidate.output_text?.trim();
  if (outputText) {
    return {
      emptyReason: null,
      source: "output_text",
      text: outputText,
    };
  }

  const parts =
    candidate.output
      ?.flatMap((item) => item.content ?? [])
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean) ?? [];

  if (parts.length > 0) {
    return {
      emptyReason: null,
      source: "output[*].content[*].text",
      text: parts.join("\n").trim(),
    };
  }

  return {
    emptyReason:
      "No text was present in output_text or output[*].content[*].text.",
    source: "output_text/output[*].content[*].text",
    text: "",
  };
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function applyFallbackHeuristics(rawText: string, fields: StructuredReceiptFields) {
  const merged: ParsedReceiptPayload = {
    ...fields,
    raw_ocr_text: rawText,
  };
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const merchantCandidate = scoreMerchantCandidate(lines);
  const totalCandidate = findAmountCandidate(rawText, [
    "TOTAL",
    "GRAND TOTAL",
    "AMOUNT PAID",
    "CARD PAYMENT",
    "BALANCE DUE",
    "TO PAY",
  ]);
  const vatCandidate = findAmountCandidate(rawText, [
    "VAT",
    "TAX",
    "VAT AMOUNT",
    "VAT @",
  ]);
  const dateCandidate = findDateCandidate(lines);
  const timeCandidate = findTimeCandidate(lines);

  if (!merged.merchant_name) {
    merged.merchant_name = merchantCandidate.value;
  }

  if (!merged.total_amount) {
    merged.total_amount = totalCandidate.amount;
  }

  if (!merged.vat_amount) {
    merged.vat_amount = vatCandidate.amount;
  }

  if (!merged.currency) {
    merged.currency = inferCurrency(rawText);
  }

  if (!merged.receipt_date) {
    merged.receipt_date = dateCandidate.date;
  }

  merged.category = resolveReceiptCategory({
    aiCategory: merged.category,
    merchantName: merged.merchant_name,
  });

  return {
    debug: {
      candidate_merchant_line: merchantCandidate.line,
      candidate_receipt_date_line: dateCandidate.line,
      candidate_receipt_time_line: timeCandidate.line,
      candidate_total_line: totalCandidate.line,
      candidate_vat_line: vatCandidate.line,
      receipt_time: timeCandidate.time,
    },
    fields: merged,
  };
}

function sanitizeStructuredFields(result: StructuredReceiptFields) {
  return {
    merchant_name: normalizeNullableString(result.merchant_name),
    receipt_date: normalizeDate(result.receipt_date),
    total_amount: normalizeNullableNumber(result.total_amount),
    vat_amount: normalizeNullableNumber(result.vat_amount),
    currency: normalizeCurrency(result.currency),
    category: normalizeNullableString(result.category),
  };
}

function extractBestAmountFromLine(line: string) {
  const matches = [...line.matchAll(/(?:£|\$|€)?\s?(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{2}))/g)];
  if (matches.length === 0) {
    return null;
  }

  const lastMatch = matches[matches.length - 1]?.[1];
  if (!lastMatch) {
    return null;
  }

  return normalizeNumberString(lastMatch);
}

function inferCurrency(rawText: string) {
  if (rawText.includes("£") || /\bGBP\b/i.test(rawText)) {
    return "GBP";
  }

  if (rawText.includes("$") || /\bUSD\b/i.test(rawText)) {
    return "USD";
  }

  if (rawText.includes("€") || /\bEUR\b/i.test(rawText)) {
    return "EUR";
  }

  return null;
}

function resolveReceiptCategory(params: {
  aiCategory: string | null;
  merchantName: string | null;
}) {
  const mappedCategory = mapMerchantToCategory(params.merchantName);
  if (mappedCategory) {
    return mappedCategory;
  }

  const inferredCategory = inferCategoryFromMerchantName(params.merchantName);
  if (inferredCategory) {
    return inferredCategory;
  }

  return normalizeCategory(params.aiCategory);
}

function mapMerchantToCategory(merchantName: string | null) {
  const name = merchantName?.toLowerCase();
  if (!name) {
    return null;
  }

  const merchantCategoryMappings: Array<{
    aliases: string[];
    category: string;
  }> = [
    {
      aliases: [
        "tesco",
        "sainsbury",
        "sainsbury's",
        "aldi",
        "lidl",
        "waitrose",
        "morrisons",
        "asda",
        "marks & spencer food",
        "m&s food",
      ],
      category: "Groceries",
    },
    {
      aliases: [
        "starbucks",
        "costa",
        "pret",
        "pret a manger",
        "mcdonald",
        "burger king",
        "subway",
        "kfc",
        "nando",
        "domino",
        "pizza hut",
      ],
      category: "Dining",
    },
    {
      aliases: [
        "uber",
        "uber trip",
        "trainline",
        "national rail",
        "british airways",
        "easyjet",
        "ryanair",
        "airbnb",
        "booking.com",
      ],
      category: "Travel",
    },
    {
      aliases: ["shell", "bp", "esso", "texaco"],
      category: "Fuel",
    },
    {
      aliases: ["boots", "superdrug", "lloyds pharmacy"],
      category: "Healthcare",
    },
    {
      aliases: [
        "amazon",
        "ikea",
        "argos",
        "primark",
        "john lewis",
        "currys",
        "currys pc world",
        "b&q",
        "whsmith",
      ],
      category: "Shopping",
    },
  ];

  const matchedCategory = merchantCategoryMappings.find(({ aliases }) =>
    aliases.some((alias) => name.includes(alias)),
  );

  return matchedCategory?.category ?? null;
}

function inferCategoryFromMerchantName(merchantName: string | null) {
  const name = merchantName?.toLowerCase();
  if (!name) {
    return null;
  }

  if (
    containsKeyword(name, [
      "tesco",
      "sainsbury",
      "aldi",
      "lidl",
      "waitrose",
      "morrisons",
      "asda",
      "market",
      "grocer",
      "foodhall",
    ])
  ) {
    return "Groceries";
  }

  if (
    containsKeyword(name, [
      "uber",
      "train",
      "rail",
      "air",
      "airport",
      "hotel",
      "travel",
      "airways",
      "flight",
      "taxi",
    ])
  ) {
    return "Travel";
  }

  if (
    containsKeyword(name, [
      "cafe",
      "coffee",
      "restaurant",
      "pizza",
      "burger",
      "bar",
      "kitchen",
      "bistro",
      "grill",
      "eat",
    ])
  ) {
    return "Dining";
  }

  if (containsKeyword(name, ["shell", "bp", "esso", "fuel", "petrol", "diesel"])) {
    return "Fuel";
  }

  if (
    containsKeyword(name, ["boots", "pharmacy", "clinic", "dentist", "optician", "health"])
  ) {
    return "Healthcare";
  }

  if (
    containsKeyword(name, [
      "amazon",
      "shop",
      "store",
      "ikea",
      "argos",
      "retail",
      "outlet",
      "home",
      "fashion",
    ])
  ) {
    return "Shopping";
  }

  return null;
}

function normalizeCategory(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function containsKeyword(value: string, keywords: string[]) {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function scoreMerchantCandidate(lines: string[]) {
  const candidates = lines.slice(0, 8).map((line, index) => {
    let score = 0;
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    const digits = (line.match(/\d/g) ?? []).length;

    if (letters >= 4) score += 3;
    if (line.length >= 4 && line.length <= 32) score += 2;
    if (index < 3) score += 2;
    if (digits === 0) score += 2;
    if (digits > letters) score -= 3;
    if (containsKeyword(line, ["vat", "tax", "receipt", "invoice", "tel", "phone"])) score -= 4;
    if (/\b\d{5,}\b/.test(line)) score -= 3;
    if (/@|www\.|\.com/i.test(line)) score -= 2;
    if (containsKeyword(line, ["road", "street", "st ", "ave", "avenue", "lane", "postcode"])) {
      score -= 3;
    }

    return { line, score };
  });

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 2) {
    return { line: null, value: null };
  }

  return { line: best.line, value: best.line.replace(/\s{2,}/g, " ") };
}

function findAmountCandidate(rawText: string, keywords: string[]) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lowerHalfStart = Math.floor(lines.length / 2);
  const candidates: Array<{ amount: number | null; line: string; score: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!containsKeyword(line, keywords)) {
      continue;
    }

    const sameLineAmount = extractBestAmountFromLine(line);
    const nextLineAmount = extractBestAmountFromLine(lines[index + 1] ?? "");
    const amount = sameLineAmount ?? nextLineAmount;
    if (amount == null) {
      continue;
    }

    let score = 0;
    if (index >= lowerHalfStart) score += 3;
    if (containsKeyword(line, ["grand total", "amount paid", "balance due", "to pay"])) score += 4;
    if (containsKeyword(line, ["total"])) score += 2;
    if (containsKeyword(line, ["subtotal"])) score -= 4;
    if (containsKeyword(line, ["vat", "tax"]) && !containsKeyword(line, ["total"])) score -= 3;

    candidates.push({ amount, line, score });
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return {
    amount: best?.amount ?? null,
    line: best?.line ?? null,
  };
}

function findDateCandidate(lines: string[]) {
  for (const line of lines) {
    if (containsKeyword(line, ["date", "transaction date", "receipt date", "issued"])) {
      const date = extractDateFromLine(line);
      if (date) {
        return { date, line };
      }
    }
  }

  for (const line of lines) {
    const date = extractDateFromLine(line);
    if (date) {
      return { date, line };
    }
  }

  return { date: null, line: null };
}

function findTimeCandidate(lines: string[]) {
  for (const line of lines) {
    if (containsKeyword(line, ["time", "date/time", "transaction time"])) {
      const time = extractTimeFromLine(line);
      if (time) {
        return { line, time };
      }
    }
  }

  for (const line of lines) {
    const time = extractTimeFromLine(line);
    if (time) {
      return { line, time };
    }
  }

  return { line: null, time: null };
}

function extractDateFromLine(line: string) {
  const formats = [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{2}[/-]\d{2}[/-]\d{4})\b/,
    /\b(\d{2}\.\d{2}\.\d{4})\b/,
    /\b(\d{2}[/-]\d{2}[/-]\d{2})\b/,
    /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/,
  ];

  for (const pattern of formats) {
    const match = line.match(pattern);
    const candidate = match?.[1];
    if (!candidate) {
      continue;
    }

    const normalized = normalizeDateCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractTimeFromLine(line: string) {
  const match =
    line.match(/\b(\d{2}:\d{2}:\d{2})\b/) ??
    line.match(/\b(\d{2}:\d{2})\b/) ??
    line.match(/\b(\d{1,2}:\d{2}\s?(?:AM|PM))\b/i);

  return match?.[1] ?? null;
}

function listExtractedFields(rawText: string, fields: StructuredReceiptFields) {
  const extracted: string[] = [];

  if (rawText) extracted.push("raw_ocr_text");
  if (fields.merchant_name) extracted.push("merchant_name");
  if (fields.receipt_date) extracted.push("receipt_date");
  if (fields.total_amount != null) extracted.push("total_amount");
  if (fields.vat_amount != null) extracted.push("vat_amount");
  if (fields.currency) extracted.push("currency");
  if (fields.category) extracted.push("category");

  return extracted;
}

function buildFailureOutput(
  debug: ReceiptProcessingOutput["debug"],
  failureReason: string,
): ReceiptProcessingOutput {
  return {
    ...emptyStructuredFields(),
    raw_ocr_text: "",
    debug,
    failure_reason: failureReason,
    is_partial: false,
    parsed_json_text: null,
    should_fail: true,
  };
}

function emptyStructuredFields(): StructuredReceiptFields {
  return {
    merchant_name: null,
    receipt_date: null,
    total_amount: null,
    vat_amount: null,
    currency: null,
    category: null,
  };
}

function normalizeNullableString(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCurrency(value: string | null) {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && trimmed.length === 3 ? trimmed : null;
}

function normalizeDate(value: string | null) {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeRawText(value: string) {
  return value.replace(/\r/g, "").trim();
}

function normalizeNumberString(value: string) {
  const normalized = value.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateCandidate(candidate: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return candidate;
  }

  const monthNamed = candidate.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monthNamed) {
    const day = monthNamed[1].padStart(2, "0");
    const month = monthNameToNumber(monthNamed[2]);
    const year = monthNamed[3];
    return month ? `${year}-${month}-${day}` : null;
  }

  const parts = candidate.split(/[/-]/);
  if (parts.length !== 3) {
    const dotParts = candidate.split(".");
    if (dotParts.length === 3) {
      return normalizeDateCandidate(dotParts.join("/"));
    }

    return null;
  }

  const [first, second, third] = parts;
  if (third.length === 4) {
    return `${third}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
  }

  if (third.length === 2) {
    return `20${third}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
  }

  return null;
}

function monthNameToNumber(monthName: string) {
  const months: Record<string, string> = {
    apr: "04",
    aug: "08",
    dec: "12",
    feb: "02",
    jan: "01",
    jul: "07",
    jun: "06",
    mar: "03",
    may: "05",
    nov: "11",
    oct: "10",
    sep: "09",
  };

  return months[monthName.slice(0, 3).toLowerCase()] ?? null;
}
