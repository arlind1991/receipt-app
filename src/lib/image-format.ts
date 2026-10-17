import convertHeic from "heic-convert";

// Stored receipt images are labelled image/jpeg whatever they really are, so
// decide by the bytes. Server-side only (heic-convert is a Node library).

export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "isobmff" | "unknown";

export function sniffImageKind(bytes: Buffer): ImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (bytes.length >= 6 && bytes.toString("ascii", 0, 3) === "GIF") {
    return "gif";
  }
  // HEIC/HEIF (and AVIF) files are ISO-BMFF containers starting with an ftyp box.
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    return "isobmff";
  }
  return "unknown";
}

// Converts HEIC/HEIF to JPEG; other formats are returned unchanged. AVIF (also
// ISO-BMFF) fails heic-convert and is returned as-is for sharp to handle.
export async function convertHeicToJpeg(bytes: Buffer) {
  if (sniffImageKind(bytes) !== "isobmff") {
    return { bytes, converted: false };
  }

  try {
    const jpeg = await convertHeic({ buffer: bytes, format: "JPEG", quality: 0.92 });
    return { bytes: Buffer.from(jpeg), converted: true };
  } catch {
    return { bytes, converted: false };
  }
}
