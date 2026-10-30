import { after } from "next/server";
import { queueDeletions } from "./deletion-jobs";
import { sql, toDate, toUser, transaction, type User } from "./db";
import { hashToken, newToken, rateLimit } from "./auth";
import { enrichProfile, reserveDates, runDates } from "./engine";
import { decideText } from "./chat";
import type { ProfileInput } from "./options";
import { isMutual, mySide } from "./secret";
import { AUTO_HIDE_REPORTERS, type ReportReason } from "./safety";
import { deletePhotos, syncXPhoto } from "./photos";
import { purgeClosedChats } from "./dm-store";
import { SYSTEM, type Client } from "./client";
import { contactOf, revealTelegram } from "./text/parse";
import { dropNotices } from "./text/store";
import { addNotes, deleteNotes, logActivity, recordProfileEdit, recordSignup } from "./records";
import { confirmPlan, holdingNow, HOLDS_LIFTED_AT, planText, type DatePlan } from "./drop";
import { inPool } from "./edge-city";
import { stripContacts } from "./contacts";
import { inputHash, screenProfile } from "./contact-check";
import { BAN_NOTE, checkReportHistory, hideKeys, hideOnHistory, keepReportsOf, reportKeys, scrubLateNotes, type Contacts } from "./report-history";

// The account actions behind both the web/agent routes (/api/signup, /api/me/*) and the
// Agent Village partner API (/api/village/*). Call them from a request (they schedule work with after()).

/**
 * Inserts a user and its records (sign-up source, consents, activity). `notes`: facts their agent already
 * knows (agent_notes). `id`: an account id chosen by the caller (the text sign-up fixes it first). Returns null
 * only when `villageResident` (a concurrent partner sign-up) or `id` (an earlier try) already has an account.
 * `demo`: an App Review demo account (lib/demo.ts), only ever from /api/signup with the server's demo key.
 * `edgeAssumed`: p.edgeCity was not answered but defaulted (lib/edge-city.ts signupEdgeCity), so edge_answered_at stays null.
 * `contacts`: the sign-up's own number or email that is not stored on the account yet (lib/report-history.ts).
 */
export async function insertUser(p: ProfileInput, c: Client, villageResident: string | null = null, notes: string[] = [], userId: string | null = null, opts: { demo?: boolean; edgeAssumed?: boolean; contacts?: Contacts } = {}) {
  // The model contact check (lib/contact-check.ts) on the profile and its notes together, at most 4 s; down, the
  // regex-scrubbed text is saved unchecked and the daily job checks it later.
  const input = inputHash(p);
  const screened = await screenProfile(p, notes.map((t) => stripContacts(t)), { label: c.channel });
  p = screened.profile;
  notes = screened.notes;
  const checkedAt = screened.checked ? new Date().toISOString() : null;
  const token = newToken();
  // Edge City (lib/edge-city.ts): Agent Village residents are members by definition; anyone else as they answered
  // (left out: not asked yet, so out of the pool until they answer).
  const edge = villageResident ? true : (p.edgeCity ?? null);
  const [row] = await sql`
    insert into users (id, token_hash, village_resident, name, telegram, rel_status, openness, gender, interested_in, looking_for,
      interests, bio, agent_profile, agent_name, agent_personality, public_quotes, tags, terms_accepted_at, x_handle, use_x_photo, availability, area, is_demo,
      edge_city, edge_weeks, edge_answered_at, contacts_checked_at, contacts_input_hash)
    values (coalesce(${userId}::uuid, gen_random_uuid()), ${hashToken(token)}, ${villageResident}, ${p.name}, ${p.telegram}, ${p.relStatus}, ${p.openness}, ${p.gender},
      ${p.interestedIn}, ${p.lookingFor}, ${p.interests}, ${p.bio}, ${p.agentProfile}, ${p.agentName}, ${p.agentPersonality},
      ${p.publicQuotes}, ${p.interests.map((s) => s.toLowerCase())}, now(), ${p.xHandle}, ${p.useXPhoto}, ${p.availability ?? "flexible"}, ${p.area ?? ""}, ${opts.demo === true},
      ${edge}, ${p.edgeWeeks ?? []}, ${edge === null || opts.edgeAssumed ? null : new Date().toISOString()}, ${checkedAt}, ${input})
    on conflict do nothing
    returning id`;
  if (!row) return null;
  const id = row.id as string;
  try {
    // First, before anything else can fail or start their dates: an earlier account with the same contact that was
    // banned or reported over the threshold hides this one pending review (lib/report-history.ts).
    await checkReportHistory(id, opts.contacts);
    await recordSignup(id, c, { lookingFor: p.lookingFor });
    if (notes.length) await addNotes(id, notes, c, { checked: screened.checked });
  } catch (e) {
    // No half-made account: a retry would find it and update it, so it would skip the history check and never start
    // its first dates. Removed, the retry is a sign-up again. Not when a concurrent retry already took it over (it
    // updated the row: that retry runs the check itself, lib/text/runtime.ts), so it never loses the account it returns.
    await sql`delete from users where id = ${id} and updated_at = created_at`.catch(() => undefined);
    throw e;
  }
  after(async () => {
    await Promise.all([enrichProfile(id), syncXPhoto(id)]);
    await purgeClosedChats();
    await sql`delete from rate_limits where expires_at < now() - interval '1 day'`;
    await sql`delete from date_log where created_at < now() - interval '3 days'`;
    await sql`delete from world_codes_used where used_at < now() - interval '1 day'`;
  });
  return { id, token };
}

