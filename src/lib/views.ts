import { sql, toDate, toUser, visibleOthers, type DateRow, type User } from "./db";
import { datesFor, datesToday, DATES_PER_DAY } from "./engine";
import { rank, sharedInterests } from "./match";
import { isNewSince, isOpenMatch, isRecommendation, matchView, mySide, recommendationView, runningStarted, visiblePhoto } from "./secret";
import { photosByUser, photosOf, type PhotoRef } from "./photos";
import { chatInfo } from "./dm-store";
import { worldConfig } from "./world";
import { verifyLink } from "./world-store";
import { contactOf, revealTelegram } from "./text/parse";
import { dropSchedule, dropsLeft, holdingNow, HOLDS_LIFTED_AT, planFor } from "./drop";
import { publicAbout } from "./about";
import { publicInterests, stripContacts } from "./contacts";
export { publicAbout, type PublicAbout } from "./about";
import { dropAsk, noDashes, SITE } from "./copy";
import { EDGE_QUESTION_PLAIN, edgeOnlyText, inPool } from "./edge-city";


/** A recommendation that came as this person's weekly drop (released to their side). */
const isDrop = (d: DateRow, meId: string) => Boolean(d.aId === meId ? d.dropAAt : d.dropBAt);

/**
 * When the next drop arrives (for the cards and agents), from the real schedule: "Saturday 31 Oct at 10 am India time (the
 * last drop)". nextDropAt null while the last drop is going out. Null with weekly mode off or once nothing is held any
 * more (after the last drop recommendations arrive as soon as they are ready).
 */
export function weeklyInfo(now = new Date()) {
  if (!holdingNow(now)) return null;
  const s = dropSchedule(now);
  return { label: s.label, nextDropAt: s.state === "upcoming" ? s.at.toISOString() : null, last: s.last };
}

/**
 * Other people's photos go only to established accounts: a day old, or verified (World ID, a WhatsApp number
 * that texted in, Agent Village; a Google / email sign-in once it is a day old). An account made a minute ago to harvest photos sees
 * none (the photo route checks the same). Their own photos are always theirs.
 */
export async function seesPhotos(me: User) {
  if (me.worldVerifiedAt || Date.now() - new Date(me.createdAt).getTime() > 86_400_000) return true;
  // A Google / email sign-in counts only once it is a day old too: a fresh one costs nothing to make.
  const [r] = await sql`select exists(select 1 from auth_identities where user_id = ${me.id} and created_at < now() - interval '1 day')
    or exists(select 1 from user_phones where user_id = ${me.id} and channel = 'whatsapp' and verified_at is not null)
    or exists(select 1 from users where id = ${me.id} and village_resident is not null) as ok`;
  return Boolean(r?.ok);
}

/** How a match reaches this person: Telegram, or their phone only when they chose it (Kismet by text). */
export const contactFor = (u: User) => contactOf({ telegram: u.telegram, contactMethod: u.contactMethod, contactPhone: u.contactPhone });

// What OTHER users see: the one-line bio or interest chips. Never the pasted agent profile. The bio is scrubbed again
// here (QA2 N-L7): one stored before stripContacts caught a form still reached recommendation cards as written.
const summary = (u: User) => (u.bio ? stripContacts(u.bio) : "") || publicInterests(u.interests).slice(0, 4).join(" · ");
const agentName = (u: User) => u.agentName || `${u.name}'s agent`;
// The badge others see: verified or not. Never which credential, never when.
const worldVerified = (u: User) => Boolean(u.worldVerifiedAt);

export function profileView(u: User) {
  return {
    name: u.name,
    telegram: u.telegram,
    relStatus: u.relStatus,
    openness: u.openness,
    gender: u.gender,
    interestedIn: u.interestedIn,
    lookingFor: u.lookingFor,
    interests: u.interests,
    bio: u.bio,
    agentProfile: u.agentProfile,
    agentName: u.agentName,
    agentPersonality: u.agentPersonality,
    publicQuotes: u.publicQuotes,
    tags: u.tags,
    xHandle: u.xHandle,
    useXPhoto: u.useXPhoto,
    availability: u.availability,
    area: u.area,
    edgeCity: u.edgeCity,
    edgeWeeks: u.edgeWeeks,
  };
}

