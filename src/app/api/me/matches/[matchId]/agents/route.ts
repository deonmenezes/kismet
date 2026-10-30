import { currentUser, json, unauthorized } from "@/lib/auth";
import { neonDm } from "@/lib/dm-store";
import { chatState } from "@/lib/dm";
import { agentsState, setAgents } from "@/lib/match-agents";

// Kismet in a match chat (lib/match-agents.ts), opt-in per match. GET: {"mine": true | false | null (not asked
// yet), "on"}; they are in only while both people said yes. POST {"on": true | false}: the person's own answer.
// The other person's answer is never returned on its own.
const notFound = () => json({ error: "No open match with that matchId." }, 404);

async function openFor(meId: string, matchId: string) {
  const d = await neonDm.date(matchId);
  return d && chatState(d, meId, await neonDm.blocked(d.aId, d.bId)) === "open";
}

export async function GET(req: Request, ctx: RouteContext<"/api/me/matches/[matchId]/agents">) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const { matchId } = await ctx.params;
  if (!(await openFor(me.id, matchId))) return notFound();
  const s = await agentsState(matchId, me.id);
  return s ? json(s) : notFound();
}

export async function POST(req: Request, ctx: RouteContext<"/api/me/matches/[matchId]/agents">) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const body = await req.json().catch(() => null);
  if (typeof body?.on !== "boolean") return json({ error: 'Send {"on": true} or {"on": false}.' }, 400);
  const { matchId } = await ctx.params;
  const s = await setAgents(matchId, me.id, body.on);
  if (!s) return notFound();
  return json(s);
}