const normalizeHandle = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

export async function updateProfile(id: string, p: ProfileInput, c: Client) {
  const [old] = await sql`select * from users where id = ${id}`;
  // The model contact check (lib/contact-check.ts). An area left out is the stored one, screened with the rest.
  p = { ...p, area: p.area ?? old?.area ?? undefined };
  const stored = old && { name: old.name as string, bio: old.bio as string, agentProfile: old.agent_profile as string, agentName: old.agent_name as string,
    agentPersonality: old.agent_personality as string, interests: old.interests as string[], area: old.area as string };
  let input = inputHash(p);
  let checkedAt: string | null = null;
  if (stored && old.contacts_checked_at && (input === inputHash(stored) || input === old.contacts_input_hash)) {
    // Checked already: the text saved back as stored (an edit of other fields), or the same text as submitted last time
    // (an agent or text thread sending its own copy again). The stored, checked text stays; no model call.
    p = { ...p, ...stored };
    checkedAt = new Date(old.contacts_checked_at).toISOString();
    input = old.contacts_input_hash ?? input;
  } else {
    const screened = await screenProfile(p, [], { label: id });
    p = screened.profile;
    checkedAt = screened.checked ? new Date().toISOString() : null;
  }
  await sql`update users set name = ${p.name}, telegram = ${p.telegram}, rel_status = ${p.relStatus}, openness = ${p.openness},
    gender = ${p.gender}, interested_in = ${p.interestedIn}, looking_for = ${p.lookingFor}, interests = ${p.interests},
    bio = ${p.bio}, agent_profile = ${p.agentProfile}, agent_name = ${p.agentName}, agent_personality = ${p.agentPersonality},
    public_quotes = ${p.publicQuotes}, x_handle = ${p.xHandle}, use_x_photo = ${p.useXPhoto},
    availability = coalesce(${p.availability ?? null}, availability), area = coalesce(${p.area ?? null}, area),
    edge_city = coalesce(${p.edgeCity ?? null}::boolean, edge_city), edge_weeks = coalesce(${p.edgeWeeks ?? null}::text[], edge_weeks),
    edge_answered_at = case when edge_city is distinct from coalesce(${p.edgeCity ?? null}::boolean, edge_city) then now() else edge_answered_at end,
    contacts_checked_at = ${checkedAt}, contacts_input_hash = ${input}, contacts_check_attempts = 0, updated_at = now() where id = ${id}`;
  if (old) {
    const before = toUser(old);
    // Availability, area and the Edge City answer are optional in every client: left out means unchanged, not a change to record.
    await recordProfileEdit(id, before, {
      ...p, availability: p.availability ?? before.availability, area: p.area ?? before.area,
      edgeCity: p.edgeCity ?? before.edgeCity, edgeWeeks: p.edgeWeeks ?? before.edgeWeeks,
    }, c);
    // A new Telegram: the report history check again (lib/report-history.ts).
    if (normalizeHandle(before.telegram) !== normalizeHandle(p.telegram)) await checkReportHistory(id);
  }
  after(() => Promise.all([enrichProfile(id), syncXPhoto(id)]));
}

