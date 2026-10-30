// The web client's step before a photo upload (QA5 Q5-L3): a phone photo is often 6-12 MB, over the 4 MB the server
// takes (Vercel caps a request at 4.5 MB), so a big photo is drawn smaller on a canvas and sent as a JPEG. The server
// still re-encodes every photo and drops EXIF/GPS (lib/photo-image.ts). Browser code, but for the pure helpers.
import { PHOTO_MAX_BYTES } from "./photo-limits.ts";

/** Photos up to this size go as picked: re-encoding a small JPEG only costs quality. */
export const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
/** Tries in order until one fits under the server's limit: [longest side in px, JPEG quality]. The first is twice the
 * server's 1024 px, so its own resize still has detail to work with. */
export const ATTEMPTS: readonly (readonly [number, number])[] = [[2048, 0.88], [1600, 0.82], [1280, 0.75]];

/** The size to draw at: the longest side at most `max`, never enlarged. */
export function fitWithin(width: number, height: number, max: number) {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** A picked file is redrawn first when it is big, or HEIC (which the server can't always read). */
export const needsShrink = (size: number, type: string) => size > SHRINK_ABOVE_BYTES || /^image\/hei[cf]/i.test(type);

type Decoded = { source: CanvasImageSource; width: number; height: number; done: () => void };

/** Decodes with the EXIF orientation applied: createImageBitmap, or an <img> where that fails. */
async function decode(file: File): Promise<Decoded> {
  try {
    const b = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: b, width: b.width, height: b.height, done: () => b.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode().catch((e) => {
      URL.revokeObjectURL(url);
      throw e;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
}

/**
 * What to upload: the picked file when it is small, else a smaller JPEG drawn on a canvas. When the browser can't draw
 * it (an HEIC outside Safari), the file itself if the server can take it, or null: too big to send.
 */
export async function shrinkPhoto(file: File): Promise<Blob | null> {
  if (!needsShrink(file.size, file.type)) return file;
  const img = await decode(file).catch(() => null);
  if (img) {
    try {
      for (const [max, quality] of ATTEMPTS) {
        const { width, height } = fitWithin(img.width, img.height, max);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) break;
        ctx.fillStyle = "#ffffff"; // a transparent PNG on white, as the server flattens it
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingQuality = "high"; // a 3-6x downscale aliases at the default
        ctx.drawImage(img.source, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
        canvas.width = canvas.height = 0; // frees its memory now (iOS Safari has little canvas memory)
        if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
      }
    } finally {
      img.done();
    }
  }
  return file.size <= PHOTO_MAX_BYTES ? file : null;
}
