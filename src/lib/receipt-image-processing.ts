import sharp from "sharp";

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
  let pipeline = sharp(params.imageBuffer, { failOn: "none" }).rotate();

  pipeline = pipeline
    .grayscale()
    .normalise()
    .linear(1.12, -10)
    .sharpen(1, 1.2, 1.8)
    .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 92 });

  const ocrBuffer = await pipeline.toBuffer();

  return {
    contentType: "image/jpeg",
    debug: {
      contrast_enhanced: true,
      crop_applied: false,
      detected_receipt_count: 1,
      grayscale_applied: true,
      sharpen_applied: true,
      shadow_reduction_applied: false,
      straighten_applied: true,
      trim_applied: false,
    },
    ocrBuffer,
  } satisfies ReceiptPreprocessingResult;
}
