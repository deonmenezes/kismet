import { currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { reportDate } from "@/lib/actions";
import { GONE, parseReport } from "@/lib/safety";

// Report someone you were shown (recommendation or match): stored for review, and they are blocked for good.
export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`report:${me.id}`, 30, 3600))) return tooMany();
  const r = parseReport(await req.json().catch(() => null));
  if ("error" in r) return json({ error: r.error }, 400);
  const out = await reportDate(me, r.dateId, r.reason, r.note, requestClient(req), r.photoId);
  if (!out) return json(GONE.report, 410);
  return json(out);
}
