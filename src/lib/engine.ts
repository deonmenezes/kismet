import { createHash } from "node:crypto";
import { embed, Output } from "ai";
import { poolOthers, sql, toDate, toUser, transaction, type DateRow, type User } from "./db";
import { edgeOnlyText, edgePendingText, inPool } from "./edge-city";
import { SITE } from "./copy";
import { isSuspended } from "./safety";
import { label, LOOKING_FOR } from "./options";
import { rank, selectCandidates } from "./match";
import { publicInterests, stripContacts } from "./contacts";
import { DATE_INSTRUCTIONS, dateSchema, datePrompt, parseDate, writeDate, type DateInput, type Side } from "./date-writer";
import { CARD_INSTRUCTIONS, cardPrompt, parseCard } from "./persona";
import { CACHED, generateWithFallback } from "./models";
import { notesFor } from "./records";
import { staleRunning } from "./daily";
import { rateLimit } from "./auth";
import { holdingNow } from "./drop";

export const EMBED_MODEL = "openai/text-embedding-3-small";
export const DATES_PER_CLICK = 3;
export const DATES_PER_DAY = 3; // your agent finds you up to 3 people a day
const CALL_TIMEOUT_MS = 30_000;

const agentName = (u: User) => u.agentName || `${u.name}'s agent`;

function goals(u: User, mode: "romance" | "friendly") {
  return u.lookingFor
    .filter((g) => mode === "romance" || g !== "romance")
    .map((g) => label(LOOKING_FOR, g))
    .join(", ");
}

// A date sees only the persona card (+ goals, tags and the agent's voice), never the raw profile. Everything here reaches
// the other person's agent and model, so it is scrubbed again at read time (QA3 S3-1: before the card exists, the bio
// stood in for it as stored, and one saved before stripContacts caught a form went in with its contact).
export const sideOf = (u: User, mode: DateRow["mode"]): Side => ({
  name: u.name,
  agent: agentName(u),
  card: stripContacts(u.personaCard || u.bio || `${u.name} likes ${publicInterests(u.interests).join(", ")}.`),
  tags: (u.tags.length ? u.tags : publicInterests(u.interests)).slice(0, 8).map(stripContacts),
  goals: goals(u, mode),
  voice: stripContacts(u.agentPersonality),
});

const parses = (text: string) => {
  try {
    parseDate(text);
    return true;
  } catch {
    return false;
  }
};

// One date through the model chain (lib/models.ts): a reply that is not a complete date moves on to the
// next model, so writeDate's one retry is only for a reply that passed here and still failed to parse.
async function generateDate(input: DateInput, served: { model: string }) {
  const out = await generateWithFallback("date", {
    // The fixed date instructions are identical for every date: cached on Anthropic.
    instructions: { role: "system", content: DATE_INSTRUCTIONS, providerOptions: CACHED },
    prompt: datePrompt(input),
    output: Output.object({ schema: dateSchema }),
    maxOutputTokens: 1400,
  }, parses);
  served.model = out.model;
  return out.text;
}

async function loadPair(date: DateRow) {
  const users = (await sql`select * from users where id in (${date.aId}, ${date.bId})`).map(toUser);
  return [users.find((u) => u.id === date.aId), users.find((u) => u.id === date.bId)] as const;
}

