import { after } from "next/server";
import { clientIp, currentUser, json, requestClient, unauthorized } from "@/lib/auth";
import { autoStartDates } from "@/lib/actions";
import { pendingRecommendations } from "@/lib/views";
import { markShown } from "@/lib/records";

// The compact list for the iMessage extension and widgets: the people the resident's own agent recommends
// that they have not answered yet. Answer with POST /api/me/decide {"dateId", "decision": "meet" | "pass"}.
// photoUrl needs the same Authorization header.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const c = requestClient(req);
  await autoStartDates(me, clientIp(req), c);
  const recommendations = await pendingRecommendations(me);
  after(() => markShown(me.id, recommendations.map((r) => r.dateId), c));
  return json({ recommendations, count: recommendations.length });
}
