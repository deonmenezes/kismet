import { currentUser, json, requestClient, unauthorized } from "@/lib/auth";
import { unmatch } from "@/lib/dm";
import { neonDm } from "@/lib/dm-store";
import { logActivity } from "@/lib/records";
import { dropNotices } from "@/lib/text/store";

// Ends a match for both people: it leaves both match lists and the chat closes. The other side only ever
// sees "This chat has ended." (never who ended it).
export async function POST(req: Request, ctx: RouteContext<"/api/me/matches/[matchId]/unmatch">) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const { matchId } = await ctx.params;
  const r = await unmatch(neonDm, me.id, matchId);
  if (!r.ok) return json({ error: r.error }, r.status);
  await dropNotices([matchId]);
  await logActivity(me.id, requestClient(req), "unmatch", { dateId: matchId });
  return json(r);
}
