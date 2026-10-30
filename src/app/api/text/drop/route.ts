import { cronAuthorized, releaseWeeklyDrops } from "@/lib/drop-store";

// The weekly drop (lib/drop.ts): vercel.json "30 13 * * 3" = Wednesday 13:30 UTC = 19:00 Asia/Kolkata. On Hobby a cron
// fires anywhere in its hour (18:30-19:29 India time), so the drop may go out up to an hour early (DROP_EARLY_MS).
// Idempotent: one drop per person per drop time, so a retry or a double fire sends nothing twice. The daily job
// (/api/text/cron) catches up anyone this run missed. Vercel sends Authorization: Bearer $CRON_SECRET.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new Response("Forbidden", { status: 403 });
  return Response.json({ ok: true, ...(await releaseWeeklyDrops()) });
}
