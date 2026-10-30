import { randomUUID } from "node:crypto";
import { queueDeletions } from "./deletion-jobs";
import { del, put } from "@vercel/blob";
import { generateText } from "ai";
import sharp from "sharp";
import { sql } from "./db";
import { SITE } from "./copy";
import { MAX_PHOTOS, PHOTO_MAX_BYTES, PhotoError, toCleanJpeg, UPLOAD_MAX_PX, X_AVATAR_MAX_PX } from "./photo-image";
import { MODERATION_PROMPT, moderate } from "./photo-check";
import { googleAvatar } from "./google-avatar";
import { logActivity } from "./records";
import { SYSTEM } from "./client";

// Profile photos: only the person's own (an upload, their own X avatar when they linked their handle and opted in,
// or the profile picture of their own Google sign-in when they tapped "Use it": never added without asking). Files live in a PRIVATE Vercel Blob store under random paths and are served only through
// /api/photos/<id>, which checks who may see them (secret.ts canSeePhotos).

const MODERATION_MODEL = "anthropic/claude-haiku-5.5";
const NO_THINKING = { anthropic: { thinking: { type: "disabled" } } };

export type PhotoRef = { id: string; url: string };
export const photoUrl = (id: string) => `${SITE}/api/photos/${id}`;

// The vision check sees a small copy (cheap), never the original upload.
async function visionCheck(jpeg: Uint8Array) {
  const small = await sharp(jpeg).resize({ width: 384, height: 384, fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
  const { text } = await generateText({
    model: MODERATION_MODEL,
    messages: [{ role: "user", content: [{ type: "file", mediaType: "image/jpeg", data: small }, { type: "text", text: MODERATION_PROMPT }] }],
    maxOutputTokens: 60,
    providerOptions: NO_THINKING,
    abortSignal: AbortSignal.timeout(20_000),
  });
  return text;
}

export async function photosOf(userId: string): Promise<PhotoRef[]> {
  const rows = await sql`select id from photos where user_id = ${userId} order by created_at`;
  return rows.map((r) => ({ id: r.id as string, url: photoUrl(r.id as string) }));
}

/** userId -> their photos, for the people a view is allowed to show. */
export async function photosByUser(userIds: string[]) {
  const out = new Map<string, PhotoRef[]>();
  if (!userIds.length) return out;
  const rows = await sql`select id, user_id from photos where user_id = any(${userIds}::uuid[]) order by created_at`;
  for (const r of rows) {
    const list = out.get(r.user_id as string) ?? [];
    list.push({ id: r.id as string, url: photoUrl(r.id as string) });
    out.set(r.user_id as string, list);
  }
  return out;
}

/** Cleans, checks and stores one photo. Throws PhotoError (with a message for the person) when it is refused. */
export type PhotoSource = "upload" | "x" | "google";

export async function addPhoto(userId: string, bytes: Uint8Array, source: PhotoSource, origin = "") {
  const avatar = source !== "upload"; // one per source: replaced, not added
  const [{ n }] = await sql`select count(*)::int as n from photos where user_id = ${userId} and source <> ${avatar ? source : "none"}`;
  if (n >= MAX_PHOTOS) throw new PhotoError(`You can have up to ${MAX_PHOTOS} photos. Delete one first.`, 409);
  const img = await toCleanJpeg(bytes, avatar ? X_AVATAR_MAX_PX : UPLOAD_MAX_PX);
  const verdict = await moderate(visionCheck, img.data);
  if (!verdict.ok) throw new PhotoError(verdict.reason, 422);
  const pathname = `p/${randomUUID()}/${randomUUID()}.jpg`;
  await put(pathname, img.data, { access: "private", contentType: "image/jpeg", addRandomSuffix: false });
  if (avatar) await deletePhotos(userId, source);
  await sql`insert into photos (user_id, pathname, source, origin, width, height) values (${userId}, ${pathname}, ${source}, ${origin}, ${img.width}, ${img.height})`;
  return photosOf(userId);
}

/** Deletes one photo (only the owner's), all of a source, or all of a user's photos (blob files too). */
export async function deletePhotos(userId: string, which: "all" | "x" | "google" | { id: string }) {
  const rows = which === "all"
    ? await sql`delete from photos where user_id = ${userId} returning pathname`
    : typeof which === "string"
      ? await sql`delete from photos where user_id = ${userId} and source = ${which} returning pathname`
      : await sql`delete from photos where user_id = ${userId} and id = ${which.id} returning pathname`;
  // A file that fails to go now is retried by the daily job (lib/deletion-jobs.ts): never left behind.
  const files = rows.map((r) => r.pathname as string);
  if (files.length) await del(files).catch((e) => queueDeletions("blob", files, e));
  return rows.length;
}

// Their own X avatar: fxtwitter first, unavatar as fallback. Only these hosts are fetched (no open fetches).
const AVATAR_HOSTS = new Set(["pbs.twimg.com", "unavatar.io"]);
async function fetchImage(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow", headers: { "user-agent": "agent-dates/1.0" } });
  if (!res.ok || !AVATAR_HOSTS.has(new URL(res.url).hostname)) return null;
  if (Number(res.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength && buf.byteLength <= PHOTO_MAX_BYTES ? buf : null;
}

async function xAvatar(handle: string) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  try {
    const r = await fetch(`https://api.fxtwitter.com/${handle}`, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "agent-dates/1.0" } });
    const url = r.ok ? ((await r.json()) as { user?: { avatar_url?: string } }).user?.avatar_url : undefined;
    if (url && new URL(url).hostname === "pbs.twimg.com") {
      const img = await fetchImage(url.replace(/_normal(\.[a-z]+)$/i, "_400x400$1"));
      if (img) return img;
    }
  } catch {
    // fall through to unavatar
  }
  try {
    return await fetchImage(`https://unavatar.io/x/${handle}?fallback=false`);
  } catch {
    return null;
  }
}

/** After sign-up or edit: the X photo follows the person's own opt-in (added, replaced on a new handle, or removed). */
export async function syncXPhoto(userId: string) {
  const [u] = await sql`select x_handle, use_x_photo from users where id = ${userId}`;
  if (!u) return;
  const handle = u.x_handle as string;
  if (!u.use_x_photo || !handle) {
    if (await deletePhotos(userId, "x")) await logActivity(userId, SYSTEM, "photo_remove", { source: "x" });
    return;
  }
  const [have] = await sql`select origin from photos where user_id = ${userId} and source = 'x'`;
  if (have && (have.origin as string).toLowerCase() === handle.toLowerCase()) return;
  const img = await xAvatar(handle);
  if (!img) return void console.error("x avatar not found", handle);
  try {
    const photos = await addPhoto(userId, img, "x", handle);
    await logActivity(userId, SYSTEM, "photo_upload", { photoId: photos.at(-1)?.id, source: "x" });
  } catch (e) {
    console.error("x avatar refused", e instanceof Error ? e.message : e);
  }
}

// ---- The Google sign-in picture, only on request ---------------------------------------------------------------

async function googleAvatarOf(userId: string) {
  const [r] = await sql`select au.image from auth_identities a join neon_auth."user" au on au.id::text = a.auth_user_id
    where a.user_id = ${userId} and au.image is not null order by a.created_at limit 1`;
  return googleAvatar(r?.image);
}

/**
 * Whether to offer "use your Google profile picture?" in the chat: they have no photo, their Google sign-in has a
 * picture, and they never answered (yes or no) and never removed a photo. Asked once, never repeated.
 */
export async function googlePhotoOffer(userId: string) {
  const [r] = await sql`select (select count(*)::int from photos where user_id = ${userId}) as n,
    exists(select 1 from activity_log where user_id = ${userId} and (action = 'google_photo' or action = 'photo_remove')) as asked`;
  if (!r || r.n > 0 || r.asked) return false;
  return Boolean(await googleAvatarOf(userId));
}

/**
 * Whether to ask them to add a photo at all (the chat's photo card and lines, the /home card, the match and plan cards;
 * how often is the page's, lib/photo-nudge.ts): no photo, and they never removed one or said no to their Google
 * picture, which are choices. A Google picture the check refused (a letter avatar) was not their choice: they may
 * still upload one.
 */
export async function addPhotoHint(userId: string) {
  const [r] = await sql`select not exists(select 1 from photos where user_id = ${userId})
    and not exists(select 1 from activity_log where user_id = ${userId}
      and (action = 'photo_remove' or (action = 'google_photo' and meta->>'answer' = 'no'))) as ok`;
  return Boolean(r?.ok);
}

/** The person tapped "Use it": their own Google picture, through the same check as an upload. Throws PhotoError. */
export async function addGooglePhoto(userId: string) {
  const url = await googleAvatarOf(userId);
  if (!url) throw new PhotoError("Your Google sign-in has no profile picture to use.", 404);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error", headers: { "user-agent": "agent-dates/1.0" } }).catch(() => null);
  if (!res?.ok || Number(res.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES) throw new PhotoError("Couldn't fetch your Google picture. Try again, or upload one in Profile.", 502);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > PHOTO_MAX_BYTES) throw new PhotoError("Couldn't fetch your Google picture. Try again, or upload one in Profile.", 502);
  return addPhoto(userId, bytes, "google", "google");
}