/**
 * The answer to "Are you at Edge City India?" (lib/edge-city.ts), from any channel: saved with a profile_history row
 * when it changed. weeks: only replaced when given. A yes puts them in the pool (their agent starts dating on the next
 * visit or the daily job); a no takes them out, and their open recommendations stop showing to anyone.
 */
export async function setEdgeCity(userId: string, member: boolean, weeks: string[] | undefined, c: Client) {
  const [old] = await sql`select * from users where id = ${userId}`;
  if (!old) return null;
  const before = toUser(old);
  // The same answer again (and no new weeks): nothing changes, so nothing is written or logged. A member who never
  // answered (set by the migration or a store-app sign-up, edge_answered_at null) saying yes is recorded as their answer.
  const sameWeeks = !weeks?.length || JSON.stringify(weeks) === JSON.stringify(before.edgeWeeks);
  if (before.edgeCity === member && sameWeeks && old.edge_answered_at) return before;
  await sql`update users set edge_city = ${member}, edge_weeks = coalesce(${weeks?.length ? weeks : null}::text[], edge_weeks),
    edge_answered_at = case when edge_city is distinct from ${member} or edge_answered_at is null then now() else edge_answered_at end,
    updated_at = now() where id = ${userId}`;
  await recordProfileEdit(userId, before, { ...before, edgeCity: member, edgeWeeks: weeks?.length ? weeks : before.edgeWeeks }, c);
  await logActivity(userId, c, "edge_city", { member });
  return { ...before, edgeCity: member, edgeWeeks: weeks?.length ? weeks : before.edgeWeeks };
}

/**
 * Dates start on their own (residents never have to ask): at most once per 30 minutes per person, from
 * sign-up and from the places they show up (app opens, summaries, Agent Village status), inside the usual
 * caps (3 per India day, the daily village cap, the per-network cap). Never for suspended people.
 */
export async function autoStartDates(me: User, capKey: string, c: Client) {
  if (me.bannedAt || me.hiddenAt || !inPool(me)) return 0;
  if (!(await rateLimit(`auto-dates:${me.id}`, 1, 1800))) return 0;
  return (await startDates(me, capKey, c)).started;
}

/** Adds facts the person's agent learned about them; the persona card is rewritten with them after the response. */
export async function addAgentNotes(userId: string, texts: string[], c: Client) {
  const n = await addNotes(userId, texts, c);
  if (n) after(() => enrichProfile(userId));
  return n;
}

/** Erases one note or all of them. The persona card is cleared at once and rebuilt without them. */
export async function removeAgentNotes(userId: string, which: "all" | { id: string }, c: Client) {
  const n = await deleteNotes(userId, which, c);
  if (n) {
    await sql`update users set persona_card = '' where id = ${userId}`;
    after(() => enrichProfile(userId));
  }
  // FORGET EVERYTHING also wipes what their agent box remembered, notes or not (its card is rewritten before its next date).
  if (which === "all") {
    after(async () => (await import("./agent-box")).forgetBox(userId).catch((e) => console.error("agent box forget failed", userId, e instanceof Error ? e.message : e)));
  }
  return n;
}

/** Reserves up to 3 dates (same per-call, per-day, per-network and global caps everywhere) and runs them after the response. */
export async function startDates(me: User, capKey: string, c: Client, targetId?: string) {
  const { ids, reason } = await reserveDates(me, capKey, targetId);
  if (ids.length) {
    await logActivity(me.id, c, "dates_start", { dateIds: ids, ...(targetId ? { targeted: true } : {}) });
    after(() => runDates(ids));
  }
  const text = reason ?? `Your agent is off on ${ids.length} agent chat${ids.length > 1 ? "s" : ""}. Ask "how did it go?" in about a minute.`;
  return { started: ids.length, dateIds: ids, text };
}

