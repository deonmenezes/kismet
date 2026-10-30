import sharp from "sharp";
import { PHOTO_MAX_BASE64_CHARS, PHOTO_MAX_BYTES, PHOTO_TOO_BIG, PHOTO_TOO_BIG_BASE64 } from "./photo-limits.ts";

// Photo files: decode, auto-rotate, resize and re-encode to JPEG with NO metadata (EXIF, GPS, XMP, ICC
// are all dropped: sharp keeps none unless asked). No database or framework imports (unit-tested directly).

export { PHOTO_MAX_BYTES } from "./photo-limits.ts";
export const UPLOAD_MAX_PX = 1024;
export const X_AVATAR_MAX_PX = 512;
export const MAX_PHOTOS = 3;
const FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

export class PhotoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Re-encodes any accepted image (sniffed from its bytes, not its claimed type) to a clean JPEG. */
export async function toCleanJpeg(input: Uint8Array, maxPx: number) {
  if (input.byteLength > PHOTO_MAX_BYTES) throw new PhotoError(PHOTO_TOO_BIG, 413);
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw new PhotoError("That file isn't an image we can read. Send a JPEG, PNG or WebP.", 415);
  }
  if (!format || !FORMATS.has(format)) throw new PhotoError("Send a JPEG, PNG, WebP or HEIC photo.", 415);
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate() // apply the EXIF orientation before it is dropped
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    // Prebuilt sharp cannot decode every HEIC variant: ask for a JPEG instead of failing obscurely.
    throw new PhotoError(format === "heif" ? "This HEIC photo can't be read here. Please send it as JPEG." : "That image could not be processed.", 415);
  }
}

/** Decodes a base64 or data-URL string; null when it is not valid base64. Throws PhotoError 413 over 3 MB of image. */
export function fromBase64(s: string): Uint8Array | null {
  const b64 = s.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
  if (b64.length > PHOTO_MAX_BASE64_CHARS) throw new PhotoError(PHOTO_TOO_BIG_BASE64, 413);
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return Buffer.from(b64, "base64");
}