export async function runDate(dateId: string) {
  // started_at: from now on a stuck date is judged by when it began generating, not when it was queued.
  const [d] = await sql`update dates set started_at = now() where id = ${dateId} and status = 'running' returning *`;
  if (!d) return;
  const date = toDate(d);
  let [a, b] = await loadPair(date);
  if (!a || !b) return;
  try {
    // Backfill: a profile without a persona card (older account, or a failed enrichment) gets one first.
    const missing = [a, b].filter((u) => !u.personaCard);
    if (missing.length) {
      await Promise.all(missing.map((u) => enrichProfile(u.id)));
      [a, b] = await loadPair(date);
      if (!a || !b) return;
    }
    const served = { model: "" };
    const input = { a: sideOf(a, date.mode), b: sideOf(b, date.mode), mode: date.mode };
    // Each agent in its own sandbox when agent boxes are on (lib/agent-box); otherwise, or if a box fails, one call.
    const boxes = await import("./agent-box");
    // Boxes for established accounts (a day old, or World ID verified): fresh throwaway accounts can't run up
    // sandbox costs; theirs are written in one call.
    const boxed = boxes.agentBoxesOn() && established(a) && established(b)
      ? await boxes.boxedDate(a.id, b.id, input, served).catch((e) => {
        console.error("agent box date failed, writing it in one call", dateId, e instanceof Error ? e.message : e);
        return null;
      })
      : null;
    const out = boxed ?? (await writeDate((i) => generateDate(i, served), input));
    // Weekly mode (lib/drop.ts): the recommendation is held for the week's drop instead of showing up now.
    await sql`update dates set status = 'done', finished_at = now(), transcript = ${JSON.stringify(out.transcript)}::jsonb,
      verdict_a = ${JSON.stringify(out.verdictA)}::jsonb, verdict_b = ${JSON.stringify(out.verdictB)}::jsonb, model = ${served.model},
      held = ${holdingNow()} where id = ${dateId}`;
    // Kismet by text: a new recommendation may be waiting for someone who only uses WhatsApp (none while held).
    await (await import("./text/runtime")).pushForUsers([a.id, b.id]).catch((e) => console.error("text push failed", e instanceof Error ? e.message : e));
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    console.error("date failed", dateId, err instanceof Error ? err.message + cause : "unknown error");
    await sql`delete from dates where id = ${dateId} and status = 'running'`;
  }
}

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export const runDates = (ids: string[], concurrency = 3) => pool(ids, concurrency, runDate);

export async function datesFor(userId: string) {
  // Dates stuck "running" (e.g. a killed function) are cleared so the pair can be retried; dates still queued
  // in a running pool are not (lib/daily.ts staleRunning).
  const running = await sql`select id, status, created_at, started_at, now() as now from dates
    where status = 'running' and created_at < now() - interval '4 minutes'`;
  const dead = running.filter((r) => staleRunning({ status: r.status, createdAt: new Date(r.created_at), startedAt: r.started_at ? new Date(r.started_at) : null }, new Date(r.now)))
    .map((r) => r.id as string);
  if (dead.length) await sql`delete from dates where id = any(${dead}::uuid[]) and status = 'running'`;
  return (await sql`select * from dates where a_id = ${userId} or b_id = ${userId} order by created_at desc`).map(toDate);
}

// "Today" is the village's day (Asia/Kolkata). A date counts for both people on it, whoever's agent started it, so
// nobody takes part in more than DATES_PER_DAY dates a day: at most 3 new people a day, as the site promises.
export async function datesToday(userId: string) {
  const [r] = await sql`select count(*)::int as n from dates where (a_id = ${userId} or b_id = ${userId})
    and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
  return r.n as number;
}

/** Of these people, the ones already on DATES_PER_DAY dates today (either side). */
async function fullToday(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await sql`select uid from (select a_id as uid from dates where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      union all select b_id from dates where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) x
    where uid = any(${ids}::uuid[]) group by uid having count(*) >= ${DATES_PER_DAY}`;
  return new Set(rows.map((r) => r.uid as string));
}

/** A day old, or World ID verified: what fresh throwaway accounts are not. */
const established = (u: User) => Boolean(u.worldVerifiedAt) || Date.now() - new Date(u.createdAt).getTime() > 86_400_000;

const pairKey = (x: string, y: string) => [x, y].sort().join(":");

// Reserve date rows for the top-ranked people not dated yet (or one specific person). Returns new date ids.
const envInt = (v: string | undefined, d: number) => (Number(v) > 0 ? Math.floor(Number(v)) : d);
// The daily cost guard for the whole site (model calls): high enough that it takes ~100 networks at their own
// 30-a-day limit to reach; set DATES_PER_DAY_GLOBAL to tune.
const GLOBAL_DATES_PER_DAY = envInt(process.env.DATES_PER_DAY_GLOBAL, 3000);
const IP_DATES_PER_DAY = envInt(process.env.DATES_PER_IP_PER_DAY, 30);

// Durable log of started dates (salted IP hash only, no user id) so caps survive account deletion.
async function logRoom(ipHash: string) {
  const [r] = await sql`select count(*)::int as total, count(*) filter (where ip_hash = ${ipHash})::int as ip
    from date_log where created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;
  return { global: GLOBAL_DATES_PER_DAY - (r.total as number), ip: IP_DATES_PER_DAY - (r.ip as number) };
}