/**
 * Where this person stands with Edge City only (lib/edge-city.ts), for apps and agents: member (in the pool), "no"
 * (waitlist) or not asked yet (ask them once: POST /api/me/edge-city). question: what to ask or tell them, else null.
 */
export function edgeCityView(u: User) {
  return {
    member: u.edgeCity === true,
    answered: u.edgeCity !== null,
    weeks: u.edgeWeeks,
    question: u.edgeCity === true ? null : u.edgeCity === false ? edgeOnlyText(SITE) : EDGE_QUESTION_PLAIN,
  };
}

// Everything one resident may see (secret double opt-in, see secret.ts): their own agent's
// recommendations, mutual matches, a count of the dates they started that are still running, and
// their agent's top pick. Never the other side's verdict or decision, never an unrecommended date.
// since (ISO time): only recommendations and matches that are new after it (agents polling for updates).
export async function meView(me: User, opts: { since?: string } = {}) {
  const world = worldConfig();
  const [dates, others, used, link] = await Promise.all([
    datesFor(me.id),
    visibleOthers(me.id), // blocked (either way), banned and hidden people vanish from every list
    datesToday(me.id),
    world ? verifyLink(world, me) : null,
  ]);
  const byId = new Map(others.map((u) => [u.id, u]));
  // Recommendations and the top pick: Edge City members only, both sides (lib/edge-city.ts). Matches already made stay.
  const member = inPool(me);
  const inPoolId = (id: string) => member && inPool(byId.get(id) ?? { edgeCity: null });
  const recDates = dates.filter((d) => isRecommendation(d, me.id) && inPoolId(mySide(d, me.id).otherId) && isNewSince(d, opts.since, me.id));
  const matchDates = dates.filter((d) => isOpenMatch(d) && byId.has(mySide(d, me.id).otherId) && isNewSince(d, opts.since, me.id));
  // Photos only of the people shown here (an open recommendation or match: secret.ts canSeePhotos), plus my own.
  const [photos, own, chats] = await Promise.all([
    seesPhotos(me).then((ok) => (ok ? photosByUser([...recDates, ...matchDates].map((d) => mySide(d, me.id).otherId)) : new Map<string, PhotoRef[]>())),
    photosOf(me.id),
    chatInfo(me.id, matchDates.map((d) => d.id)),
  ]);

  const recommendations = recDates.map((d) => {
    const o = byId.get(mySide(d, me.id).otherId)!;
    return {
      ...recommendationView(d, me.id, { name: o.name, summary: summary(o), interests: publicInterests(o.interests) }, sharedInterests(me, o)),
      weeklyDrop: isDrop(d, me.id),
      plan: planFor(d, me.id),
      worldVerified: worldVerified(o),
      photos: (photos.get(o.id) ?? []).map((p) => p.url),
    };
  }).sort((x, y) => Number(y.weeklyDrop) - Number(x.weeklyDrop)); // this week's Kismet first

  const matches = matchDates.map((d) => {
    const o = byId.get(mySide(d, me.id).otherId)!;
    const chat = chats.get(d.id);
    const contact = contactFor(o);
    // Relationship status and openness stay private, matches included. Telegram only when it is their contact.
    const mv = matchView(d, me.id, { name: o.name, agentName: agentName(o), telegram: revealTelegram({ telegram: o.telegram, contactMethod: o.contactMethod, contactPhone: o.contactPhone }) }, agentName(me));
    return {
      ...mv,
      link: contact.link ?? mv.link,
      contact,
      plan: planFor(d, me.id),
      worldVerified: worldVerified(o),
      photos: (photos.get(o.id) ?? []).map((p) => p.url),
      unread: chat?.unread ?? 0,
      lastMessage: chat?.last ?? null,
    };
  });

  // "Your agent's top recommendation": similarity plus MY agent's verdict only (match.ts rank). People
  // already dated count only while they are an open recommendation; any other dated person is left out,
  // so the pick never hints at a date this resident was not told about or the other side's answer.
  const top = member ? rank(me, others.filter(inPool), dates).find((r) => !r.date || isRecommendation(r.date, me.id)) : undefined;
  const topPick = top
    ? {
        name: top.user.name,
        summary: summary(top.user),
        sharedInterests: sharedInterests(me, top.user),
        percent: Math.round(top.score * 100),
        worldVerified: worldVerified(top.user),
        recommended: Boolean(top.date),
        dateId: top.date?.id ?? null,
        targetId: top.date ? null : top.user.id,
      }
    : null;

  return {
    since: opts.since ?? null,
    profile: { ...profileView(me), photos: own },
    // How their matches reach them (telegram, phone = WhatsApp, or app = a message in Kismet), so an app can say so.
    // The kind only: the number stays out of this view, which agents holding the token read too.
    contact: { kind: contactFor(me).kind },
    edgeCity: edgeCityView(me),
    // The drop and its time only for the pool: anyone else gets no drop until they answer, and is told so (QA6 Q6-L2).
    weekly: member ? weeklyInfo() : null,
    dropAsk: member ? null : dropAsk({ answered: me.edgeCity !== null, dropsLeft: dropsLeft(), where: "above" }),
    datesToday: used,
    datesLeftToday: Math.max(0, DATES_PER_DAY - used),
    datesPerDay: DATES_PER_DAY,
    running: runningStarted(dates, me.id),
    topPick,
    recommendations,
    matches,
    // Optional World ID badge. available=false: the feature is off (no links anywhere).
    worldId: {
      available: Boolean(world),
      verified: worldVerified(me),
      level: me.worldLevel,
      verifyLink: link?.url ?? null,
      verifyLinkExpiresAt: link?.expiresAt ?? null,
    },
  };
}