/**
 * Answers one of `me`'s own agent's recommendations, privately and once (a repeat returns the first answer).
 * Null for anything that is not a recommendation to `me`: unknown, someone else's, still running, or a date
 * their own agent did not recommend (one answer for all, so nothing can be probed). The response says only
 * whether it is now a mutual match: never the other side's verdict or decision. Edge City only: no new answer (so no
 * new match) unless both are members; an answer repeated on a match made before stays as it was.
 */
export async function decideDate(me: User, dateId: string, decision: "meet" | "pass", c: Client) {
  // The plan a match would confirm (a weekly drop's proposal, moved ahead if its time passed): worked out first, so the
  // answer, matched_at and the confirmed plan are written by ONE statement. A crash can never leave a match without
  // matched_at (it would be missing from the chats list and never announced) or with an unconfirmed plan.
  const [pre] = await sql`select * from dates where id = ${dateId}`;
  const ifMutual = pre ? confirmPlan({ ...toDate(pre), decisionA: "meet", decisionB: "meet", planConfirmedAt: null }, new Date()) : null;
  const planJson = ifMutual ? JSON.stringify(ifMutual) : null;
  // In SET, columns are the values before this update: "mutual" is computed from the answers after it.
  const [row] = await sql`
    update dates set
      decision_a = case when a_id = ${me.id} and decision_a is null then ${decision} else decision_a end,
      decision_b = case when b_id = ${me.id} and decision_b is null then ${decision} else decision_b end,
      matched_at = case when matched_at is null and chat_closed_at is null and (verdict_a->>'meet')::boolean and (verdict_b->>'meet')::boolean
        and (case when a_id = ${me.id} and decision_a is null then ${decision} else decision_a end) = 'meet'
        and (case when b_id = ${me.id} and decision_b is null then ${decision} else decision_b end) = 'meet'
        then now() else matched_at end,
      plan = case when matched_at is null and chat_closed_at is null and (verdict_a->>'meet')::boolean and (verdict_b->>'meet')::boolean and plan_confirmed_at is null and ${planJson}::jsonb is not null
        and (case when a_id = ${me.id} and decision_a is null then ${decision} else decision_a end) = 'meet'
        and (case when b_id = ${me.id} and decision_b is null then ${decision} else decision_b end) = 'meet'
        then ${planJson}::jsonb else plan end,
      plan_confirmed_at = case when matched_at is null and chat_closed_at is null and (verdict_a->>'meet')::boolean and (verdict_b->>'meet')::boolean and plan_confirmed_at is null and ${planJson}::jsonb is not null
        and (case when a_id = ${me.id} and decision_a is null then ${decision} else decision_a end) = 'meet'
        and (case when b_id = ${me.id} and decision_b is null then ${decision} else decision_b end) = 'meet'
        then now() else plan_confirmed_at end
    where id = ${dateId} and status = 'done'
      and ((a_id = ${me.id} and (verdict_a->>'meet')::boolean and (not held or ${!holdingNow()}::boolean or finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or drop_a_at is not null or shown_a_at is not null))
        or (b_id = ${me.id} and (verdict_b->>'meet')::boolean and (not held or ${!holdingNow()}::boolean or finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or drop_b_at is not null or shown_b_at is not null)))
      and not exists (select 1 from blocks k where (k.blocker_id = a_id and k.blocked_id = b_id) or (k.blocker_id = b_id and k.blocked_id = a_id))
      and not exists (select 1 from users x where x.id in (a_id, b_id) and (x.banned_at is not null or x.hidden_at is not null))
      and (select x.is_demo from users x where x.id = a_id) = (select y.is_demo from users y where y.id = b_id)
      and (matched_at is not null or not exists (select 1 from users x where x.id in (a_id, b_id) and x.edge_city is not true))
    returning *, (matched_at = now()) as matched_now`;
  if (!row) return null;
  const d = toDate(row);
  // A closed match (unmatched) stays closed: answering it again never reveals the other person's contact.
  const match = isMutual(d) && !d.chatClosedAt;
  const { decision: answered, otherId } = mySide(d, me.id);
  // Logged once: the first answer (a repeat returns it again without a new row).
  const [prev] = await sql`select 1 from activity_log where user_id = ${me.id} and action = 'decision' and meta->>'dateId' = ${dateId} limit 1`;
  if (!prev) await logActivity(me.id, c, "decision", { dateId, decision: answered });
  // matched_now: this answer made the match (the statement above set matched_at), so it is announced exactly once.
  if (match && row.matched_now) {
    await Promise.all([logActivity(me.id, c, "match", { dateId }), logActivity(otherId, SYSTEM, "match", { dateId })]);
    // Kismet by text: the other person may only be reachable by WhatsApp.
    after(async () => (await import("./text/runtime")).notifyMatchByText(otherId, dateId));
  }
  const [other] = await sql`select name, telegram, contact_method, contact_phone from users where id = ${otherId}`;
  const contact = other ? contactOf({ telegram: other.telegram, contactMethod: other.contact_method, contactPhone: other.contact_phone }) : null;
  // Telegram only when that is how they chose to be reached (a phone choice blanks it).
  const reveal = match && other && contact
    ? { name: other.name as string, telegram: revealTelegram({ telegram: other.telegram, contactMethod: other.contact_method, contactPhone: other.contact_phone }), link: contact.link, contact }
    : null;
  // The confirmed plan, only on an open match (a pass or a lone yes reveals nothing about the other side).
  const plan = reveal ? await confirmedPlan(dateId) : null;
  const text = isMutual(d) && d.chatClosedAt ? "That match has closed." : decideText(other?.name ?? "them", answered!, reveal, plan ? planText(plan) : null);
  return { ok: true, decision: answered!, match, ...(reveal ? { matchWith: reveal } : {}), ...(plan ? { plan: planText(plan) } : {}), text };
}

