import type { ReceiptDetectionResult } from "@/lib/types";

const openAiApiKey = process.env.OPENAI_API_KEY;
const DETECTION_MODEL = "gpt-4o-mini";

const defaultResult: ReceiptDetectionResult = {
  boxes: [
    {
      height: 1,
      index: 0,
      width: 1,
      x: 0,
      y: 0,
    },
  ],
  detectedMultiple: false,
  receiptCount: 1,
};

export async function detectReceiptRegionsFromImage(params: {
  contentType: string;
  imageBuffer: Buffer;
}): Promise<ReceiptDetectionResult> {
  if (!openAiApiKey) {
    return defaultResult;
  }

  const imageDataUrl = `data:${params.contentType};base64,${params.imageBuffer.toString("base64")}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DETECTION_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You inspect camera photos and decide whether they contain one receipt or multiple separate receipts. If multiple paper receipts are clearly visible, return one bounding box per receipt. Use normalized coordinates from 0 to 1. If uncertain, return a single receipt.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Detect how many separate receipts are visible in this image. Return JSON only.",
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
          name: "receipt_detection",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              receiptCount: { type: "integer", minimum: 1, maximum: 4 },
              boxes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    index: { type: "integer", minimum: 0, maximum: 3 },
                    x: { type: "number", minimum: 0, maximum: 1 },
                    y: { type: "number", minimum: 0, maximum: 1 },
                    width: { type: "number", minimum: 0.05, maximum: 1 },
                    height: { type: "number", minimum: 0.05, maximum: 1 },
                  },
                  required: ["index", "x", "y", "width", "height"],
                },
              },
            },
            required: ["receiptCount", "boxes"],
          },
        },
      },
      max_output_tokens: 600,
    }),
  });

  if (!response.ok) {
    return defaultResult;
  }

  const responseText = await response.text();
  const parsed = safeParseJson(responseText);
  const assistantText = extractText(parsed);
  if (!assistantText) {
    return defaultResult;
  }

  const json = safeParseJson(assistantText);
  if (!json || typeof json !== "object") {
    return defaultResult;
  }

  const candidate = json as {
    boxes?: Array<{
      height?: number;
      index?: number;
      width?: number;
      x?: number;
      y?: number;
    }>;
    receiptCount?: number;
  };

  const boxes = (candidate.boxes ?? [])
    .map((box, index) => ({
      height: clamp01(box.height ?? 0),
      index: Number.isFinite(box.index) ? Number(box.index) : index,
      width: clamp01(box.width ?? 0),
      x: clamp01(box.x ?? 0),
      y: clamp01(box.y ?? 0),
    }))
    .filter((box) => box.width >= 0.05 && box.height >= 0.05)
    .sort((left, right) => left.x - right.x || left.y - right.y);

  const receiptCount = Math.max(
    1,
    Math.min(
      4,
      Number.isFinite(candidate.receiptCount) ? Number(candidate.receiptCount) : boxes.length || 1,
    ),
  );

  if (receiptCount <= 1 || boxes.length <= 1) {
    return defaultResult;
  }

  return {
    boxes,
    detectedMultiple: true,
    receiptCount: Math.max(receiptCount, boxes.length),
  };
}

function extractText(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const candidate = responseJson as {
    output?: Array<{
      content?: Array<{
        text?: string;
      }>;
    }>;
    output_text?: string;
  };

  if (typeof candidate.output_text === "string" && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  const parts =
    candidate.output
      ?.flatMap((item) => item.content ?? [])
      .map((part) => part.text?.trim() ?? "")
      .filter(Boolean) ?? [];

  return parts.join("\n").trim();
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
