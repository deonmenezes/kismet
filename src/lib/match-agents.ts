import { Output } from "ai";
import { z } from "zod";
import { sql, toUser, type DateRow } from "./db";
import { neonDm } from "./dm-store";
import { chatState } from "./dm";
import { publicAbout } from "./about";
import { planFor } from "./drop";
import { stripContacts } from "./contacts";
import { noDashes } from "./copy";
import { CACHED, generateWithFallback } from "./models";
import { rateLimit } from "./auth";
import { AGENT_DAILY_CALLS, AGENT_DAILY_CAP, AGENT_INSTRUCTIONS, agentContext, shouldSpeak, type Side } from "./match-agents-core";

// Kismet in a match chat, one shared matchmaker (privacy rules and prompt: lib/match-agents-core.ts). OPT-IN per match:
// it reads and writes only while BOTH people said yes (dates.agents_a / agents_b). Every line is saved only if that is
// still true and the chat is still open, in the same statement, so a line written as someone says no is dropped.
// Lines are messages of kind 'agent': deleted with the conversation like any message.

const turn = z.object({ speak: z.boolean().describe("false if the two are chatting well and a line would interrupt"), text: z.string() });

const parses = (schema: z.ZodType) => (t: string) => {
  try {
    return schema.safeParse(JSON.parse(t)).success;
  } catch {
    return false;
  }
};
const clean = (t: string) => {
  const c = noDashes(stripContacts(t)).replace(/\s*\[removed\]\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
  return c.length >= 4 ? c : "";
};
const first = (n: string) => n.trim().split(/\s+/)[0] || n;

/** Saves one agent line only while both people still have the agents in and the chat is open. */
const insertLine = (dateId: string, owner: string, text: string) =>
  sql`insert into messages (date_id, sender_id, text, kind)
    select ${dateId}, ${owner}, ${text}, 'agent' from dates
    where id = ${dateId} and agents_a and agents_b and chat_closed_at is null and decision_a = 'meet' and decision_b = 'meet'`;

/** The person's own choice and whether the agents are in (never the other person's choice on its own). */
export async function agentsState(dateId: string, meId: string) {
  const [r] = await sql`select a_id, agents_a, agents_b from dates where id = ${dateId}`;
  if (!r) return null;
  const mine = (r.a_id === meId ? r.agents_a : r.agents_b) as boolean | null;
  return { mine, on: r.agents_a === true && r.agents_b === true };
}

/** Says yes or no for the person's own side of an open match. Null: not their open match. */
export async function setAgents(dateId: string, meId: string, on: boolean) {
  const d = await neonDm.date(dateId);
  if (!d || chatState(d, meId, await neonDm.blocked(d.aId, d.bId)) !== "open") return null;
  if (d.aId === meId) await sql`update dates set agents_a = ${on} where id = ${dateId}`;
  else await sql`update dates set agents_b = ${on} where id = ${dateId}`;
  return agentsState(dateId, meId);
}

/**
 * Maybe one Kismet line after a human message, run after the response: shouldSpeak, the daily caps, and the model's own
 * call (it stays quiet unless stepping in helps). One turn per match at a time (agents_turn_at), only while both said yes.
 */
export async function agentTurn(dateId: string) {
  const claimed = await sql`update dates set agents_turn_at = now() where id = ${dateId} and agents_a and agents_b
    and chat_closed_at is null and (agents_turn_at is null or agents_turn_at < now() - interval '90 seconds') returning id`;
  if (!claimed.length) return;
  try {
    await run(dateId);
  } finally {
    await sql`update dates set agents_turn_at = null where id = ${dateId}`;
  }
}

async function run(dateId: string) {
  const d = await neonDm.date(dateId);
  if (!d || chatState(d, d.aId, await neonDm.blocked(d.aId, d.bId)) !== "open") return;
  const [{ today }] = await sql`select count(*)::int as today from messages where date_id = ${dateId} and kind = 'agent' and created_at > now() - interval '1 day'`;
  if (today >= AGENT_DAILY_CAP) return;

  const rows = await sql`select sender_id, kind, text from messages where date_id = ${dateId} order by id desc limit 20`;
  const recent = rows.reverse().map((m) => ({
    who: (m.kind === "agent" ? "kismet" : m.sender_id === d.aId ? "a" : "b") as "a" | "b" | "kismet",
    kind: m.kind as "human" | "agent",
    text: m.text as string,
  }));
  if (!shouldSpeak(recent)) return;
  if (!(await rateLimit(`match-agent-day:${dateId}`, AGENT_DAILY_CALLS, 86400))) return; // model calls, not just lines

  const people = (await sql`select * from users where id in (${d.aId}, ${d.bId})`).map(toUser);
  const ua = people.find((u) => u.id === d.aId);
  const ub = people.find((u) => u.id === d.bId);
  if (!ua || !ub) return;
  const side = (u: typeof ua): Side => ({ firstName: first(u.name), about: publicAbout(u, d.mode) });
  // Only a plan both people already see: a confirmed one. Never a side's own verdict or proposed plan.
  const row = d as unknown as DateRow;
  const plan = row.planConfirmedAt ? planFor(row, d.aId)?.text ?? null : null;
  const agentOf = (s: "a" | "b") => (s === "a" ? ua : ub).agentName || `${(s === "a" ? ua : ub).name}'s agent`;
  const prompt = agentContext(side(ua), side(ub), { plan, dateLines: d.transcript.map((t) => `${agentOf(t.speaker)}: ${t.text}`), recent });
  const r = await generateWithFallback("match kismet turn", {
    instructions: { role: "system", content: AGENT_INSTRUCTIONS, providerOptions: CACHED }, maxOutputTokens: 200,
    output: Output.object({ schema: turn }),
    prompt: `${prompt}\nShould Kismet step in now? Usually not.`,
  }, parses(turn));
  const t = turn.parse(JSON.parse(r.text));
  // Stored under A's id (messages need a sender); kind 'agent' makes it Kismet's line for both people.
  if (t.speak && clean(t.text)) await insertLine(dateId, d.aId, clean(t.text));
}
