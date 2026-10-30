import { after } from "next/server";
import { currentUser, json, requestClient, unauthorized } from "@/lib/auth";
import { readMessages, sendMessage } from "@/lib/dm";
import { neonDm } from "@/lib/dm-store";
import { logActivity } from "@/lib/records";
import { agentTurn } from "@/lib/match-agents";

// Direct messages with a match. GET ?after=<last message id> polls new messages (and marks them read).
// POST {"text": "..."} (1-1000 characters). A chat that was ended answers {"ended": true, "text": "This chat has ended."}.
export async function GET(req: Request, ctx: RouteContext<"/api/me/matches/[matchId]/messages">) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const afterId = Number(new URL(req.url).searchParams.get("after") ?? 0);
  const { matchId } = await ctx.params;
  const since = Number.isSafeInteger(afterId) ? afterId : 0;
  const r = await readMessages(neonDm, me.id, matchId, since);
  if (!r.ok) return json({ error: r.error }, r.status);
  // Apps that predate the agents don't know the "agent" flag: label those lines in the text, so an agent's line
  // never reads as if the person typed it. The website shows the agent's name itself.
  if (requestClient(req).channel !== "web") r.messages = r.messages.map((m) => (m.agent ? { ...m, text: `(Kismet) ${m.text}` } : m));
  return json(r);
}

export async function POST(req: Request, ctx: RouteContext<"/api/me/matches/[matchId]/messages">) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const body = await req.json().catch(() => null);
  const { matchId } = await ctx.params;
  const r = await sendMessage(neonDm, me.id, matchId, body);
  if (!r.ok) return json({ error: r.error }, r.status);
  // The message id only: the text lives in messages (and is purged with the conversation).
  await logActivity(me.id, requestClient(req), "message_sent", { dateId: matchId, messageId: r.message.id });
  // Kismet may step in (lib/match-agents.ts: only if both people said yes to it in this match, and usually not).
  after(() => agentTurn(matchId).catch((e) => console.error("match agents", e instanceof Error ? e.message : e)));
  return json(r, 201);
}