async function confirmedPlan(dateId: string) {
  const [r] = await sql`select plan from dates where id = ${dateId} and plan_confirmed_at is not null`;
  return (r?.plan as DatePlan | null) ?? null;
}

/**
 * The other person on a date `me` was shown (their own agent recommended it: an open or answered
 * recommendation, or a match). Null for anything else, so reports and blocks cannot probe other dates, and null across
 * the demo line (lib/demo.ts: a leftover demo <-> real date is never shown, so it can't be blocked or reported either).
 */
async function shownPartner(me: User, dateId: string) {
  const [d] = await sql`select d.a_id, d.b_id from dates d
    join users o on o.id = case when d.a_id = ${me.id} then d.b_id else d.a_id end and o.is_demo = ${me.isDemo}
    where d.id = ${dateId} and d.status = 'done'
    and ((d.a_id = ${me.id} and (d.verdict_a->>'meet')::boolean and (not d.held or ${!holdingNow()}::boolean or d.finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or d.drop_a_at is not null or d.shown_a_at is not null))
      or (d.b_id = ${me.id} and (d.verdict_b->>'meet')::boolean and (not d.held or ${!holdingNow()}::boolean or d.finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or d.drop_b_at is not null or d.shown_b_at is not null)))`;
  return d ? ((d.a_id === me.id ? d.b_id : d.a_id) as string) : null;
}

/** Blocks the other person on that date, both ways and silently. A report's block can never be undone. */
export async function blockDate(me: User, dateId: string, c: Client, viaReport = false) {
  const other = await shownPartner(me, dateId);
  if (!other) return null;
  await sql`insert into blocks (blocker_id, blocked_id, date_id, via_report) values (${me.id}, ${other}, ${dateId}, ${viaReport})
    on conflict (blocker_id, blocked_id) do update set via_report = blocks.via_report or excluded.via_report`;
  // Their conversation closes for both at once ("This chat has ended": nobody is told who ended it).
  await sql`update dates set chat_closed_at = coalesce(chat_closed_at, now()) where id = ${dateId}`;
  await dropNotices([dateId]);
  await logActivity(me.id, c, "block", { dateId, ...(viaReport ? { viaReport } : {}) });
  return { ok: true, blocked: true, text: "Blocked. You won't see each other on Kismet again, and they are not told." };
}

