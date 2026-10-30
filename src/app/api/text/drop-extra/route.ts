import { cronAuthorized, releaseWeeklyDrops } from "@/lib/drop-store";
import { extraDropDue } from "@/lib/drop";
import { pushAllActive } from "@/lib/text/runtime";

// Extra drops (lib/drop.ts EXTRA_DROPS, the last one Saturday 31 Oct at 10:00 India time): called by hand at 10:00, and
// vercel.json "0 5 * * 6" (Hobby: 05:00-05:59 UTC = 10:30-11:29 India time) as the backup, never before the drop's time.
// Hobby allows each cron at most once a day, so this is its own weekly job; it acts only when an extra drop is due
// now (every other Saturday it does nothing). Same guard as the other crons: Authorization: Bearer $CRON_SECRET.
// After the release, everyone with an active text or web chat thread is pushed too (as the daily job does at 08:30), so a
// released date whose push failed, or anything else waiting, goes out tonight rather than the next morning.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new Response("Forbidden", { status: 403 });
  if (!extraDropDue(new Date())) return Response.json({ ok: true, skipped: "no extra drop is due" });
  const r = await releaseWeeklyDrops(new Date(), 200_000); // leaves time for the pushes below
  const pushed = await pushAllActive().catch((e) => {
    console.error("drop-extra push failed", e instanceof Error ? e.message : e);
    return 0;
  });
  return Response.json({ ok: true, ...r, pushedThreads: pushed });
}
