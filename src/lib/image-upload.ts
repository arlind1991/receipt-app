// Browser-side: turns a picked or photographed image (iPhones give HEIC from
// the library) into a JPEG no larger than MAX_EDGE, the same format the camera
// screen uploads.

const MAX_EDGE = 2560;

export async function imageFileToJpeg(file: Blob): Promise<Blob> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This browser can't prepare the photo.");
  }
  context.drawImage(image.source, 0, 0, width, height);
  image.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    throw new Error("The photo couldn't be prepared. Try another one.");
  }
  return blob;
}

async function loadImage(file: Blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { close: () => bitmap.close(), height: bitmap.height, source: bitmap, width: bitmap.width };
    } catch {
      // Fall back to an <img> element (older Safari, some HEIC files).
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    return {
      close: () => URL.revokeObjectURL(url),
      height: element.naturalHeight,
      source: element,
      width: element.naturalWidth,
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That file doesn't look like a photo this browser can open.");
  }
}
