// The website's photo upload (Profile on /home, and the chat's photo card): one picked file to POST /api/me/photo.
// Browser code.
import { shrinkPhoto } from "./photo-shrink";

export type UploadResult = { ok: true; photos: { id: string; url: string }[] } | { ok: false; error: string };

export const SAVED_TEXT = "Saved ✓ It's on your profile now.";

export async function uploadPhoto(file: File): Promise<UploadResult> {
  // A 6-12 MB phone photo is drawn smaller first: the server takes 4 MB (lib/photo-shrink.ts).
  const photo = await shrinkPhoto(file).catch(() => file);
  if (!photo) return { ok: false, error: "That photo is over 4 MB and this browser can't make it smaller. Try a JPEG or a smaller photo." };
  const form = new FormData();
  form.append("photo", photo, photo instanceof File ? photo.name : "photo.jpg");
  const res = await fetch("/api/me/photo", { method: "POST", body: form }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (res?.ok) return { ok: true, photos: data.photos ?? [] };
  return { ok: false, error: data.error ?? (res?.status === 413 ? "That photo is too big (4 MB at most). Try a smaller one." : "Upload failed. Try again.") };
}
