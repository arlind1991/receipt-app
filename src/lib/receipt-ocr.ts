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

type ReceiptProcessingOutput = ParsedReceiptPayload & {
  debug: {
    extraction_error: string | null;
    extracted_fields: string[];
    image_download_succeeded: boolean;
    ocr_text_returned: boolean;
    parsed_json: string | null;
    structured_json_returned: boolean;
  };
  failure_reason: string | null;
  is_partial: boolean;
  should_fail: boolean;
};

const openAiApiKey = process.env.OPENAI_API_KEY;

export const receiptOcrEnvError = !openAiApiKey
  ? "Set OPENAI_API_KEY to enable receipt OCR processing."
  : null;

export async function extractReceiptDataFromImage(params: {
  contentType: string;
  imageBuffer: Buffer;
  imageDownloadSucceeded?: boolean;
}) {
  const baseDebug = {
    extraction_error: null as string | null,
    extracted_fields: [] as string[],
    image_download_succeeded: params.imageDownloadSucceeded ?? true,
    ocr_text_returned: false,
    parsed_json: null as string | null,
    structured_json_returned: false,
  };

  if (receiptOcrEnvError) {
    return {
      ok: false as const,
      error: receiptOcrEnvError,
      data: buildFailureOutput(baseDebug, receiptOcrEnvError),
    };
  }

  const rawOcrResult = await extractRawOcrTextFromImage(params);
  const rawText = normalizeRawText(rawOcrResult.ok ? rawOcrResult.data : "");
  baseDebug.ocr_text_returned = rawText.length > 0;

  const structuredResult =
    rawText.length > 0 ? await extractStructuredFieldsFromOcrText(rawText) : null;

  if (structuredResult?.ok) {
    baseDebug.structured_json_returned = true;
    baseDebug.parsed_json = structuredResult.json;
  } else if (structuredResult && !structuredResult.ok) {
    baseDebug.extraction_error = structuredResult.error;
  }

  const structuredFields = structuredResult?.ok ? structuredResult.data : emptyStructuredFields();
  const merged = applyFallbackHeuristics(rawText, structuredFields);
  const extractedFields = listExtractedFields(rawText, merged);
  baseDebug.extracted_fields = extractedFields;

  const shouldFail = rawText.length === 0 && extractedFields.length === 0;
  const failureReason = shouldFail
    ? rawOcrResult.ok
      ? "No usable OCR text or structured fields were recovered."
      : rawOcrResult.error
    : null;

  if (!baseDebug.extraction_error && !rawOcrResult.ok) {
    baseDebug.extraction_error = rawOcrResult.error;
  }

  const output: ReceiptProcessingOutput = {
    ...merged,
    raw_ocr_text: rawText || nullToEmpty(rawOcrResult.ok ? rawOcrResult.data : ""),
    debug: baseDebug,
    failure_reason: failureReason,
    is_partial: rawText.length > 0 && extractedFields.length < 6,
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

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false as const,
      error: `OpenAI OCR text extraction failed: ${errorText}`,
    };
  }

  const json = (await response.json()) as { output_text?: string };
  const outputText = normalizeRawText(json.output_text ?? "");

  if (!outputText) {
    return {
      ok: false as const,
      error: "OpenAI OCR text extraction returned an empty response.",
    };
  }

  return {
    ok: true as const,
    data: outputText,
  };
}

async function extractStructuredFieldsFromOcrText(rawText: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false as const,
      error: `OpenAI structured extraction failed: ${errorText}`,
    };
  }

  const json = (await response.json()) as { output_text?: string };
  const outputText = json.output_text?.trim();

  if (!outputText) {
    return {
      ok: false as const,
      error: "OpenAI structured extraction returned an empty response.",
    };
  }

  try {
    const parsed = JSON.parse(outputText) as StructuredReceiptFields;
    return {
      ok: true as const,
      data: sanitizeStructuredFields(parsed),
      json: outputText,
    };
  } catch {
    return {
      ok: false as const,
      error: "OpenAI structured extraction returned invalid JSON.",
    };
  }
}

function applyFallbackHeuristics(rawText: string, fields: StructuredReceiptFields): ParsedReceiptPayload {
  const merged: ParsedReceiptPayload = {
    ...fields,
    raw_ocr_text: rawText,
  };

  if (!merged.merchant_name) {
    merged.merchant_name = guessMerchantFromOcr(rawText);
  }

  if (!merged.total_amount) {
    merged.total_amount = guessAmountFromKeywords(rawText, [
      "TOTAL",
      "AMOUNT",
      "PAID",
      "CARD PAYMENT",
      "BALANCE DUE",
      "GRAND TOTAL",
    ]);
  }

  if (!merged.vat_amount) {
    merged.vat_amount = guessAmountFromKeywords(rawText, ["VAT", "TAX"]);
  }

  if (!merged.currency) {
    merged.currency = inferCurrency(rawText);
  }

  if (!merged.category) {
    merged.category = inferCategoryFromMerchant(merged.merchant_name);
  }

  if (!merged.receipt_date) {
    merged.receipt_date = guessDateFromText(rawText);
  }

  return merged;
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

function guessMerchantFromOcr(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const line of lines) {
    if (line.length < 3) {
      continue;
    }

    if (/\d/.test(line) && !/[A-Za-z]/.test(line)) {
      continue;
    }

    if (containsKeyword(line, ["vat", "tax", "receipt", "invoice", "total"])) {
      continue;
    }

    return line.replace(/\s{2,}/g, " ");
  }

  return null;
}

function guessAmountFromKeywords(rawText: string, keywords: string[]) {
  const lines = rawText.split(/\r?\n/);

  for (const line of lines) {
    if (!containsKeyword(line, keywords)) {
      continue;
    }

    const amount = extractBestAmountFromLine(line);
    if (amount != null) {
      return amount;
    }
  }

  return null;
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

function guessDateFromText(rawText: string) {
  const dateMatches = [
    ...rawText.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g),
    ...rawText.matchAll(/\b(\d{2}[/-]\d{2}[/-]\d{4})\b/g),
    ...rawText.matchAll(/\b(\d{2}[/-]\d{2}[/-]\d{2})\b/g),
  ];

  for (const match of dateMatches) {
    const candidate = match[1];
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

function inferCategoryFromMerchant(merchantName: string | null) {
  const name = merchantName?.toLowerCase();
  if (!name) {
    return null;
  }

  if (containsKeyword(name, ["tesco", "sainsbury", "aldi", "lidl", "waitrose", "morrisons"])) {
    return "Groceries";
  }

  if (containsKeyword(name, ["uber", "train", "rail", "air", "airport", "hotel"])) {
    return "Travel";
  }

  if (containsKeyword(name, ["cafe", "coffee", "restaurant", "pizza", "burger", "bar"])) {
    return "Dining";
  }

  if (containsKeyword(name, ["shell", "bp", "esso"])) {
    return "Fuel";
  }

  if (containsKeyword(name, ["boots", "pharmacy", "clinic"])) {
    return "Healthcare";
  }

  if (containsKeyword(name, ["amazon", "shop", "store", "ikea", "argos"])) {
    return "Shopping";
  }

  return "Other";
}

function containsKeyword(value: string, keywords: string[]) {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
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

  const parts = candidate.split(/[/-]/);
  if (parts.length !== 3) {
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

function nullToEmpty(value: string) {
  return value.trim();
}
