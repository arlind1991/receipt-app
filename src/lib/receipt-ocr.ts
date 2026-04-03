type ReceiptOcrResult = {
  merchant_name: string | null;
  receipt_date: string | null;
  total_amount: number | null;
  vat_amount: number | null;
  currency: string | null;
  category: string | null;
  raw_ocr_text: string;
};

const openAiApiKey = process.env.OPENAI_API_KEY;

export const receiptOcrEnvError = !openAiApiKey
  ? "Set OPENAI_API_KEY to enable receipt OCR processing."
  : null;

export async function extractReceiptFieldsFromImage(params: {
  contentType: string;
  imageBuffer: Buffer;
}) {
  if (receiptOcrEnvError) {
    return { ok: false as const, error: receiptOcrEnvError };
  }

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
              text: "You extract receipt data from images. Return only valid structured data. Use null when uncertain. receipt_date must be YYYY-MM-DD. currency must be a 3-letter ISO code when known. total_amount and vat_amount must be numbers, not strings. raw_ocr_text should contain the main readable OCR text from the receipt.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract the merchant name, receipt date, total amount, VAT amount, currency, category, and raw OCR text from this receipt image. Infer a sensible category like Groceries, Travel, Dining, Office, Utilities, Fuel, Shopping, Healthcare, or Other when possible.",
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "receipt_extraction",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              merchant_name: { type: ["string", "null"] },
              receipt_date: {
                type: ["string", "null"],
                description: "Receipt date as YYYY-MM-DD when known.",
              },
              total_amount: { type: ["number", "null"] },
              vat_amount: { type: ["number", "null"] },
              currency: {
                type: ["string", "null"],
                description: "3-letter ISO 4217 currency code like GBP or USD.",
              },
              category: { type: ["string", "null"] },
              raw_ocr_text: { type: "string" },
            },
            required: [
              "merchant_name",
              "receipt_date",
              "total_amount",
              "vat_amount",
              "currency",
              "category",
              "raw_ocr_text",
            ],
          },
        },
      },
      max_output_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false as const,
      error: `OpenAI receipt extraction failed: ${errorText}`,
    };
  }

  const json = (await response.json()) as { output_text?: string };
  const outputText = json.output_text;

  if (!outputText) {
    return {
      ok: false as const,
      error: "OpenAI receipt extraction returned an empty response.",
    };
  }

  try {
    const parsed = JSON.parse(outputText) as ReceiptOcrResult;
    return {
      ok: true as const,
      data: sanitizeReceiptOcrResult(parsed),
    };
  } catch {
    return {
      ok: false as const,
      error: "OpenAI receipt extraction returned invalid JSON.",
    };
  }
}

function sanitizeReceiptOcrResult(result: ReceiptOcrResult) {
  return {
    merchant_name: normalizeNullableString(result.merchant_name),
    receipt_date: normalizeDate(result.receipt_date),
    total_amount: normalizeNullableNumber(result.total_amount),
    vat_amount: normalizeNullableNumber(result.vat_amount),
    currency: normalizeCurrency(result.currency),
    category: normalizeNullableString(result.category),
    raw_ocr_text: result.raw_ocr_text?.trim() || "",
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
