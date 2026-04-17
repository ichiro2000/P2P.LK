"use client";

import jsQR from "jsqr";

/**
 * Decode a QR code from an uploaded File entirely in the browser. We draw
 * the image onto an offscreen canvas, pull ImageData, and hand it to jsQR.
 *
 * Throws with a user-facing message on failure — the caller surfaces the
 * message directly to the uploader.
 */
export async function decodeQrFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload an image file (PNG or JPEG).");
  }

  const bitmap = await loadBitmap(file);
  const { width, height } = bitmap;
  if (width === 0 || height === 0) {
    throw new Error("The image appears to be empty.");
  }

  // Downscale very large images — jsQR is O(w·h) and a 4000×4000 phone
  // screenshot is both slow and often overkill.
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not available in this browser.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const result = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
  if (!result || !result.data) {
    throw new Error(
      "Couldn't find a QR code in that image. Try a clearer screenshot that crops to just the QR.",
    );
  }
  return result.data;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path.
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read the image file."));
    };
    img.src = url;
  });
}
