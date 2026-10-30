// Photo upload limits, shared by the server (lib/photo-image.ts, api/me/photo) and the web client (components/home.tsx).
// Vercel refuses any request body over 4.5 MB with its own plain-text 413 before the app sees it (QA5 Q5-L3), so the
// app's limits sit under that: 4 MB of image as multipart, 3 MB as base64 JSON (base64 makes 3 MB into 4 MB of text).
// No imports (the browser loads it too).

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_MAX_BASE64_BYTES = 3 * 1024 * 1024;
/** The longest base64 text accepted: 3 MB of image, plus the "=" padding. */
export const PHOTO_MAX_BASE64_CHARS = Math.ceil(PHOTO_MAX_BASE64_BYTES / 3) * 4;
/** The largest request body each way: the image plus room for the multipart parts, or for the JSON around the base64
 * (line breaks in it too: MIME base64 has one every 76 characters; fromBase64 counts the characters without them). */
export const PHOTO_MAX_MULTIPART_BODY = PHOTO_MAX_BYTES + 64 * 1024;
export const PHOTO_MAX_JSON_BODY = 4_400_000;
/** Vercel's cap on a function's request body; every limit above stays under it (tested). */
export const PLATFORM_MAX_BODY = 4_500_000;

export const PHOTO_TOO_BIG = "Photos must be 4 MB or smaller.";
export const PHOTO_TOO_BIG_BASE64 = "Photos sent as base64 JSON must be 3 MB or smaller (4 MB as multipart).";
