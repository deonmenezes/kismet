import { cronAuthorized } from "@/lib/drop-store";
import { unheldPushDue } from "@/lib/drop";
import { pushAllActive } from "@/lib/text/runtime";

// The un-hold push: vercel.json "0 6 * * 6" (Hobby: 06:00-06:59 UTC = 11:30-12:29 India time). After the event's last
// drop (lib/drop.ts EXTRA_DROPS, Sat 31 Oct 10:00) nothing is held from 11:00 on, so dates held until then show up at
// once; this pushes them to everyone with an active text or web chat thread today instead of at the 08:30 daily push.
// It acts only right after holding stopped (lib/drop.ts unheldPushDue); every other Saturday it does nothing. Push only:
// a thread with a recommendation already waiting gets nothing new (lib/text/agent.ts pushNext). Authorization: Bearer $CRON_SECRET.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new Response("Forbidden", { status: 403 });
  if (!unheldPushDue(new Date())) return Response.json({ ok: true, skipped: "nothing was un-held just now" });
  const pushed = await pushAllActive().catch((e) => {
    console.error("unheld push failed", e instanceof Error ? e.message : e);
    return 0;
  });
  return Response.json({ ok: true, pushedThreads: pushed });
}
