import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { ADMIN_COOKIE, adminCookieOk } from "@/lib/safety";
import { deletePhotos } from "@/lib/photos";
import { BAN_NOTE, refreshReportKeys } from "@/lib/report-history";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Moderation actions from /admin (form posts). ban: hidden from everyone and cannot date. unban.
// unhide: clears an automatic hide and dismisses the open reports; an earlier account's reports that hid it
// (lib/report-history.ts) no longer count against it. dismiss: dismisses the open reports only.
export async function POST(req: Request) {
  const back = () => Response.redirect(new URL("/admin", req.url), 303);
  if (!adminCookieOk((await cookies()).get(ADMIN_COOKIE)?.value, process.env.ADMIN_KEY)) return new Response("Forbidden", { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const f = await req.formData();
  const userId = f.get("userId");
  const op = f.get("op");
  if (typeof userId !== "string" || !UUID.test(userId)) return back();
  if (op === "ban") {
    // A ban outlives a delete-and-rejoin (lib/report-history.ts): with no report behind it, the ban is recorded as one (no
    // reporter); then their contact hashes go on their reports, the Telegram they hold now included (before banned_at).
    await sql`insert into reports (reporter_id, reported_id, reason, note, status) select null, ${userId}::uuid, 'other', ${BAN_NOTE}, 'actioned'
      where exists (select 1 from users where id = ${userId} and banned_at is null) and not exists (select 1 from reports where reported_id = ${userId})`;
    await refreshReportKeys(userId);
    await sql`update users set banned_at = coalesce(banned_at, now()) where id = ${userId}`;
    await sql`update reports set status = 'actioned' where reported_id = ${userId} and status = 'open'`;
    await deletePhotos(userId, "all"); // a banned person's photos are deleted
  } else if (op === "deletephoto") {
    const photoId = f.get("photoId");
    if (typeof photoId === "string" && UUID.test(photoId)) await deletePhotos(userId, { id: photoId });
  } else if (op === "unban") {
    await sql`update users set banned_at = null where id = ${userId}`;
    await sql`delete from reports where reported_id = ${userId} and reporter_id is null and note = ${BAN_NOTE}`; // the ban's own record
  } else if (op === "unhide") {
    await sql`update users set hidden_at = null, history_reviewed_at = now() where id = ${userId}`;
    await sql`update reports set status = 'dismissed' where reported_id = ${userId} and status = 'open'`;
  } else if (op === "dismiss") {
    await sql`update reports set status = 'dismissed' where reported_id = ${userId} and status = 'open'`;
  }
  return back();
}
