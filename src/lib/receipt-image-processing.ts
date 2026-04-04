import sharp from "sharp";
import { detectReceiptRegionsFromImage } from "@/lib/receipt-detection";

export type ReceiptPreprocessingResult = {
  contentType: string;
  debug: {
    contrast_enhanced: boolean;
    crop_applied: boolean;
    detected_receipt_count: number;
    grayscale_applied: boolean;
    sharpen_applied: boolean;
    shadow_reduction_applied: boolean;
    straighten_applied: boolean;
    trim_applied: boolean;
  };
  ocrBuffer: Buffer;
};

export async function preprocessReceiptImageForOcr(params: {
  contentType: string;
  imageBuffer: Buffer;
}) {
  const metadata = await sharp(params.imageBuffer, { failOn: "none" })
    .rotate()
    .metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const detection = await detectReceiptRegionsFromImage({
    contentType: params.contentType,
    imageBuffer: params.imageBuffer,
  });

  const primaryBox = detection.boxes[0];
  const shouldCrop =
    width > 0 &&
    height > 0 &&
    primaryBox &&
    (!detection.detectedMultiple || detection.receiptCount === 1) &&
    (primaryBox.width < 0.98 || primaryBox.height < 0.98 || primaryBox.x > 0.01 || primaryBox.y > 0.01);

  let pipeline = sharp(params.imageBuffer, { failOn: "none" }).rotate();

  if (shouldCrop && primaryBox) {
    pipeline = pipeline.extract({
      height: Math.max(1, Math.round(height * primaryBox.height)),
      left: Math.max(0, Math.round(width * primaryBox.x)),
      top: Math.max(0, Math.round(height * primaryBox.y)),
      width: Math.max(1, Math.round(width * primaryBox.width)),
    });
  }

  pipeline = pipeline
    .trim({ background: { b: 255, g: 255, r: 255 }, threshold: 12 })
    .grayscale()
    .normalise()
    .linear(1.08, -8)
    .median(1)
    .sharpen(1.1, 1.4, 2.2)
    .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 92 });

  const ocrBuffer = await pipeline.toBuffer();

  return {
    contentType: "image/jpeg",
    debug: {
      contrast_enhanced: true,
      crop_applied: Boolean(shouldCrop),
      detected_receipt_count: detection.receiptCount,
      grayscale_applied: true,
      sharpen_applied: true,
      shadow_reduction_applied: true,
      straighten_applied: true,
      trim_applied: true,
    },
    ocrBuffer,
  } satisfies ReceiptPreprocessingResult;
}
