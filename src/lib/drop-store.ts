import { timingSafeEqual } from "node:crypto";
import { Output } from "ai";
import { sql, toDate, toUser, type DateRow, type User } from "./db";
import { rank, sharedInterests } from "./match";
import { CACHED, generateWithFallback } from "./models";
import { logActivity } from "./records";
import { SYSTEM } from "./client";
import { isOpenMatch } from "./secret";
import { pendingRecommendations } from "./views";
import { publicInterests, stripContacts } from "./contacts";
import { inPool } from "./edge-city";
import { dropAsk } from "./copy";
import {
  catchUpDrop, currentDrop, dropSchedule, dropsLeft, holdingNow, nextDropAt, parsePlan, pickDrop, PLAN_INSTRUCTIONS, planPrompt, planSchema, planSlot, planFor, runDrop,
  seedOf, templatePlan, venuesFor, weeklyDropOn, type DatePlan, type Drop, type PlanInput, type ReleaseIO,
} from "./drop";

// The weekly drop against Neon (the rules and the order of the steps are in lib/drop.ts): claim one drop per person per
// drop time, write the plans, release and push each person, and read a person's current drop for GET /api/me/drop.
// Idempotent: the drop_claims row (primary key user + drop time) is the claim, and a retry finishes what a crash left open.

/** The cron routes' guard: Vercel sends Authorization: Bearer $CRON_SECRET. */
export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PLAN_TIMEOUT_MS = 20_000;
/** Expected time of one push (WhatsApp send or web transcript row), for the time budget. */
const PUSH_MS = 2_000;
const CONCURRENCY = 6;

