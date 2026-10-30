import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Availability, Gender, InterestedIn, LookingFor, Openness, RelStatus } from "./options";
import { heldNow, holdingNow, HOLDS_LIFTED_AT, seedOf, type DatePlan } from "./drop";
import { stripContacts, withoutNames } from "./contacts";
import { withoutNul } from "./controls";

let client: NeonQueryFunction<false, false> | undefined;

// Every value loses its NUL characters on the way in (lib/controls.ts): Postgres refuses U+0000 in text, and a NUL that
// got past the input checks must never turn into a 500. The input checks strip the other control characters.
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  client ??= neon(process.env.DATABASE_URL!);
  return client(strings, ...values.map(withoutNul)) as Promise<Record<string, any>[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

type TxQuery = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
/**
 * Several statements in one transaction (Neon's HTTP transaction: all or nothing, in order); one row list each. READ
 * COMMITTED, pinned: each statement sees what committed before it started, so a count after an advisory lock sees the
 * rows of whoever held the lock before.
 */
export function transaction(queries: (q: TxQuery) => unknown[]) {
  client ??= neon(process.env.DATABASE_URL!);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return client.transaction((tx) => queries(((strings, ...values) => tx(strings, ...values.map(withoutNul))) as TxQuery) as any, { isolationLevel: "ReadCommitted" }) as Promise<Record<string, any>[][]>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export type User = {
  id: string;
  name: string;
  telegram: string;
  relStatus: RelStatus;
  openness: Openness | null;
  gender: Gender | null;
  interestedIn: InterestedIn | null;
  lookingFor: LookingFor[];
  interests: string[];
  bio: string;
  agentProfile: string;
  agentName: string;
  agentPersonality: string;
  publicQuotes: boolean;
  tags: string[];
  personaCard: string;
  profileHash: string | null;
  embedding: number[] | null;
  worldVerifiedAt: string | null;
  worldLevel: "orb" | "selfie" | null;
  bannedAt: string | null;
  hiddenAt: string | null;
  xHandle: string;
  useXPhoto: boolean;
  /** How a match reaches them: "telegram" (default) or "phone" (Kismet by text, only when they chose it). */
  contactMethod: "telegram" | "phone";
  contactPhone: string | null;
  /** When they are usually free for a date (the weekly drop's plan). */
  availability: Availability;
  area: string;
  /** A demo account (lib/demo.ts): only ever dates and sees other demo accounts. */
  isDemo: boolean;
  /** Edge City India member (lib/edge-city.ts): true = in the pool, false = said no, null = not asked yet. */
  edgeCity: boolean | null;
  edgeWeeks: string[];
  createdAt: string;
};

export type Verdict = {
  score: number;
  meet: boolean;
  reason: string;
  bestLine: string;
  suggestedMeetup: string;
};

export type Turn = { speaker: "a" | "b"; text: string };

export type DateRow = {
  id: string;
  aId: string;
  bId: string;
  mode: "romance" | "friendly";
  status: "running" | "done";
  transcript: Turn[];
  verdictA: Verdict | null;
  verdictB: Verdict | null;
  decisionA: "meet" | "pass" | null;
  decisionB: "meet" | "pass" | null;
  matchedAt: string | null;
  finishedAt: string | null;
  chatClosedAt: string | null;
  readA: number;
  readB: number;
  createdAt: string;
  /** Weekly drop: held until released to that side (drop_a_at / drop_b_at). Always false with weekly mode off. */
  held: boolean;
  dropAAt: string | null;
  dropBAt: string | null;
  shownAAt: string | null;
  shownBAt: string | null;
  /** Each side's proposed plan (with their drop); plan: the confirmed one, planConfirmedAt once both said yes. */
  planA: DatePlan | null;
  planB: DatePlan | null;
  plan: DatePlan | null;
  planConfirmedAt: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toUser = (r: any): User => ({
  id: r.id,
  name: r.name,
  telegram: r.telegram,
  relStatus: r.rel_status,
  openness: r.openness,
  gender: r.gender,
  interestedIn: r.interested_in,
  lookingFor: r.looking_for ?? [],
  interests: r.interests ?? [],
  bio: r.bio,
  agentProfile: r.agent_profile,
  agentName: r.agent_name,
  agentPersonality: r.agent_personality,
  publicQuotes: r.public_quotes,
  tags: r.tags ?? [],
  personaCard: r.persona_card ?? "",
  profileHash: r.profile_hash ?? null,
  embedding: r.embedding ?? null,
  worldVerifiedAt: r.world_verified_at ? new Date(r.world_verified_at).toISOString() : null,
  worldLevel: r.world_level ?? null,
  bannedAt: r.banned_at ? new Date(r.banned_at).toISOString() : null,
  hiddenAt: r.hidden_at ? new Date(r.hidden_at).toISOString() : null,
  xHandle: r.x_handle ?? "",
  useXPhoto: Boolean(r.use_x_photo),
  contactMethod: r.contact_method === "phone" ? "phone" : "telegram",
  contactPhone: r.contact_phone ?? null,
  availability: r.availability === "weekday_evenings" || r.availability === "weekends" ? r.availability : "flexible",
  area: r.area ?? "",
  isDemo: Boolean(r.is_demo),
  edgeCity: typeof r.edge_city === "boolean" ? r.edge_city : null,
  edgeWeeks: r.edge_weeks ?? [],
  createdAt: new Date(r.created_at).toISOString(),
});

export const toDate = (r: any): DateRow => ({
  id: r.id,
  aId: r.a_id,
  bId: r.b_id,
  mode: r.mode,
  status: r.status,
  transcript: r.transcript ?? [],
  verdictA: r.verdict_a,
  verdictB: r.verdict_b,
  decisionA: r.decision_a,
  decisionB: r.decision_b,
  matchedAt: r.matched_at ? new Date(r.matched_at).toISOString() : null,
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  chatClosedAt: r.chat_closed_at ? new Date(r.chat_closed_at).toISOString() : null,
  readA: Number(r.read_a ?? 0),
  readB: Number(r.read_b ?? 0),
  createdAt: new Date(r.created_at).toISOString(),
  // Nothing is held with weekly mode off, after the last drop of the event, or if it finished before holds were lifted.
  held: heldNow(Boolean(r.held), r.finished_at),
  dropAAt: r.drop_a_at ? new Date(r.drop_a_at).toISOString() : null,
  dropBAt: r.drop_b_at ? new Date(r.drop_b_at).toISOString() : null,
  shownAAt: r.shown_a_at ? new Date(r.shown_a_at).toISOString() : null,
  shownBAt: r.shown_b_at ? new Date(r.shown_b_at).toISOString() : null,
  planA: r.plan_a ?? null,
  planB: r.plan_b ?? null,
  plan: r.plan ?? null,
  planConfirmedAt: r.plan_confirmed_at ? new Date(r.plan_confirmed_at).toISOString() : null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// Everyone this user may see: not themselves, not banned or hidden, no block either way, and on the same side of the
// demo line (lib/demo.ts: demo accounts only ever see each other, real residents never see them). Their open matches
// come from here whatever the Edge City answer (a match already made stays); who may be dated or recommended is the pool.
export async function visibleOthers(meId: string) {
  return (await sql`select * from users u where u.id <> ${meId} and u.banned_at is null and u.hidden_at is null
    and u.is_demo = (select m.is_demo from users m where m.id = ${meId})
    and not exists (select 1 from blocks k where (k.blocker_id = ${meId} and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = ${meId}))`).map(toUser);
}

// The dating pool (lib/edge-city.ts): visible people (above, demo line included) who said they are at Edge City India.
// Never anyone who said no or has not answered yet.
export async function poolOthers(meId: string) {
  return (await sql`select * from users u where u.id <> ${meId} and u.edge_city and u.banned_at is null and u.hidden_at is null
    and u.is_demo = (select m.is_demo from users m where m.id = ${meId})
    and not exists (select 1 from blocks k where (k.blocker_id = ${meId} and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = ${meId}))`).map(toUser);
}

// The public counters: real Edge City residents only (no demo accounts and no one outside the pool, and no date or
// match with one).
export async function stats() {
  const [r] = await sql`
    select (select count(*) from users where edge_city and not is_demo)::int as agents,
           (select count(*) from dates d where d.status = 'done' and not exists (select 1 from users x where x.id in (d.a_id, d.b_id) and (x.is_demo or x.edge_city is not true)))::int as dates,
           (select count(*) from dates d where d.matched_at is not null and not exists (select 1 from users x where x.id in (d.a_id, d.b_id) and (x.is_demo or x.edge_city is not true)))::int as matches,
           (select count(*) from waitlist)::int as waitlist`;
  return { agents: r.agents as number, dates: r.dates as number, matches: r.matches as number, waitlist: r.waitlist as number };
}

// Public quotes: anonymous. Only friendly dates where both humans opted in; no names (the residents'
// and agents' names are removed from the line too), no handles, no private fields, the day only. No score of any
// kind: a resident knows their own agent's score, so any number built from both would give away the other side's.
// The line is picked without scores (by the date id), and a date held for a weekly drop is left out until then.
// Edge City residents only (lib/edge-city.ts): a date with someone who said no or has not answered is never on the board.
export async function boardQuotes(limit = 10) {
  const rows = await sql`
    select d.id, d.verdict_a, d.verdict_b, d.created_at,
           ua.name as a_name, ua.agent_name as a_agent, ub.name as b_name, ub.agent_name as b_agent
    from dates d join users ua on ua.id = d.a_id join users ub on ub.id = d.b_id
    where d.status = 'done' and d.mode = 'friendly' and ua.public_quotes and ub.public_quotes
      and (not d.held or ${!holdingNow()}::boolean or d.finished_at <= ${HOLDS_LIFTED_AT}::timestamptz)
      and ua.banned_at is null and ua.hidden_at is null and ub.banned_at is null and ub.hidden_at is null
      and not ua.is_demo and not ub.is_demo and ua.edge_city and ub.edge_city
      and not exists (select 1 from blocks k where (k.blocker_id = d.a_id and k.blocked_id = d.b_id) or (k.blocker_id = d.b_id and k.blocked_id = d.a_id))
    order by d.created_at desc limit ${Math.min(Math.max(limit, 1), 20)}`;
  return rows.map((r) => {
    const va = r.verdict_a as Verdict | null;
    const vb = r.verdict_b as Verdict | null;
    const best = va && vb ? (seedOf(r.id as string) % 2 ? vb : va) : (va ?? vb);
    const names = [r.a_name, r.a_agent, r.b_name, r.b_agent] as string[];
    return {
      // Model-written from user text: strip any contact detail and name that slipped into the line.
      quote: withoutNames(stripContacts(best?.bestLine ?? ""), names),
      day: new Date(r.created_at).toISOString().slice(0, 10),
    };
  }).filter((q) => q.quote);
}
