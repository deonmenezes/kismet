import { currentUser, hasBearer, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { googlePhotoOffer, addGooglePhoto } from "@/lib/photos";
import { PhotoError } from "@/lib/photo-image";
import { logActivity } from "@/lib/records";

export const maxDuration = 60;

// The one-time question in the chat: POST {"use": true} adds the profile picture of your own Google sign-in as your
// photo (the same check as an upload); {"use": false} says no, and it is never offered again. Nothing is added
// without this request, and only from the person's own browser (the card's tap): never a token or an agent.
export async function POST(req: Request) {
  if (hasBearer(req)) return json({ error: "Answer this in the Kismet chat on the website." }, 403);
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`google-photo:${me.id}`, 5, 3600))) return tooMany();
  const body = await req.json().catch(() => null);
  if (typeof body?.use !== "boolean") return json({ error: 'Send {"use": true} or {"use": false}.' }, 400);
  if (!(await googlePhotoOffer(me.id))) return json({ ok: true, offered: false });
  const c = requestClient(req);
  if (!body.use) {
    await logActivity(me.id, c, "google_photo", { answer: "no" });
    return json({ ok: true, used: false });
  }
  try {
    const photos = await addGooglePhoto(me.id);
    await logActivity(me.id, c, "google_photo", { answer: "yes" });
    await logActivity(me.id, c, "photo_upload", { photoId: photos.at(-1)?.id, source: "google" });
    return json({ ok: true, used: true, photos });
  } catch (e) {
    if (!(e instanceof PhotoError)) throw e;
    // A picture that isn't a clear photo of a person (Google's letter avatars) is refused: don't ask again. A check
    // that couldn't run (the model was down) is not an answer: they can try again.
    if (e.status === 422 && !/couldn't check/i.test(e.message)) await logActivity(me.id, c, "google_photo", { answer: "refused" });
    return json({ error: e.message }, e.status);
  }
}