/** The model's plan through the usual chain (lib/models.ts), validated; the template on any failure or timeout. */
async function writePlan(input: PlanInput, useModel: boolean): Promise<DatePlan> {
  if (!useModel) return templatePlan(input);
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      generateWithFallback("date plan", {
        instructions: { role: "system", content: PLAN_INSTRUCTIONS, providerOptions: CACHED },
        prompt: planPrompt(input),
        output: Output.object({ schema: planSchema }),
        maxOutputTokens: 200,
      }, (t) => Boolean(parsePlan(t, input)), ctl.signal),
      // The signal cancels the request in flight; the race also covers a provider that ignores it.
      new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error("timeout")); }, PLAN_TIMEOUT_MS); }),
    ]);
    return parsePlan(out.text, input) ?? templatePlan(input);
  } catch (e) {
    console.error("date plan: model failed, using the template", e instanceof Error ? e.message : e);
    return templatePlan(input);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The plan for these claimants' sides of the date, written for this drop: a side keeps a plan only if it was written for
 * this same drop (a retry, or both sides in one run); one from an earlier drop is never reused, so a plan never hints
 * that the other side got the date first. Time and template venue rotate by the date id. Only public profile lines go
 * to the model.
 */
async function ensurePlan(d: DateRow, userIds: string[], after: Date, useModel: boolean, key: string): Promise<DatePlan | null> {
  const sides = [...new Set(userIds.map((u) => (u === d.aId ? "a" : u === d.bId ? "b" : null)).filter(Boolean))] as ("a" | "b")[];
  if (!sides.length) return null;
  const kept = (side: "a" | "b") => {
    const p = side === "a" ? d.planA : d.planB;
    return p && p.dropKey === key ? p : null;
  };
  const need = sides.filter((side) => !kept(side));
  if (!need.length) return kept(sides[0]);
  const users = (await sql`select id, interests, bio, availability, area, tags, created_at from users where id in (${d.aId}, ${d.bId})`).map(toUser);
  const a = users.find((u) => u.id === d.aId);
  const b = users.find((u) => u.id === d.bId);
  if (!a || !b) return null;
  const seed = seedOf(d.id);
  const slot = planSlot(a.availability, b.availability, after, undefined, seed);
  if (!slot) return null; // no time left before the event ends: the drop goes out without a plan
  const plan: DatePlan = {
    ...(await writePlan({
      slot,
      venues: venuesFor([a.area, b.area], slot.part),
      // Scrubbed again at read time (a bio stored before stripContacts caught a form, QA2 N-L7).
      one: { interests: publicInterests(a.interests), about: stripContacts(a.bio) },
      two: { interests: publicInterests(b.interests), about: stripContacts(b.bio) },
      shared: sharedInterests(a, b),
      seed,
    }, useModel)),
    dropKey: key,
  };
  // A side's plan for this drop is written once (a concurrent run's plan, if first, is kept).
  const json = JSON.stringify(plan);
  const [r] = await sql`update dates set
      plan_a = case when ${need.includes("a")} and (plan_a is null or plan_a->>'dropKey' is distinct from ${key}) then ${json}::jsonb else plan_a end,
      plan_b = case when ${need.includes("b")} and (plan_b is null or plan_b->>'dropKey' is distinct from ${key}) then ${json}::jsonb else plan_b end
    where id = ${d.id} returning plan_a, plan_b`;
  return ((need[0] === "a" ? r?.plan_a : r?.plan_b) as DatePlan | null) ?? plan;
}

/**
 * Candidates for this person's drop: their own agent said meet, unanswered, not released to them, not closed, finished
 * in the pool; both Edge City members (lib/edge-city.ts); the other person visible to them (not banned or hidden, no
 * block either way, same side of the demo line: the same conditions as db.ts poolOthers). One query, only the columns ranking needs (similarity then uses shared interests, not
 * embeddings), so a pick costs the same however big the village is.
 */
async function pickFor(userId: string, drop: Drop) {
  const [meRow] = await sql`select id, rel_status, openness, gender, interested_in, looking_for, interests, tags, world_verified_at, created_at
    from users where id = ${userId} and edge_city and banned_at is null and hidden_at is null`;
  if (!meRow) return null;
  // Only the columns ranking needs: no transcript, plan or embeddings.
  const rows = await sql`select d.id, d.a_id, d.b_id, d.mode, d.status, d.verdict_a, d.verdict_b, d.decision_a, d.decision_b, d.matched_at,
      d.finished_at, d.chat_closed_at, d.created_at, d.held, d.drop_a_at, d.drop_b_at, u.id as o_id, u.rel_status as o_rel_status, u.openness as o_openness, u.gender as o_gender,
      u.interested_in as o_interested_in, u.looking_for as o_looking_for, u.interests as o_interests, u.tags as o_tags,
      u.world_verified_at as o_world_verified_at, u.created_at as o_created_at
    from dates d join users u on u.id = case when d.a_id = ${userId} then d.b_id else d.a_id end
    where (d.a_id = ${userId} or d.b_id = ${userId}) and d.status = 'done' and d.chat_closed_at is null
      and d.finished_at > ${drop.from.toISOString()}::timestamptz and d.finished_at <= ${drop.to.toISOString()}::timestamptz
      and ((d.a_id = ${userId} and (d.verdict_a->>'meet')::boolean and d.decision_a is null and d.drop_a_at is null)
        or (d.b_id = ${userId} and (d.verdict_b->>'meet')::boolean and d.decision_b is null and d.drop_b_at is null))
      and u.edge_city and u.banned_at is null and u.hidden_at is null and u.is_demo = (select m.is_demo from users m where m.id = ${userId})
      and not exists (select 1 from blocks k where (k.blocker_id = ${userId} and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = ${userId}))`;
  if (!rows.length) return null;
  const me: User = toUser(meRow);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const other = (r: any): User => toUser({
    id: r.o_id, rel_status: r.o_rel_status, openness: r.o_openness, gender: r.o_gender, interested_in: r.o_interested_in,
    looking_for: r.o_looking_for, interests: r.o_interests, tags: r.o_tags, world_verified_at: r.o_world_verified_at, created_at: r.o_created_at,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const ranked = rank(me, rows.map(other), rows.map(toDate)).filter((r) => r.date);
  return pickDrop(me.id, ranked.map((r) => ({ date: r.date!, score: r.score, visible: true })), drop)?.id ?? null;
}

const claimOf = (rows: Record<string, unknown>[]) => ({ dateId: (rows[0]?.date_id as string | null) ?? null });

/** The Neon side of a drop run (lib/drop.ts runDrop). */
const releaseIO: ReleaseIO = {
  async claim(userId, key) {
    const rows = await sql`select date_id from drop_claims where user_id = ${userId} and drop_at = ${key}::timestamptz`;
    return rows.length ? claimOf(rows) : undefined;
  },
  async insertClaim(userId, key, dateId) {
    await sql`insert into drop_claims (user_id, drop_at, date_id) values (${userId}, ${key}::timestamptz, ${dateId}) on conflict (user_id, drop_at) do nothing`;
    return claimOf(await sql`select date_id from drop_claims where user_id = ${userId} and drop_at = ${key}::timestamptz`);
  },
  async replaceClaim(userId, key, oldDateId, dateId) {
    // The old claim may already be gone with its date (ON DELETE CASCADE): then this is the person's claim.
    await sql`insert into drop_claims (user_id, drop_at, date_id) values (${userId}, ${key}::timestamptz, ${dateId})
      on conflict (user_id, drop_at) do update set date_id = excluded.date_id where drop_claims.date_id = ${oldDateId}`;
    return claimOf(await sql`select date_id from drop_claims where user_id = ${userId} and drop_at = ${key}::timestamptz`);
  },
  pick: pickFor,
  async state(userId, dateId) {
    const [r] = await sql`select (case when d.a_id = ${userId} then d.drop_a_at else d.drop_b_at end) is not null as released,
        (d.status = 'done' and d.chat_closed_at is null and (case when d.a_id = ${userId} then d.decision_a else d.decision_b end) is null
          and me.banned_at is null and me.hidden_at is null and u.banned_at is null and u.hidden_at is null and me.is_demo = u.is_demo
          and me.edge_city and u.edge_city
          and not exists (select 1 from blocks k where (k.blocker_id = me.id and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = me.id))) as open
      from dates d join users me on me.id = ${userId} join users u on u.id = case when d.a_id = ${userId} then d.b_id else d.a_id end
      where d.id = ${dateId} and (d.a_id = ${userId} or d.b_id = ${userId})`;
    return !r ? "gone" : r.released ? "released" : r.open ? "releasable" : "gone";
  },
  async plan(dateId, userIds, after, useModel, key) {
    const [row] = await sql`select * from dates where id = ${dateId}`;
    return row ? ensurePlan(toDate(row), userIds, after, useModel, key) : null;
  },
  async release(userId, dateId) {
    const rows = await sql`update dates set drop_a_at = case when a_id = ${userId} then coalesce(drop_a_at, now()) else drop_a_at end,
        drop_b_at = case when b_id = ${userId} then coalesce(drop_b_at, now()) else drop_b_at end
      where id = ${dateId} and ((a_id = ${userId} and drop_a_at is null and decision_a is null) or (b_id = ${userId} and drop_b_at is null and decision_b is null))
      returning id`;
    return rows.length > 0;
  },
  // The drop goes out like any recommendation (one open at a time, quiet hours, the 24 h window and its template).
  push: async (userId) => (await import("./text/runtime")).pushForUsers([userId]),
  log: (userId, dateId, key, plan) => logActivity(userId, SYSTEM, "weekly_drop", { dateId, dropAt: key, plan: plan?.source ?? null }),
};

/**
 * Releases the drop that is due now (lib/drop.ts currentDrop) for everyone with an eligible recommendation in its pool
 * (or a claim a crashed run left open), pushing each person as soon as theirs is out. Safe to run any number of
 * times: one drop per person per drop time. budgetMs: how long it may take before it stops starting releases (the
 * daily job's catch-up passes less, so its dates still fit the function). catchUp: only a drop whose time has come
 * (lib/drop.ts catchUpDrop), never one still in its early hour.
 */
export async function releaseWeeklyDrops(now = new Date(), budgetMs = 240_000, o: { catchUp?: boolean } = {}) {
  if (!weeklyDropOn()) return { drop: null, people: 0, released: 0, skipped: "weekly mode is off" };
  const drop = o.catchUp ? catchUpDrop(now) : currentDrop(now);
  if (!drop) return { drop: null, people: 0, released: 0, skipped: "no drop is due" };
  const [from, to] = [drop.from.toISOString(), drop.to.toISOString()];
  const rows = await sql`select distinct uid from (
      select a_id as uid from dates where status = 'done' and chat_closed_at is null and drop_a_at is null and decision_a is null
        and (verdict_a->>'meet')::boolean and finished_at > ${from}::timestamptz and finished_at <= ${to}::timestamptz
      union select b_id from dates where status = 'done' and chat_closed_at is null and drop_b_at is null and decision_b is null
        and (verdict_b->>'meet')::boolean and finished_at > ${from}::timestamptz and finished_at <= ${to}::timestamptz
    ) x where not exists (select 1 from drop_claims p where p.user_id = x.uid and p.drop_at = ${drop.key}::timestamptz)
      and exists (select 1 from users u where u.id = x.uid and u.edge_city)
    union select p.user_id from drop_claims p join dates d on d.id = p.date_id
      where p.drop_at = ${drop.key}::timestamptz and exists (select 1 from users u where u.id = p.user_id and u.edge_city)
        and ((d.a_id = p.user_id and d.drop_a_at is null) or (d.b_id = p.user_id and d.drop_b_at is null))`;
  const started = Date.now();
  const r = await runDrop(releaseIO, rows.map((x) => x.uid as string), drop, {
    clock: Date.now, deadline: started + budgetMs, concurrency: CONCURRENCY, planTimeoutMs: PLAN_TIMEOUT_MS, pushMs: PUSH_MS,
  });
  return { drop: drop.key, ...r };
}

/**
 * GET /api/me/drop: this person's latest drop (within the last 8 days). "open": waiting for their yes or no, with the
 * proposed plan; "matched": both said yes, with the confirmed plan; "answered": they answered (nothing about the
 * other side); "none": no eligible match that time. Null before their first drop.
 */
export async function dropFor(me: User, now = new Date()) {
  const r = await latestDrop(me, now);
  if (inPool(me)) return r;
  // Out of the Edge City pool (lib/edge-city.ts): no drop to show until they say they are there, except a drop that is
  // already a match (a match made before stays, with its confirmed plan). Nor a promise of the next one (QA6 Q6-L2): nothing
  // is held for them (weeklyDrop false) and there is no next drop to be the last one (lastDrop null), as schedule (QA7).
  const drop = r.drop?.status === "matched" ? r.drop : null;
  if (!("scheduleText" in r)) return { ...r, drop };
  const scheduleText = dropAsk({ answered: me.edgeCity !== null, dropsLeft: dropsLeft(now), where: "api" });
  return { ...r, drop, weeklyDrop: false, schedule: null, scheduleText, lastDrop: null, nextDropAt: null };
}

async function latestDrop(me: User, now: Date) {
  if (!weeklyDropOn()) return { weeklyDrop: false as const, drop: null };
  const next = nextDropAt(now);
  // weeklyDrop false once the last drop before the event's end has gone out (nothing is held any more). schedule: the
  // real next drop ("Saturday 31 Oct at 10 am India time (the last drop)") or "no more drops (...)", never a fixed weekday.
  const s = dropSchedule(now);
  const base = { weeklyDrop: holdingNow(now), schedule: s.label, scheduleText: s.text, lastDrop: s.last, nextDropAt: next?.toISOString() ?? null };
  // The newest claim decides, except that a newer "none" or answered one never hides an earlier drop that is still
  // waiting for their answer (QA2: Friday's "no match this time" hid Wednesday's open drop).
  const claims = await sql`select drop_at, date_id from drop_claims where user_id = ${me.id} and drop_at > now() - interval '8 days'
    order by drop_at desc limit 4`;
  if (!claims.length) return { ...base, drop: null };
  let pending: Awaited<ReturnType<typeof pendingRecommendations>> | null = null;
  const open = async () => (pending ??= await pendingRecommendations(me));
  const newest = await claimDrop(me, claims[0], open);
  if (newest?.status === "open" || newest?.status === "matched") return { ...base, drop: newest };
  for (const p of claims.slice(1)) {
    const earlier = await claimDrop(me, p, open);
    if (earlier?.status === "open") return { ...base, drop: earlier };
  }
  return { ...base, drop: newest };
}

/** One claim as this person's drop: none, open (with the plan), matched, answered; null while it is being released. */
async function claimDrop(me: User, p: Record<string, unknown>, open: () => ReturnType<typeof pendingRecommendations>) {
  const dropAt = new Date(p.drop_at as string).toISOString();
  if (!p.date_id) return { dropAt, status: "none" as const };
  const [row] = await sql`select * from dates where id = ${p.date_id as string} and (a_id = ${me.id} or b_id = ${me.id})`;
  const d = row ? toDate(row) : null;
  if (!d || !(d.aId === me.id ? d.dropAAt : d.dropBAt)) return null; // still being released
  const rec = (await open()).find((r) => r.dateId === d.id);
  if (rec) return { dropAt, status: "open" as const, ...rec };
  if (isOpenMatch(d)) {
    const otherId = d.aId === me.id ? d.bId : d.aId;
    const [o] = await sql`select u.name from users u where u.id = ${otherId} and u.banned_at is null and u.hidden_at is null and u.is_demo = ${me.isDemo}
      and not exists (select 1 from blocks k where (k.blocker_id = ${me.id} and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = ${me.id}))`;
    if (o) return { dropAt, status: "matched" as const, dateId: d.id, matchId: d.id, name: o.name as string, plan: planFor(d, me.id) };
  }
  return { dropAt, status: "answered" as const };
}