// date_log keeps no user or thread id: cap keys that are not already a salted IP hash are hashed too.
const capHash = (key: string) => (/^[0-9a-f]{32}$/.test(key) ? key : createHash("sha256").update(`${process.env.IP_SALT ?? ""}:cap:${key}`).digest("hex").slice(0, 32));

export async function reserveDates(me: User, capKey: string, targetId?: string) {
  const ipHash = capHash(capKey);
  if (isSuspended(me)) return { ids: [], reason: "Your account is paused while we review a report. Contact support if you think this is a mistake." };
  // Edge City only (lib/edge-city.ts): no dates until they said they are there, and never with anyone who has not.
  if (!inPool(me)) return { ids: [], reason: me.edgeCity === false ? edgeOnlyText(SITE) : edgePendingText(SITE) };
  const [used, caps] = await Promise.all([datesToday(me.id), logRoom(ipHash)]);
  // The site's daily cost guard never stops established members: a flood of fresh accounts can use up only its own.
  if (caps.global <= 0 && !established(me)) return { ids: [], reason: "Lots of new sign-ups today, so new accounts start meeting people tomorrow." };
  if (caps.ip <= 0) return { ids: [], reason: "Too many agent chats from this network today. Back tomorrow!" };
  const room = Math.min(DATES_PER_CLICK, DATES_PER_DAY - used, caps.global, caps.ip);
  if (room <= 0) return { ids: [], reason: `Your agent already had ${DATES_PER_DAY} chats today. More tomorrow!` };
  const [others, dates] = await Promise.all([
    poolOthers(me.id),
    datesFor(me.id),
  ]);
  const ranked = rank(me, others, dates).filter((r) => !r.date);
  const full = await fullToday(ranked.slice(0, 60).map((r) => r.user.id));
  const fresh = ranked.filter((r) => !full.has(r.user.id));
  // Skip pointless dates (low similarity) unless the owner asked for this person by name.
  // A date asked for by name: at most one per target a day, so nobody can be singled out (or have their own daily
  // allowance used up) by a few accounts aiming at them.
  // Counted only for an eligible pick, and the same answer either way (it never tells who else asked).
  const eligible = targetId ? fresh.filter((r) => r.user.id === targetId).slice(0, 1) : selectCandidates(fresh, room);
  // One asked-for date per requester and person a day, and at most 5 for any one person: nobody can use up
  // everyone else's chance to ask for someone.
  const allowed = async () => (await rateLimit(`targeted:${me.id}:${targetId}`, 1, 86400)) && (await rateLimit(`targeted:${targetId}`, 5, 86400));
  const picks = targetId && eligible.length && !(await allowed()) ? [] : eligible;
  if (!picks.length) {
    return {
      ids: [],
      reason: targetId ? "Your agents can't chat (they already met, or it's not a fit)." : "No new people to meet right now. Check back as more residents join!",
    };
  }
  const ids: string[] = [];
  for (const p of picks) {
    // Re-checked in the insert: neither person may pass the daily cap, however many requests run at once, and a
    // demo account never dates a real resident (lib/demo.ts). The count and the insert are serialized per person by
    // transaction-scoped advisory locks (both people's, taken in id order so two inserts never deadlock): without
    // them, two concurrent inserts could each count 2 and both go in.
    const [x, y] = [me.id, p.user.id].sort();
    const results = await transaction((q) => [
      q`select pg_advisory_xact_lock(hashtext(${`dates-day:${x}`}))`,
      q`select pg_advisory_xact_lock(hashtext(${`dates-day:${y}`}))`,
      q`insert into dates (pair_key, a_id, b_id, mode)
        select ${pairKey(me.id, p.user.id)}, ${me.id}::uuid, ${p.user.id}::uuid, ${p.mode}
        where (select is_demo from users where id = ${me.id}) = (select is_demo from users where id = ${p.user.id})
          and (select edge_city from users where id = ${me.id}) and (select edge_city from users where id = ${p.user.id})
          and (select count(*) from dates where (a_id = ${me.id} or b_id = ${me.id}) and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) < ${DATES_PER_DAY}
          and (select count(*) from dates where (a_id = ${p.user.id} or b_id = ${p.user.id}) and created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) < ${DATES_PER_DAY}
        on conflict (pair_key) do nothing returning id`,
    ]);
    const rows = results[2];
    if (rows[0]) ids.push(rows[0].id as string);
  }
  if (ids.length) await sql`insert into date_log (ip_hash) select ${ipHash} from generate_series(1, ${ids.length})`;
  return { ids, reason: ids.length ? null : "Those agent chats are already happening." };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Once per profile change: one call writes the persona card + interest tags, and the profile is embedded.
// profile_hash ("<embedding text hash>:<card text hash>") skips whichever of the two did not change.
// Falls back silently (chips still drive ranking; a date backfills a missing card).
export async function enrichProfile(userId: string) {
  const [r] = await sql`select * from users where id = ${userId}`;
  if (!r) return;
  const u = toUser(r);
  // Signals (their wants, in their own words) shape both the embedding and the card: a new one changes who they meet.
  const wants = (await (await import("./signals")).listSignals(userId)).map((s) => s.text);
  const text = [
    `Interests: ${publicInterests(u.interests).join(", ")}`,
    `Here for: ${goals(u, "friendly")}`,
    wants.length ? `Looking for right now: ${wants.join("; ")}` : "",
    // The card made from this is what other people's agents read: no contact goes in (QA3 S3-1).
    stripContacts(u.bio),
    stripContacts(u.agentProfile),
  ].filter(Boolean).join("\n");
  // Facts the person's agent learned about them (agent_notes) shape the card only, not the embedding.
  const notes = await notesFor(userId);
  const known = notes.length ? `\nWhat their agent knows about them:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
  const cardText = `Name: ${u.name}\n${text}${known}`;
  const want = [sha(`${EMBED_MODEL}\n${text}`), sha(cardText)];
  const [hadEmbed, hadCard] = (u.profileHash ?? ":").split(":");
  const needEmbed = !u.embedding || hadEmbed !== want[0];
  const needCard = !u.personaCard || hadCard !== want[1];
  if (!needEmbed && !needCard) return;
  const [card, emb] = await Promise.allSettled([
    needCard
      ? generateWithFallback("persona card", { instructions: CARD_INSTRUCTIONS, prompt: cardPrompt(cardText), maxOutputTokens: 200 },
          (t) => Boolean(parseCard(t).card)).then((res) => parseCard(res.text))
      : null,
    needEmbed
      ? embed({ model: EMBED_MODEL, value: text, providerOptions: { openai: { dimensions: 256 } }, abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
          .then((res) => res.embedding.map((x) => Math.round(x * 1e5) / 1e5))
      : null,
  ]);
  for (const f of [card, emb]) if (f.status === "rejected") console.error("enrich failed", f.reason instanceof Error ? f.reason.message : "unknown error");
  const c = card.status === "fulfilled" && card.value?.card ? card.value : null;
  const vec = emb.status === "fulfilled" ? emb.value : null;
  const hash = `${needEmbed && !vec ? "" : want[0]}:${needCard && !c ? "" : want[1]}`;
  await sql`update users set
      tags = coalesce(${c ? (c.tags.length ? c.tags : u.tags) : null}::text[], tags),
      persona_card = coalesce(${c ? stripContacts(c.card) : null}::text, persona_card),
      embedding = coalesce(${vec ? JSON.stringify(vec) : null}::jsonb, embedding),
      profile_hash = ${hash}
    where id = ${userId}`;
}