export type MeView = Awaited<ReturnType<typeof meView>>;

// GET /api/me default for agents: what they act on, nothing else (?full=1 returns the whole MeView).
// Same field names and nesting as the full view, minus the profile, transcripts and empty World ID block.
export function meCompact(me: MeView) {
  return {
    name: me.profile.name,
    datesLeftToday: me.datesLeftToday,
    running: me.running,
    recommendations: me.recommendations.map(({ dateId, name, summary, sharedInterests, myAgent, worldVerified, photos, weeklyDrop, plan }) => ({
      dateId, name, summary, sharedInterests, myAgent: { reason: myAgent.reason, suggestedMeetup: myAgent.suggestedMeetup },
      ...(worldVerified ? { worldVerified } : {}), ...(photos.length ? { photos } : {}), ...(weeklyDrop ? { weeklyDrop, plan } : {}),
    })),
    matches: me.matches.map(({ dateId, name, telegram, link, matchedAt, unread, photos, plan }) => ({
      dateId, name, telegram, link, matchedAt, unread, ...(photos.length ? { photos } : {}), ...(plan ? { plan } : {}),
    })),
    ...(me.weekly ? { weekly: me.weekly } : {}),
    topPick: me.topPick && {
      name: me.topPick.name, percent: me.topPick.percent, sharedInterests: me.topPick.sharedInterests,
      ...(me.topPick.dateId ? { dateId: me.topPick.dateId } : { targetId: me.topPick.targetId }),
    },
    ...(me.worldId.available ? { worldId: { verified: me.worldId.verified, verifyLink: me.worldId.verifyLink } } : {}),
    // Only while they are out of the Edge City pool: what to ask their human (POST /api/me/edge-city with the answer).
    ...(me.edgeCity.member ? {} : { edgeCity: me.edgeCity }),
  };
}

