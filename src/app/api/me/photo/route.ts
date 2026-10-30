import { currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { addPhoto, deletePhotos, photosOf } from "@/lib/photos";
import { fromBase64, PhotoError } from "@/lib/photo-image";
import { PHOTO_MAX_BYTES, PHOTO_MAX_JSON_BODY, PHOTO_MAX_MULTIPART_BODY, PHOTO_TOO_BIG, PHOTO_TOO_BIG_BASE64 } from "@/lib/photo-limits";
import { logActivity } from "@/lib/records";

export const maxDuration = 60;

// Add one of your OWN photos: multipart/form-data (field "photo") or JSON {"image": "<base64 or data URL>"}.
// JPEG/PNG/WebP (HEIC only where sharp can read it: not iPhone HEVC) up to 4 MB as multipart, 3 MB as base64 JSON (under Vercel's 4.5 MB request cap: lib/photo-limits.ts);
// re-encoded to JPEG (max 1024 px, no EXIF/GPS) and checked before it is stored.
export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`photo:${me.id}`, 20, 3600))) return tooMany();
  const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  if (Number(req.headers.get("content-length") ?? 0) > (multipart ? PHOTO_MAX_MULTIPART_BODY : PHOTO_MAX_JSON_BODY)) {
    return json({ error: multipart ? PHOTO_TOO_BIG : PHOTO_TOO_BIG_BASE64 }, 413);
  }
  let bytes: Uint8Array | null = null;
  try {
    if (multipart) {
      const file = (await req.formData()).get("photo");
      if (file instanceof Blob) bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = (await req.json()) as { image?: unknown };
      if (typeof body?.image === "string") bytes = fromBase64(body.image);
    }
  } catch (e) {
    if (e instanceof PhotoError) return json({ error: e.message }, e.status); // base64 over 3 MB
    bytes = null;
  }
  if (!bytes) return json({ error: 'Send multipart field "photo", or JSON {"image": "<base64>"}.' }, 400);
  if (bytes.byteLength > PHOTO_MAX_BYTES) return json({ error: PHOTO_TOO_BIG }, 413);
  try {
    const photos = await addPhoto(me.id, bytes, "upload");
    await logActivity(me.id, requestClient(req), "photo_upload", { photoId: photos.at(-1)?.id, source: "upload" });
    return json({ ok: true, photos }, 201);
  } catch (e) {
    if (e instanceof PhotoError) return json({ error: e.message }, e.status);
    throw e;
  }
}

// DELETE {"photoId": "<id>"} (or ?id=): removes one of your photos, file included.
export async function DELETE(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const body = (await req.json().catch(() => null)) as { photoId?: unknown } | null;
  const id = typeof body?.photoId === "string" ? body.photoId : new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Send {"photoId": "<id>"}.' }, 400);
  const n = await deletePhotos(me.id, { id });
  if (!n) return json({ error: "No photo of yours with that id." }, 404);
  await logActivity(me.id, requestClient(req), "photo_remove", { photoId: id });
  return json({ ok: true, photos: await photosOf(me.id) });
}

export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return json({ photos: await photosOf(me.id) });
}
