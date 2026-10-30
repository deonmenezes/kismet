import { randomBytes, randomUUID } from "node:crypto";
import { sql, toDate, toUser, type User } from "../db";
import { autoStartDates } from "../actions";
import { cookieUser, rateLimit, tokenFrom } from "../auth";
import { contactFor, pendingRecommendations, seesPhotos, type PublicAbout } from "../views";
import { addPhotoHint, googlePhotoOffer, photosByUser } from "../photos";
import { trainingOffer } from "../training";
import { isOpenMatch, mySide, visiblePhoto } from "../secret";
import { sharedInterests } from "../match";
import { logActivity } from "../records";
import { listSignals, setSignal, type Signal } from "../signals";
import { enrichProfile } from "../engine";
import { after } from "next/server";
import { formatEvent, forInterests, localDay, villageEvents, type VillageEvent } from "../village-events";
import { deleteIdentity, identityUser, linkIdentity, sessionIdentity, type Identity } from "../identity";
import { GENDER, INTERESTED_IN, LOOKING_FOR, OPENNESS, REL_STATUS } from "../options";
import { webConsentText, flushNotices, handleInbound, pushNext, type Thread } from "./agent";
import { INTEREST_SETS, isExplicitYes, nextField, signupProgress, SKIP_CONTACT } from "./parse";
import { neonText } from "./store";
import { app, deps } from "./runtime";
import { webAdapter } from "./web";
import { holdingNow, HOLDS_LIFTED_AT, planFor, type PlanView } from "../drop";
import { WEEKLY_TITLE } from "../copy";
import { EDGE_QUESTION_EXISTING } from "../edge-city";
import { isFresh } from "../photo-nudge";

// The website's chat: the same Kismet-by-text conversation as WhatsApp (lib/text/agent.ts), keyed by who is
// signed in. A Kismet account has one web thread ("web:u:<user id>"); a Google / email identity that has no
// account yet does the interview in its own thread ("web:a:<auth user id>"), which becomes the account's thread
// once YES signs them up. Transcripts keep placeholders for anything about other residents
// ("[recommendation date:<id>]"); they are rendered here for the owner only and re-checked on every read: a name
// shows only for an open recommendation or an open match, as everywhere else (lib/secret.ts).

const WEB = { channel: "web" as const, client: "" };
const d = () => deps(webAdapter);

/**
 * me: the account (a Google / email sign-in joined to one wins over the private-link cookie).
 * connect: a private-link account in this browser that the signed-in identity may be joined to, only by an explicit POST.
 */