export async function unblockDate(me: User, dateId: string, c: Client) {
  const [b] = await sql`select via_report from blocks where blocker_id = ${me.id} and date_id = ${dateId}`;
  if (!b) return null;
  if (b.via_report) return { ok: false, error: "reported", text: "You reported this person, so the block stays." };
  await sql`delete from blocks where blocker_id = ${me.id} and date_id = ${dateId}`;
  await logActivity(me.id, c, "unblock", { dateId });
  return { ok: true, blocked: false, text: "Unblocked. Your agents may meet again in future agent chats." };
}

export async function listBlocks(me: User) {
  const rows = await sql`select k.date_id, k.via_report, k.created_at, u.name from blocks k join users u on u.id = k.blocked_id
    where k.blocker_id = ${me.id} order by k.created_at desc limit 200`;
  return rows.map((r) => ({ dateId: r.date_id as string | null, name: r.name as string, reported: r.via_report as boolean, blockedAt: new Date(r.created_at).toISOString() }));
}

/** Stores a report, blocks the person for good, and hides them from everyone at AUTO_HIDE_REPORTERS distinct reporters. */
export async function reportDate(me: User, dateId: string, reason: ReportReason, note: string, c: Client, photoId: string | null = null) {
  const other = await shownPartner(me, dateId);
  if (!other) return null;
  // A report may point at one of that person's photos (only theirs).
  const [photo] = photoId ? await sql`select id from photos where id = ${photoId} and user_id = ${other}` : [];
  // With the reported person's contact hashes (lib/report-history.ts reportKeys), so the report outlives a delete-and-rejoin.
  const [rep] = await sql`insert into reports (reporter_id, reported_id, date_id, reason, note, photo_id, reported_keys)
    values (${me.id}, ${other}, ${dateId}, ${reason}, ${note}, ${photo ? photoId : null}, ${await reportKeys(other)}::text[]) returning id`;
  await logActivity(me.id, c, "report", { dateId, reportId: rep.id, reason, ...(photo ? { photoId } : {}) });
  await blockDate(me, dateId, c, true);
  // Auto-hide counts only reporters whose accounts were at least a day old when they reported (verified ones
  // whatever their age), so a handful of fresh throwaway accounts can't make someone vanish, and only reporters on the
  // same side of the demo line (lib/demo.ts): real residents can never hide a demo account (App Review's) or the
  // reverse. Reports about an earlier account with the same verified contact (deleted or not) count too, never one that
  // only shares the (unverified) Telegram (lib/report-history.ts). All reports are reviewed.
  await hideOnHistory(other, await hideKeys(other));
  return { ok: true, reported: true, blocked: true, text: "Thanks for reporting. We review every report; you won't see this person again." };
}

