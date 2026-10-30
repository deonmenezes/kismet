import { after } from "next/server";
import { clientIp, currentUser, requestClient, unauthorized } from "@/lib/auth";
import { autoStartDates } from "@/lib/actions";
import { meView } from "@/lib/views";
import { summaryText } from "@/lib/chat";
import { parseSince } from "@/lib/secret";
import { markShown } from "@/lib/records";

// One short plain-text block for a resident's agent to relay as-is. ?since=<ISO time>: only what is new.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const since = parseSince(new URL(req.url).searchParams.get("since"));
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  if (since === false) return new Response("since must be an ISO time, e.g. 2026-10-18T12:00:00Z", { status: 400, headers });
  const c = requestClient(req);
  await autoStartDates(me, clientIp(req), c);
  const view = await meView(me, { since });
  const text = summaryText(view);
  // The recommendations that made it into the text (it lists up to 3).
  after(() => markShown(me.id, view.recommendations.filter((r) => text.includes(r.dateId)).map((r) => r.dateId), c));
  return new Response(text, { headers });
}