/** Same-origin POSTs only (a missing or opaque "null" Origin is refused, never a crash). */
export function sameOrigin(req: Request) {
  try {
    return new URL(req.headers.get("origin") ?? "").host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export type Viewer = { me: User | null; identity: Identity | null; connect: User | null };

export async function viewerFor(req?: Request): Promise<Viewer | null> {
  if (req?.headers.get("authorization")) return null; // agents use /api/me
  let identity = await sessionIdentity();
  const linked = identity ? await identityUser(identity.authUserId) : null;
  // A sign-in deleted a moment ago (with its account) may still sit in a session cache: it no longer counts.
  if (identity && !linked && !(await sql`select 1 from neon_auth."user" where id::text = ${identity.authUserId}`.catch(() => [1])).length) identity = null;
  const fromCookie = linked ? null : await cookieUser(await tokenFrom(req));
  if (!identity && !fromCookie) return null;
  // Signed in with Google / email but not joined yet: the chat stays the identity's own until they press Connect,
  // so a private link planted in this browser can't collect what they type.
  if (identity && !linked && fromCookie) return { me: null, identity, connect: fromCookie };
  return { me: linked ?? fromCookie, identity, connect: null };
}

async function threadOf(v: Viewer): Promise<Thread | null> {
  if (v.me) {
    const [r] = await sql`select phone from user_phones where channel = 'web' and user_id = ${v.me.id} order by created_at limit 1`;
    return neonText.thread("web", (r?.phone as string) ?? `web:u:${v.me.id}`);
  }
  return v.identity ? neonText.thread("web", `web:a:${v.identity.authUserId}`) : null;
}

/** The thread for this viewer, created (and greeted, once) on first use. */
async function open(v: Viewer): Promise<Thread> {
  let t = await threadOf(v);
  if (!t) t = await neonText.createThread("web", v.me ? `web:u:${v.me.id}` : `web:a:${v.identity!.authUserId}`);
  if (t.state !== "new") return t;
  if (v.me) {
    // One statement, so no request ever sees an active thread without its account.
    const [won] = await sql`update user_phones set state = 'active', user_id = ${v.me.id}, verified_at = now(), updated_at = now()
      where id = ${t.id} and state = 'new' returning id`;
    if (won) await neonText.recordOutbound(t, `Hi ${v.me.name}! I'm your Kismet agent. I'll find people worth meeting; you just say yes or no.`, null);
  } else if (await neonText.claimState(t, "new", "consent")) {
    await neonText.recordOutbound(t, webConsentText(d().site), null);
  }
  return (await neonText.thread("web", t.phone)) ?? t;
}

/** A lease like the store's lock, but never waits: a poll skips its push while a message is being answered. */
async function tryLock(t: Thread) {
  const token = randomBytes(12).toString("hex");
  const [got] = await sql`update user_phones set lock_id = ${token}, lock_until = now() + interval '30 seconds'
    where id = ${t.id} and (lock_until is null or lock_until < now()) returning id`;
  if (!got) return null;
  return async () => void (await sql`update user_phones set lock_id = null, lock_until = null where id = ${t.id} and lock_id = ${token}`);
}

/** Opening (or polling) the chat: queued notices and the next recommendation. `opened`: a page load, not a poll. */
export async function syncChat(v: Viewer, opened = false) {
  const t0 = await open(v);
  if (opened && v.me) await autoStartDates(v.me, `web:${v.me.id}`, WEB);
  if (opened && v.me && t0.state === "active" && t0.userId === v.me.id) {
    // Edge City only: an account from before that was never asked gets the question once, on its next visit (the answer
    // goes through the chat like any message, lib/text/agent.ts edgeActive). Members get the digest. The "did you meet?"
    // check-in is for everyone: a match made before Edge City only stays, whatever the answer.
    if (v.me.edgeCity === null) await askEdgeOnce(v.me, t0);
    await Promise.all([v.me.edgeCity ? digest(v.me, t0) : null, checkIn(v.me, t0)]);
  }
  if (t0.state === "active" && t0.userId) {
    const release = await tryLock(t0);
    if (release) {
      try {
        const t = (await neonText.thread("web", t0.phone)) ?? t0;
        if (t.notices.length) await flushNotices(d(), t, true);
        if (!t.pendingDateId) await pushNext(d(), t);
      } finally {
        await release();
      }
    }
  }
  return view(v);
}

/** "Are you at Edge City India?" once (a key per account for 30 days; ":<id>" last, so it goes with the account). */
async function askEdgeOnce(me: User, t: Thread) {
  if (!(await rateLimit(`edge-ask:${me.id}`, 1, 30 * 86400))) return;
  await neonText.recordOutbound(t, EDGE_QUESTION_EXISTING, null);
  // Shown: their next typed reply may answer it (lib/text/agent.ts edgeActive).
  await sql`update user_phones set draft = draft || '{"edgeAsked": true}'::jsonb, updated_at = now() where id = ${t.id}`;
}

/**
 * Once a day, on opening the chat (Agent Village's morning digest): what the agent did, what's waiting and one
 * village event that fits. Counts only, never another resident's name. Skipped on the account's first day.
 */
async function digest(me: User, t: Thread) {
  const [age] = await sql`select (min(created_at) < now() - interval '12 hours') as old from conversation_messages where phone_id = ${t.id}`;
  if (!age?.old) return;
  if (!(await rateLimit(`digest:${localDay(new Date())}:${me.id}`, 1, 2 * 86400))) return; // ":<id>" last: deleted with the account
  const [c, pending, events] = await Promise.all([digestCounts(me), pendingRecommendations(me), villageEvents(1)]);
  const pick = forInterests(events, [...me.interests, ...me.lookingFor], 1)[0];
  const lines = [
    c.dates ? `Your agent had ${c.dates} agent chat${c.dates === 1 ? "" : "s"}.` : "",
    pending.length ? `${pending.length} ${pending.length === 1 ? "person is" : "people are"} waiting for your yes or no.` : "",
    c.matches ? `${c.matches} new match${c.matches === 1 ? "" : "es"}.` : "",
    pick ? `In the village: ${formatEvent(pick)}.` : "",
  ].filter(Boolean);
  if (!lines.length) return;
  await neonText.recordOutbound(t, [`Hi ${me.name}, here's your day so far.`, ...lines].join(" "), null);
}

/**
 * The digest's numbers for the last 24 hours: dates their agent went on (either side started it; one held for a weekly
 * drop counts only once it was released or shown to them), and new open matches with someone they can still see.
 */
export async function digestCounts(me: User) {
  const [c] = await sql`select (select count(*)::int from dates where (a_id = ${me.id} or b_id = ${me.id}) and status = 'done'
        and finished_at > now() - interval '24 hours'
        and (not held or ${!holdingNow()}::boolean or finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or (case when a_id = ${me.id} then coalesce(drop_a_at, shown_a_at) else coalesce(drop_b_at, shown_b_at) end) is not null)) as dates,
      (select count(*)::int from dates d join users u on u.id = case when d.a_id = ${me.id} then d.b_id else d.a_id end
        where (d.a_id = ${me.id} or d.b_id = ${me.id}) and d.matched_at > now() - interval '24 hours' and d.chat_closed_at is null
          and u.banned_at is null and u.hidden_at is null and u.is_demo = ${me.isDemo}
          and not exists (select 1 from blocks k where (k.blocker_id = d.a_id and k.blocked_id = d.b_id) or (k.blocker_id = d.b_id and k.blocked_id = d.a_id))) as matches`;
  return { dates: c.dates as number, matches: c.matches as number };
}

/**
 * About a day after a match, ask privately whether they met (Agent Village's Rolodex: an accepted intro is not
 * proof two people met). One question per match, one per visit; the answer stays in this person's own records.
 */
async function checkIn(me: User, t: Thread) {
  const [due] = await sql`select d.id from dates d join users u on u.id = case when d.a_id = ${me.id} then d.b_id else d.a_id end
    where (d.a_id = ${me.id} or d.b_id = ${me.id}) and d.matched_at < now() - interval '20 hours' and d.chat_closed_at is null
      and u.banned_at is null and u.hidden_at is null and u.is_demo = ${me.isDemo}
      and not exists (select 1 from blocks k where (k.blocker_id = d.a_id and k.blocked_id = d.b_id) or (k.blocker_id = d.b_id and k.blocked_id = d.a_id))
      and not exists (select 1 from activity_log l where l.user_id = ${me.id} and l.action = 'checkin_asked' and l.meta->>'dateId' = d.id::text)
    order by d.matched_at limit 1`;
  if (!due) return;
  // Claimed once (two tabs opening at once ask once); the key ends with the user id, so it goes with the account.
  if (!(await rateLimit(`checkin:${due.id}:${me.id}`, 1, 30 * 86400))) return;
  await logActivity(me.id, WEB, "checkin_asked", { dateId: due.id });
  await neonText.recordOutbound(t, `[checkin date:${due.id}]`, null);
}

// Agent Village's follow-up after an intro: met, not useful, or missed.
export const CHECKIN = ["met", "not_useful", "missed"] as const;
export type CheckinAnswer = (typeof CHECKIN)[number];

/** The answer to a check-in card: private (activity log only), never told to the match. */
export async function answerCheckIn(v: Viewer, dateId: string, answer: CheckinAnswer) {
  if (!v.me) return null;
  const t = await threadOf(v);
  const [ok] = await sql`select 1 from dates d where d.id = ${dateId} and (d.a_id = ${v.me.id} or d.b_id = ${v.me.id}) and d.matched_at is not null
    and d.chat_closed_at is null
    and exists (select 1 from activity_log l where l.user_id = ${v.me.id} and l.action = 'checkin_asked' and l.meta->>'dateId' = ${dateId})
    and not exists (select 1 from activity_log l where l.user_id = ${v.me.id} and l.action = 'meeting_mark' and l.meta->>'dateId' = ${dateId})`;
  if (!ok || !t || !(await rateLimit(`checkin-answer:${dateId}:${v.me.id}`, 1, 30 * 86400))) return null;
  await logActivity(v.me.id, WEB, "meeting_mark", { dateId, answer });
  const reply = answer === "met"
    ? "Lovely! What clicked? I'll look for more people like that."
    : answer === "missed"
      ? "No worries. Message them when you're free."
      : "Thanks, they won't know. What would have made it a better fit?";
  await neonText.recordOutbound(t, reply, null);
  return view(v);
}

/** Sidebar buttons on a signal: pause, resume or drop it. */
export async function changeSignal(v: Viewer, id: string, action: "pause" | "resume" | "drop") {
  if (!v.me) return null;
  if (!(await setSignal(v.me.id, { id }, action))) return null;
  await logActivity(v.me.id, WEB, "signal_change", { action });
  const meId = v.me.id;
  after(() => enrichProfile(meId));
  return view(v);
}

/** One message from the chat box (or a tapped Yes / No / suggestion). ipKey: the salted network, for sign-up caps. */
export async function sendChat(v: Viewer, text: string, buttonId: string | null, ipKey: string) {
  const t = await open(v);
  // New accounts per network, like /api/signup: counted only on the YES that creates one.
  if (!v.me && t.state === "confirm" && isExplicitYes(text) && !(await rateLimit(`chat-signup:${ipKey}`, 20, 3600))) {
    return { limited: "Lots of sign-ups from your network right now. Try again in an hour." as const };
  }
  const outcome = await handleInbound(d(), {
    channel: "web", from: t.phone, text: text.slice(0, 2000), buttonId, providerId: `web:${randomUUID()}`, isGroup: false,
  });
  if (outcome === "deleted") {
    if (!v.me && v.identity) await deleteIdentity(v.identity.authUserId); // a sign-in that never got an account
    return { deleted: true as const };
  }
  const after = await neonText.thread("web", t.phone);
  // A fresh sign-up through this identity's interview: the identity is that account from now on.
  if (!v.me && v.identity && after?.userId) await linkIdentity(v.identity, after.userId, WEB);
  const me = v.me ?? (after?.userId ? await userById(after.userId) : null);
  return { deleted: false as const, outcome, ...(await view({ ...v, me })) };
}

/** The signed-in identity presses Connect: join it to the private-link account open in this browser. */
export async function connectAccount(v: Viewer) {
  if (!v.identity || !v.connect) return false;
  const ok = await linkIdentity(v.identity, v.connect.id, WEB);
  // Its unfinished interview thread (if any) is no longer needed.
  if (ok) await sql`delete from user_phones where channel = 'web' and phone = ${`web:a:${v.identity.authUserId}`} and user_id is null`;
  return ok;
}

async function userById(id: string) {
  const [r] = await sql`select * from users where id = ${id}`;
  return r ? toUser(r) : null;
}

// ---- Rendering --------------------------------------------------------------------------------------

export type Card =
  | { kind: "rec"; dateId: string; name: string; why: string; meetup: string; photoUrl: string | null; sharedInterests: string[]; about: PublicAbout; worldVerified: boolean; open: boolean; idea: string | null; weeklyDrop: boolean; plan: PlanView | null }
  | { kind: "match"; dateId: string; name: string; photoUrl: string | null; contact: { text: string; link: string | null }; chatUrl: string; idea: string | null; plan: PlanView | null }
  | { kind: "checkin"; dateId: string; name: string; answered: CheckinAnswer | null };
export type ChatMessage = { id: number; from: "me" | "kismet"; text: string; card?: Card; at: string };

const PLACEHOLDER = /^\[(recommendation(?: template)?|match (?:notice|template)|answer (?:meet|pass)|confirm (?:yes|no)|reprompt|stale button, reprompt|checkin) date:([0-9a-f-]{36})\]$/;

/** A village event that fits these interests (public calendar), as a meetup idea. */
const idea = (events: VillageEvent[], interests: string[]) => {
  const e = forInterests(events, interests, 1)[0];
  return e ? formatEvent(e) : null;
};

/** The dates behind these ids that involve `me`, and who on them `me` may still see (no blocks, bans or hidden people). */
async function datesContext(me: User, ids: string[]) {
  if (!ids.length) return { dates: new Map(), people: new Map() };
  const rows = (await sql`select * from dates where id = any(${ids}::uuid[]) and (a_id = ${me.id} or b_id = ${me.id})`).map(toDate);
  const otherIds = [...new Set(rows.map((x) => mySide(x, me.id).otherId))];
  const people = otherIds.length
    ? (await sql`select * from users u where u.id = any(${otherIds}::uuid[]) and u.banned_at is null and u.hidden_at is null
        and u.is_demo = ${me.isDemo}
        and not exists (select 1 from blocks k where (k.blocker_id = ${me.id} and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = ${me.id}))`).map(toUser)
    : [];
  return { dates: new Map(rows.map((x) => [x.id, x])), people: new Map(people.map((u) => [u.id, u])) };
}

const labels = (l: readonly { label: string }[]) => l.map((o) => o.label);
const optOutThird = (l: string[], optOut: string) => {
  const rest = l.filter((x) => x !== optOut);
  return [...rest.slice(0, 2), optOut, ...rest.slice(2)];
};

/** Tap-to-answer suggestions for where the conversation is. */
const EDGE_CHIPS = ["Yes, I'm here", "Yes, all 3 weeks", "No, I'm not"];

/** The first name of a Google sign-in ("Priya Sharma" -> "Priya", "Dr. Priya Rao" -> "Priya"), offered as a one-tap answer to the name question. */
export function firstNameOf(full: string | null | undefined) {
  const words = (full ?? "").normalize("NFC").trim().split(/\s+/);
  const first = words.find((w) => !/\.$/.test(w) && !/^(dr|mr|mrs|ms|mx|miss|prof|sir|dame|rev)$/i.test(w)) ?? "";
  return /^[\p{L}\p{M}][\p{L}\p{M}'-]{0,39}$/u.test(first) ? first : null;
}

function suggestions(t: Thread, pending: boolean, member: boolean, firstName: string | null = null): string[] {
  switch (t.state) {
    case "new":
    case "consent":
      return ["Yes, I agree"];
    case "confirm":
      return ["Yes", "Change my interests", "Change my bio"];
    case "delete_confirm":
      return ["DELETE", "Keep my account"];
    case "interview": {
      const f = nextField(t.draft);
      if (f === "edgeCity") return EDGE_CHIPS;
      if (f === "name") return firstName ? [firstName] : [];
      // The private opt-out is always among the first three (the chat shows three, the rest behind "More").
      if (f === "relStatus") return optOutThird(labels(REL_STATUS), "Prefer not to say");
      if (f === "openness") return optOutThird([...labels(OPENNESS), "Skip"], "Skip");
      if (f === "lookingFor") return labels(LOOKING_FOR);
      if (f === "genderInterest") return [`${GENDER[0].label}, into ${INTERESTED_IN[1].label.toLowerCase()}`, `${GENDER[1].label}, into ${INTERESTED_IN[0].label.toLowerCase()}`, "Skip", `${GENDER[2].label}, into ${INTERESTED_IN[2].label.toLowerCase()}`];
      if (f === "interests") return [...INTEREST_SETS];
      if (f === "bio") return ["Skip"];
      if (f === "contact") return [SKIP_CONTACT];
      return [];
    }
    case "active":
      // Out of the Edge City pool: the question's answers. Otherwise the next step only; the rest (events, who sees
      // what, profile, notes, help) is in the menu or a word away.
      if (!member) return EDGE_CHIPS;
      return pending ? [] : ["Meet more people", "Matches"];
    default:
      return [];
  }
}

export async function view(v: Viewer) {
  const t = await threadOf(v);
  const connect = v.connect && v.identity ? { name: v.connect.name, email: v.identity.email } : null;
  const base = { connect, email: v.identity?.email ?? null };
  if (!t) return { ...base, state: "new", progress: null as ReturnType<typeof signupProgress>, messages: [] as ChatMessage[], suggestions: [] as string[], running: 0, name: v.me?.name ?? null, newcomer: !v.me, matches: [] as SideMatch[], signals: [] as Signal[], googlePhoto: false, addPhoto: false, photoStep: false, training: false };
  const me = v.me ?? (t.userId ? await userById(t.userId) : null);
  const rows = await sql`select id, direction, text, created_at from (select * from conversation_messages where phone_id = ${t.id} order by id desc limit 120) x order by id`;
  const ids = [...new Set(rows.map((r) => PLACEHOLDER.exec(r.text as string)?.[2]).filter(Boolean) as string[])];
  const [ctx, pending, running] = me
    ? await Promise.all([datesContext(me, ids), pendingRecommendations(me), sql`select count(*)::int as n from dates where a_id = ${me.id} and status = 'running'`])
    : [{ dates: new Map(), people: new Map() }, [], [{ n: 0 }]];
  const pendingById = new Map(pending.map((p) => [p.dateId, p]));
  const openMatches = me ? [...ctx.dates.values()].filter((x) => isOpenMatch(x) && ctx.people.has(mySide(x, me.id).otherId)) : [];
  const sees = openMatches.length ? await seesPhotos(me!) : false;
  const matchPhotos = sees ? await photosByUser(openMatches.map((x) => mySide(x, me!.id).otherId)) : new Map();
  const matchesText = rows.some((r) => r.text === "[matches list]") && me ? await app.matchesText(me.id) : "";
  const checkinIds = rows.map((r) => /^\[checkin date:([0-9a-f-]{36})\]$/.exec(r.text as string)?.[1]).filter(Boolean) as string[];
  const [events, marks] = await Promise.all([
    me && (pending.length || openMatches.length) ? villageEvents(3) : Promise.resolve([] as VillageEvent[]),
    me && checkinIds.length
      ? sql`select meta->>'dateId' as id, meta->>'answer' as answer from activity_log where user_id = ${me.id} and action = 'meeting_mark' and meta->>'dateId' = any(${checkinIds}::text[])`
      : Promise.resolve([]),
  ]);
  const marked = new Map(marks.map((r) => [r.id as string, r.answer as CheckinAnswer]));

  const render = (text: string, at: string): Pick<ChatMessage, "text" | "card"> => {
    if (text === "[matches list]") return { text: matchesText || "Your matches show up here." };
    if (text === "[link code sent]") return { text: "I sent you a link code here (it is shown only once)." };
    const m = PLACEHOLDER.exec(text);
    if (!m) return { text };
    if (!me) return { text: "This one is no longer available." };
    const [, kind, dateId] = m;
    const date = ctx.dates.get(dateId);
    const other = date ? ctx.people.get(mySide(date, me.id).otherId) : null;
    // Names come only from an open recommendation (pendingRecommendations) or an open match with a visible partner.
    const rec = pendingById.get(dateId);
    const match = date && other && isOpenMatch(date) ? date : null;
    const matchCard = (): Card => ({
      kind: "match", dateId, name: other!.name, photoUrl: visiblePhoto(openMatches, me.id, other!.id, matchPhotos, sees),
      contact: { text: contactFor(other!).text, link: contactFor(other!).link }, chatUrl: `/chat/${dateId}`,
      idea: idea(events, sharedInterests(me, other!)),
      plan: planFor(date!, me.id),
    });
    if (kind === "checkin") {
      return match ? { text: `Did you and ${other!.name} meet up?`, card: { kind: "checkin", dateId, name: other!.name, answered: marked.get(dateId) ?? null } } : { text: "A check-in about a match that has since closed." };
    }
    if (kind.startsWith("recommendation")) {
      if (rec) {
        const text = rec.weeklyDrop ? `${WEEKLY_TITLE}: ${rec.name}.` : `Your agent chatted with ${rec.name}'s agent.`;
        return { text, card: { kind: "rec", ...rec, open: t.pendingDateId === dateId, idea: idea(events, rec.sharedInterests) } };
      }
      return { text: match ? `Your agent recommended ${other!.name}. You both said yes.` : "Your agent recommended someone here. You've answered." };
    }
    if (kind.startsWith("match")) return match ? { text: `You're connected with ${other!.name}!`, card: matchCard() } : { text: "A match that has since closed." };
    if (kind === "answer meet") {
      // The answer that made the match shows it; an earlier yes stays "noted" (the notice brings the match later).
      const madeIt = match && match.matchedAt && new Date(match.matchedAt).getTime() <= new Date(at).getTime() + 5000;
      return madeIt ? { text: `You're connected! You and ${other!.name} both said yes.`, card: matchCard() } : { text: "Noted, privately. You'll hear back only if they say yes too." };
    }
    if (kind === "answer pass") return { text: "Okay, I won't bring them up again. They'll never know." };
    const who = rec ? rec.name : "them";
    if (kind.startsWith("confirm")) return { text: `Just to confirm: ${kind.endsWith("yes") ? `YES to meeting ${who}` : `NO to ${who}`}? This is final. Reply YES to confirm or NO to think again.` };
    return { text: rec ? `Meet ${rec.name}? Reply YES or NO.` : "That one isn't open anymore." };
  };

  const messages: ChatMessage[] = rows.map((r) => {
    const at = new Date(r.created_at as string).toISOString();
    if (r.direction === "in") return { id: Number(r.id), from: "me", text: displayIn(r.text as string), at };
    return { id: Number(r.id), from: "kismet", ...render(r.text as string, at), at };
  });
  const open = Boolean(t.pendingDateId && pendingById.has(t.pendingDateId));
  const matches = me ? await sideMatches(me) : [];
  // Asked once, only if they have no photo and their Google sign-in has a picture (lib/photos.ts).
  const googlePhoto = me && t.state === "active" ? await googlePhotoOffer(me.id).catch(() => false) : false;
  // May they be asked to add a photo (no photo of their own, never removed one or said no to the Google picture)? Where
  // and how often is the page's (lib/photo-nudge.ts). A failed check asks nothing.
  const addPhoto = me && t.state === "active" ? await addPhotoHint(me.id).catch(() => false) : false;
  return {
    ...base, state: t.state, messages, running: Number(running[0]?.n ?? 0), name: me?.name ?? null, newcomer: !me, matches,
    // Signing up: "Step 3 of 8" (agreeing, the questions this draft gets, the recap's YES).
    progress: me ? null : signupProgress(t.draft, t.state),
    suggestions: suggestions(t, open, !me || me.edgeCity === true, firstNameOf(v.identity?.name)).filter((s) => s !== "Matches" || matches.length > 0),
    signals: me ? await listSignals(me.id, true) : [],
    googlePhoto,
    addPhoto,
    // Just signed up (a day at most): the chat offers the photo step after "You're in!".
    photoStep: Boolean(addPhoto && me && isFresh(me.createdAt, Date.now())),
    // Asked once, after 90 minutes of use (lib/training.ts); the page never shows it beside the photo card, which can be
    // skipped without an answer, so an unanswered Google picture question doesn't hold it back. Only with their own
    // Google / email sign-in here: a yes needs it (api/me/training). A failed check just doesn't ask.
    training: me && v.identity && t.state === "active" ? await trainingOffer(me.id).catch(() => false) : false,
  };
}

/**
 * Just what the chats sidebar shows (a match chat page has no Kismet conversation to load). Read only: unlike
 * syncChat, nothing is sent, released or marked shown.
 */
export async function sideView(v: Viewer) {
  const me = v.me;
  const [matches, signals, running] = me
    ? await Promise.all([sideMatches(me), listSignals(me.id, true), sql`select count(*)::int as n from dates where a_id = ${me.id} and status = 'running'`])
    : [[] as SideMatch[], [] as Signal[], [{ n: 0 }]];
  return { name: me?.name ?? null, email: v.identity?.email ?? null, matches, signals, running: Number(running[0]?.n ?? 0) };
}
export type SideView = Awaited<ReturnType<typeof sideView>>;

/** last: a short preview of the newest message ("You: ...", "Kismet: ..."), null before anyone wrote. photoUrl: as on their match card. */
export type SideMatch = { dateId: string; name: string; unread: boolean; last: string | null; photoUrl: string | null };

/** Open matches with a visible partner (the sidebar), newest first: the same filter as MATCHES. */
async function sideMatches(me: User): Promise<SideMatch[]> {
  const rows = await sql`select d.id, d.a_id, d.b_id, d.status, d.verdict_a, d.verdict_b, d.decision_a, d.decision_b, d.matched_at, d.chat_closed_at, d.created_at,
      u.name as other_name, (case when d.a_id = ${me.id} then d.read_a else d.read_b end) <
      (select coalesce(max(m.id), 0) from messages m where m.date_id = d.id and m.sender_id <> ${me.id} and m.kind = 'human') as unread,
      (select json_build_object('text', left(m.text, 80), 'mine', m.sender_id = ${me.id}, 'kind', m.kind) from messages m where m.date_id = d.id order by m.id desc limit 1) as last
    from dates d join users u on u.id = case when d.a_id = ${me.id} then d.b_id else d.a_id end
    where (d.a_id = ${me.id} or d.b_id = ${me.id}) and d.matched_at is not null and d.chat_closed_at is null
      and u.banned_at is null and u.hidden_at is null and u.is_demo = ${me.isDemo}
      and not exists (select 1 from blocks k where (k.blocker_id = d.a_id and k.blocked_id = d.b_id) or (k.blocker_id = d.b_id and k.blocked_id = d.a_id))
    order by d.matched_at desc limit 30`.catch(() => null);
  const preview = (l: { text: string; mine: boolean; kind: string } | null) =>
    !l ? null : l.kind === "agent" ? `Kismet: ${l.text}` : l.mine ? `You: ${l.text}` : l.text;
  const dates = (rows ?? []).map(toDate);
  // Photos as everywhere else (secret.ts visiblePhoto): an open match, and only once this account sees photos at all.
  const sees = dates.length ? await seesPhotos(me).catch(() => false) : false;
  const photos = sees ? await photosByUser(dates.map((d) => mySide(d, me.id).otherId)).catch(() => new Map()) : new Map();
  return (rows ?? []).map((r, i) => {
    const otherId = mySide(dates[i], me.id).otherId;
    return { dateId: r.id as string, name: r.other_name as string, unread: Boolean(r.unread), last: preview(r.last as never), photoUrl: visiblePhoto(dates, me.id, otherId, photos, sees) };
  });
}

/** A tapped Yes / No is stored as its text ("Yes"); a bare button id (no text) reads as the answer. */
const displayIn = (text: string) => {
  const b = /^kismet:(yes|no):/.exec(text);
  return b ? (b[1] === "yes" ? "Yes" : "No") : text;
};

export type ChatView = Awaited<ReturnType<typeof view>>;