// Hard delete: the user row; their dates (and so their matches and messages), their World ID row (freeing
// that World ID for a new account) and all their records (consents, profile history, channels, activity
// log, agent notes) go with it via ON DELETE CASCADE, plus their per-user rate-limit rows. What remains: salted
// counters, one anonymous "delete" activity row (channel and time, no user id), reports they made (reporter_id null),
// and reports others made about them, kept 12 months with one-way contact hashes and no name or contact
// (lib/report-history.ts), so a banned or reported person can't delete and rejoin with a clean record.
export async function deleteUser(id: string, c: Client) {
  await deletePhotos(id, "all"); // the blob files too
  const dates = (await sql`select id from dates where a_id = ${id} or b_id = ${id}`).map((r) => r.id as string);
  const threads = (await sql`select id from user_phones where user_id = ${id}`).map((r) => r.id as string);
  const signIns = await sql`select auth_user_id, email from auth_identities where user_id = ${id}`;
  const identities = signIns.map((r) => r.auth_user_id as string);
  // Their waitlist entry too, when it has one of their (verified) sign-in emails, with its log row (as its removal link does).
  const emails = [...new Set(signIns.map((r) => String(r.email ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))];
  // Drop claims go with their date (ON DELETE CASCADE), so the other person is picked again in that drop; but one already
  // released to them stays (as "had its drop", date_id null): never a second drop in the same week. One transaction, so
  // a release in between can't slip past.
  const kept = await keepReportsOf(id);
  const [, , , , keptRows] = await transaction((q) => [
    q`update drop_claims p set date_id = null from dates d where p.date_id = d.id and (d.a_id = ${id} or d.b_id = ${id})
      and ((d.a_id = p.user_id and d.drop_a_at is not null) or (d.b_id = p.user_id and d.drop_b_at is not null))`,
    // Reports about them are kept (lib/report-history.ts): dismissed ones go unless they were banned, and a ban with no
    // report behind it is kept as one with no reporter; the rest keep the contact hashes, whether they were banned or
    // hidden, and the time, with notes scrubbed (keepReportsOf) and the (deleted) photo unlinked.
    q`delete from reports where reported_id = ${id} and status = 'dismissed' and not exists (select 1 from users where id = ${id} and banned_at is not null)`,
    q`insert into reports (reporter_id, reported_id, reason, note, status) select null, ${id}::uuid, 'other', ${BAN_NOTE}, 'actioned'
      where exists (select 1 from users where id = ${id} and banned_at is not null) and not exists (select 1 from reports where reported_id = ${id})`,
    q`update reports r set note = t.note from unnest(${kept?.ids ?? []}::uuid[], ${kept?.notes ?? []}::text[]) as t(id, note) where r.id = t.id and r.reported_id = ${id}`,
    q`update reports set reported_keys = array(select distinct k from unnest(reported_keys || ${kept?.keys ?? []}::text[]) as k order by k),
      reported_gone_at = now(), photo_id = null,
      reported_banned = exists (select 1 from users where id = ${id} and banned_at is not null),
      -- Hidden by their own reports (the auto-hide count), not by a match still pending review that may be wrong.
      reported_hidden = exists (select 1 from users me where me.id = ${id} and me.hidden_at is not null
        and (select count(distinct r.reporter_id) from reports r join users ru on ru.id = r.reporter_id
          where r.reported_id = me.id and r.status <> 'dismissed' and ru.is_demo = me.is_demo
            and (ru.created_at < r.created_at - interval '1 day' or ru.world_verified_at is not null)) >= ${AUTO_HIDE_REPORTERS})
      where reported_id = ${id} returning id`,
    q`delete from users where id = ${id}`,
    q`with w as (delete from waitlist where lower(email) = any(${emails}::text[]) returning id)
      delete from activity_log where user_id is null and action = 'waitlist_join' and meta->>'waitlistId' in (select id::text from w)`,
  ]);
  // A report filed between keepReportsOf and the transaction: its note is scrubbed now. (One committed between the last two
  // statements is left with no reported_gone_at, so the next daily job deletes it.)
  if (kept) await scrubLateNotes(keptRows.map((r) => r.id as string).filter((x) => !kept.ids.includes(x)), kept.names);
  // Their website sign-in too (Neon Auth's user, with its sessions and Google link), so no email stays behind; if that
  // fails now, the daily job retries it (lib/deletion-jobs.ts).
  if (identities.length) await sql`delete from neon_auth."user" where id::text = any(${identities}::text[])`.catch((e) => queueDeletions("neon_auth", identities, e));
  // Every per-user and per-thread counter ("<kind>:<id>"); queued text notices about their dates.
  await sql`delete from rate_limits where key like ${`%:${id}`} or key like any(${threads.map((t) => `%:${t}`)}::text[])`;
  await dropNotices(dates);
  await logActivity(null, c, "delete");
  // Their agent box (if Daytona is configured), with its card and memory; retried by the daily job if it fails.
  after(async () => (await import("./agent-box")).deleteBox(id).catch((e) => queueDeletions("agent_box", [id], e)));
}