// The owner's state for a chat agent (partner API): bounded lists, no transcripts, photos or message text,
// so the reply stays small however many dates a resident has had.
/* eslint-disable @typescript-eslint/no-unused-vars */
export function summaryJson(me: MeView) {
  const { tags: _t, photos: _p, ...answers } = me.profile;
  return {
    profile: answers,
    datesToday: me.datesToday,
    datesLeftToday: me.datesLeftToday,
    running: me.running,
    topPick: me.topPick,
    recommendations: me.recommendations.slice(0, 20).map(({ photos: _p, ...r }) => r),
    recommendationCount: me.recommendations.length,
    weekly: me.weekly,
    matches: me.matches.slice(0, 30).map(({ transcript: _t, photos: _p, lastMessage: _l, ...m }) => m),
    worldId: me.worldId,
    edgeCity: me.edgeCity,
  };
}
/* eslint-enable @typescript-eslint/no-unused-vars */

// GET /api/me/recommendations (the iMessage extension, widgets): only the pending recommendations, i.e. the
// people the resident's OWN agent recommends and they have not answered yet, newest first, at most 20. Same
// secrecy as meView (secret.ts isRecommendation): no other-side verdict, no unrecommended date, and blocked,
// banned or hidden people are left out. Lighter than meView: no ranking, no matches, no World ID link.
export async function pendingRecommendations(me: User) {
  // Edge City only (lib/edge-city.ts): nothing for someone who said no or has not answered, and only members shown.
  if (!inPool(me)) return [];
  // Held weekly-drop dates (lib/drop.ts) are left out until released to this side; the drop comes first.
  const holding = holdingNow();
  const rows = await sql`select * from dates where status = 'done'
      and ((a_id = ${me.id} and (verdict_a->>'meet')::boolean and decision_a is null and (not held or ${!holding}::boolean or finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or drop_a_at is not null or shown_a_at is not null))
        or (b_id = ${me.id} and (verdict_b->>'meet')::boolean and decision_b is null and (not held or ${!holding}::boolean or finished_at <= ${HOLDS_LIFTED_AT}::timestamptz or drop_b_at is not null or shown_b_at is not null)))
    order by (case when a_id = ${me.id} then drop_a_at else drop_b_at end) desc nulls last, coalesce(finished_at, created_at) desc limit 50`;
  const recs = rows.map(toDate).filter((d) => isRecommendation(d, me.id));
  const otherIds = [...new Set(recs.map((d) => mySide(d, me.id).otherId))];
  const people = otherIds.length
    ? (await sql`select * from users u where u.id = any(${otherIds}::uuid[]) and u.edge_city and u.banned_at is null and u.hidden_at is null
        and u.is_demo = ${me.isDemo}
        and not exists (select 1 from blocks k where (k.blocker_id = ${me.id} and k.blocked_id = u.id) or (k.blocker_id = u.id and k.blocked_id = ${me.id}))`).map(toUser)
    : [];
  const byId = new Map(people.map((u) => [u.id, u]));
  const shown = recs.filter((d) => byId.has(mySide(d, me.id).otherId)).slice(0, 20);
  const sees = await seesPhotos(me);
  const photos = sees ? await photosByUser(shown.map((d) => mySide(d, me.id).otherId)) : new Map<string, PhotoRef[]>();
  return shown.map((d) => {
    const o = byId.get(mySide(d, me.id).otherId)!;
    const v = mySide(d, me.id).verdict!;
    return {
      dateId: d.id,
      matchId: d.id, // the same id: decide with it, and it becomes the matchId if both say yes
      name: o.name,
      why: noDashes(v.reason ?? ""),
      meetup: noDashes(v.suggestedMeetup ?? ""),
      photoUrl: visiblePhoto(shown, me.id, o.id, photos, sees),
      sharedInterests: sharedInterests(me, o).slice(0, 3),
      about: publicAbout(o, d.mode),
      worldVerified: worldVerified(o),
      createdAt: d.finishedAt ?? d.createdAt,
      // This week's Kismet: the proposed plan (confirmed only when both say yes).
      weeklyDrop: isDrop(d, me.id),
      plan: planFor(d, me.id),
    };
  });
}
