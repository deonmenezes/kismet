import { sql, toDate, toUser, type User } from "../db";
import { addAgentNotes, decideDate, deleteUser, insertUser, removeAgentNotes, setEdgeCity, startDates, updateProfile } from "../actions";
import { contactFor, pendingRecommendations, profileView, type PublicAbout } from "../views";
import { publicAbout } from "../about";
import { sharedInterests } from "../match";
import { parseProfile } from "../validate";
import { isSuspended } from "../safety";
import { isOpenMatch } from "../secret";
import { DEMO_RESERVED, reservedForDemo } from "../demo";
import { listNotes, logActivity, markShown, recordContactChange, type Action } from "../records";
import { notesText } from "../chat";
import { WHATSAPP, type Client } from "../client";
import { AVAILABILITY, label, LOOKING_FOR, REL_STATUS } from "../options";
import { applyContact } from "./parse";
import { confirmedPlanText, SITE } from "../copy";
import { planFor } from "../drop";
import { briefEvent, formatEvent, forInterests, villageEvents } from "../village-events";
import { addSignal, listSignals, setSignal, signalsText } from "../signals";
import { enrichProfile } from "../engine";
import { checkReportHistory, type Contacts } from "../report-history";
import { after } from "next/server";
import { flushNotices, handleInbound, linkedFromApp, notifyMatch, pushNext, type AppOps, type Deps, type Thread } from "./agent";
import { gmiTextModel } from "./model";
import { neonText } from "./store";
import { whatsappAdapter } from "./whatsapp";
import { webAdapter } from "./web";
import type { Inbound, TextAdapter } from "./types";

/** Their public answers as one line for the chat model ("tell me more about them"). */
export const aboutText = (a: PublicAbout) => [
  a.bio && `In their words: "${a.bio}"`,
  a.lookingFor.length && `Here for: ${a.lookingFor.join(", ")}`,
  a.interests.length && `Into: ${a.interests.join(", ")}`,
].filter(Boolean).join(". ");

// Production wiring for Kismet by text: Neon store, WhatsApp Cloud API adapter, GMI model chain and the
// same account actions the web, apps and Agent Village use (so every record and privacy rule applies).

export const whatsapp: TextAdapter = whatsappAdapter({
  token: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  appSecret: process.env.WHATSAPP_APP_SECRET,
  apiVersion: process.env.WHATSAPP_API_VERSION,
  template: process.env.WHATSAPP_TEMPLATE,
  matchTemplate: process.env.WHATSAPP_MATCH_TEMPLATE,
  templateLang: process.env.WHATSAPP_TEMPLATE_LANG,
  prefix: process.env.WHATSAPP_TEST_PREFIX,
});

const WEB: Client = { channel: "web", client: "" };
const clientOf = (t: Thread) => (t.channel === "web" ? WEB : WHATSAPP);

async function user(id: string): Promise<User | null> {
  const [r] = await sql`select * from users where id = ${id}`;
  return r ? toUser(r) : null;
}

const FIELDS: Record<string, string> = {
  name: "name", bio: "bio", about: "bio", interests: "interests", looking: "lookingFor", lookingfor: "lookingFor",
  status: "relStatus", telegram: "telegram", contact: "contact", openness: "openness", gender: "gender", interested: "interestedIn",
  free: "availability", availability: "availability", area: "area",
};

const setContact = (id: string, t: Thread, method: "telegram" | "phone", before: User | null) => applyContact({
  save: async (c) => {
    await sql`update users set contact_method = ${c.method}, contact_phone = ${c.phone} where id = ${id}`;
    if (c.phone && c.phone !== before?.contactPhone) await checkReportHistory(id); // a new number (lib/report-history.ts)
  },
  record: (from, to) => recordContactChange(id, from, to, clientOf(t)),
}, before && { method: before.contactMethod, phone: before.contactPhone }, { method, phone: method === "phone" ? t.phone : null });

/**
 * The contact a text sign-up comes with before the thread is joined to the account (lib/report-history.ts): the WhatsApp
 * number, or the website sign-in's email (the thread "web:a:<auth user id>"; Neon Auth's own table).
 */
async function threadContacts(t: Thread): Promise<Contacts> {
  if (t.channel !== "web") return { phones: [t.phone] };
  const authId = /^web:a:(.+)$/.exec(t.phone)?.[1];
  if (!authId) return {};
  const rows = await sql`select email from neon_auth."user" where id::text = ${authId}`.catch(() => []);
  return { emails: rows.map((r) => r.email as string) };
}

/** The open match's reveal for `userId`, re-checked now: null once unmatched, blocked, reported or deleted. */
async function matchNotice(userId: string, dateId: string) {
  const [r] = await sql`select * from dates where id = ${dateId} and (a_id = ${userId} or b_id = ${userId})`;
  if (!r) return null;
  const d = toDate(r);
  if (!isOpenMatch(d)) return null;
  const otherId = d.aId === userId ? d.bId : d.aId;
  const [blocked] = await sql`select 1 from blocks where (blocker_id = ${userId} and blocked_id = ${otherId}) or (blocker_id = ${otherId} and blocked_id = ${userId})`;
  const [other, me] = await Promise.all([user(otherId), user(userId)]);
  if (blocked || !other || !me || isSuspended(other) || other.isDemo !== me.isDemo) return null;
  // A weekly drop's plan, confirmed now that both said yes.
  const confirmed = planFor(d, userId);
  const plan = confirmed?.confirmed ? ` ${confirmedPlanText(confirmed.text)}` : "";
  return `It's a match! You and ${other.name} both said yes (and so did your agents). Reach them on ${contactFor(other).text}.${plan}`;
}

export const app: AppOps = {
  async signup(t, userId, profile, notes, contactMethod) {
    // No Telegram: by phone on WhatsApp, or a website sign-up that skipped it (matches message them in Kismet).
    const skipped = t.channel === "web" && !profile.telegram && (t.draft.asked ?? []).includes("contact");
    const parsed = parseProfile({ ...profile }, { telegramOptional: contactMethod === "phone" || skipped });
    if ("error" in parsed) return { error: parsed.error ?? "invalid answer" };
    // App Review's demo name and handle (lib/demo.ts): never a text sign-up.
    if (reservedForDemo(parsed.profile)) return { error: DEMO_RESERVED };
    // userId is fixed on the thread before this runs (agent.ts signup). When an earlier try already created it
    // (one that died after the insert, or one still running), this finishes that account instead of making another.
    const contacts = await threadContacts(t);
    if (!(await insertUser(parsed.profile, clientOf(t), null, notes, userId, { contacts }))) {
      if (!(await app.exists(userId))) return { error: "please try again" };
      await updateProfile(userId, parsed.profile, clientOf(t));
      await checkReportHistory(userId, contacts); // the try that died may have stopped before its check
    }
    try {
      await setContact(userId, t, contactMethod, null);
      await logActivity(userId, clientOf(t), "text_consent", { consentAt: t.draft.consentAt ?? null });
    } catch (e) {
      // No half-made account: the thread goes back to the recap and the next YES starts over (with the same id).
      await sql`delete from users where id = ${userId}`;
      throw e;
    }
    return { userId };
  },
  suspended: async (id) => {
    const u = await user(id);
    return !u || isSuspended(u);
  },
  exists: async (id) => (await sql`select 1 from users where id = ${id}`).length > 0,
  firstName: async (id) => (await user(id))?.name ?? "",
  async profileText(id) {
    const u = await user(id);
    if (!u) return "";
    return [
      `Name: ${u.name}`,
      `Here for: ${u.lookingFor.map((g) => label(LOOKING_FOR, g)).join(", ")}`,
      `Interests: ${u.interests.join(", ")}`,
      u.bio ? `About: ${u.bio}` : "",
      `Free to meet up: ${label(AVAILABILITY, u.availability)}${u.area ? `, around ${u.area}` : ""}`,
      `Status (private): ${label(REL_STATUS, u.relStatus)}`,
      `Matches reach you via ${contactFor(u).text}`,
    ].filter(Boolean).join("\n");
  },
  async edit(t, id, field, value) {
    const u = await user(id);
    if (!u) return "I couldn't find your account.";
    const key = FIELDS[field];
    if (!key) return "You can edit: name, bio, interests, looking, status, telegram, contact (phone or telegram), openness, gender, interested, free (weekday evenings, weekends or flexible), area.";
    const p: Record<string, unknown> = { ...profileView(u) };
    let method = u.contactMethod;
    if (key === "contact" && t.channel === "web") return "Here on the website, matches reach you on Telegram: EDIT telegram <username>. (Kismet on WhatsApp can share your number instead.)";
    if (key === "contact") {
      const v = value.toLowerCase();
      if (v.startsWith("phone") || v.startsWith("whatsapp")) method = "phone";
      else if (v.startsWith("telegram")) method = "telegram";
      else return "Send EDIT contact phone, or EDIT contact telegram.";
      if (method === "telegram" && !u.telegram) return "Send your Telegram first: EDIT telegram <username>.";
    } else if (key === "interests" || key === "lookingFor") p[key] = value.split(/,|\band\b/).map((s) => s.trim()).filter(Boolean);
    else p[key] = value;
    if (key === "telegram") method = "telegram";
    // Without a Telegram as PATCH /api/me (lib/validate.ts telegramOptionalFor): reached on WhatsApp, or none today (not EDIT telegram).
    const parsed = parseProfile(p, { telegramOptional: method === "phone" || (key !== "telegram" && !u.telegram) });
    if ("error" in parsed) return `That didn't work: ${parsed.error}`;
    if (reservedForDemo(parsed.profile, u.isDemo)) return `That didn't work: ${DEMO_RESERVED}.`;
    await updateProfile(id, parsed.profile, clientOf(t));
    // A web thread's "phone" is its thread key, never a number: there a WhatsApp choice is left as it is.
    if (!(t.channel === "web" && method === "phone")) await setContact(id, t, method, u);
    return `Updated. ${field === "contact" ? `Matches reach you via ${method === "phone" ? `this number (${t.phone})` : `Telegram @${parsed.profile.telegram}`}.` : "New agent chats will use it."}`;
  },
  async startDates(t, id) {
    const u = await user(id);
    if (!u) return "";
    return (await startDates(u, `text:${t.id}`, clientOf(t))).text.replace(/ Ask "how did it go\?" in about a minute\./, "");
  },
  async pending(id) {
    const u = await user(id);
    if (!u) return [];
    return (await pendingRecommendations(u)).map((r) => ({
      dateId: r.dateId, name: r.name, why: r.why, meetup: r.meetup,
      drop: r.weeklyDrop && r.plan ? { plan: r.plan.text, why: r.plan.why } : null,
      about: aboutText(r.about),
    }));
  },
  async decide(t, id, dateId, answer) {
    const u = await user(id);
    if (!u) return null;
    // decideDate tells the other person about a new match (notifyMatchByText) after the response.
    const r = await decideDate(u, dateId, answer, clientOf(t));
    if (!r) return null;
    const otherName = r.matchWith?.name ?? (await sql`select u.name from dates d join users u on u.id = case when d.a_id = ${id} then d.b_id else d.a_id end where d.id = ${dateId}`)[0]?.name ?? "them";
    if (answer === "pass") return { match: false, text: `Okay, I won't bring up ${otherName} again. They'll never know.` };
    if (r.match) return { match: true, text: (await matchNotice(id, dateId)) ?? "It's a match! Text MATCHES to see how to reach them." };
    return { match: false, text: `Noted, privately. If ${otherName} says yes too, I'll text you how to reach them. Otherwise you won't hear about it again.` };
  },
  async matchesText(id) {
    const rows = await sql`select u.* from dates d join users u on u.id = case when d.a_id = ${id} then d.b_id else d.a_id end
      where (d.a_id = ${id} or d.b_id = ${id}) and d.matched_at is not null and d.chat_closed_at is null
        and u.banned_at is null and u.hidden_at is null and u.is_demo = (select m.is_demo from users m where m.id = ${id})
        and not exists (select 1 from blocks k where (k.blocker_id = d.a_id and k.blocked_id = d.b_id) or (k.blocker_id = d.b_id and k.blocked_id = d.a_id))
      order by d.matched_at desc limit 5`;
    if (!rows.length) return "No matches yet. I'll text you as soon as someone you said yes to says yes too.";
    return ["Your matches:", ...rows.map(toUser).map((o) => `- ${o.name}: ${contactFor(o).text}`)].join("\n");
  },
  matchNotice,
  async matchesBrief(id) {
    const me = await user(id);
    if (!me) return [];
    // Open matches only (the same rule as MATCHES): what each already shares with a match, and this person's own
    // agent's take. Never the other agent's verdict, contact details or anything private.
    const rows = await sql`select u.*, d.mode as date_mode, case when d.a_id = ${id} then d.verdict_a else d.verdict_b end as my_verdict
      from dates d join users u on u.id = case when d.a_id = ${id} then d.b_id else d.a_id end
      where (d.a_id = ${id} or d.b_id = ${id}) and d.matched_at is not null and d.chat_closed_at is null
        and u.banned_at is null and u.hidden_at is null and u.is_demo = (select m.is_demo from users m where m.id = ${id})
        and not exists (select 1 from blocks k where (k.blocker_id = d.a_id and k.blocked_id = d.b_id) or (k.blocker_id = d.b_id and k.blocked_id = d.a_id))
      order by d.matched_at desc limit 5`;
    return rows.map((r) => {
      const o = toUser(r);
      const take = typeof r.my_verdict?.reason === "string" ? r.my_verdict.reason.slice(0, 300) : "";
      const shared = sharedInterests(me, o);
      return { name: o.name, about: [aboutText(publicAbout(o, r.date_mode as string | null)), take && `My take after our agents' chat: ${take}`, shared.length && `Shared interests: ${shared.join(", ")}`].filter(Boolean).join(". ") };
    });
  },
  async contactInfo(id) {
    const u = await user(id);
    return u ? { telegram: u.telegram, contactMethod: u.contactMethod, contactPhone: u.contactPhone } : null;
  },
  addNotes: async (t, id, notes) => void (await addAgentNotes(id, notes, clientOf(t))),
  async eventsText(id) {
    const [u, events] = await Promise.all([user(id), villageEvents(2)]);
    if (!events.length) return "The village calendar looks quiet for the next two days (or I can't reach it right now).";
    const mine = u ? forInterests(events, [...u.interests, ...u.lookingFor], 3) : [];
    const rest = events.filter((e) => !mine.some((m) => m.uid === e.uid)).slice(0, 4 - mine.length); // fits one WhatsApp text
    return [
      mine.length ? "For you, from the village calendar:" : "Coming up in the village:",
      ...mine.map((e) => `- ${formatEvent(e)}`),
      ...(mine.length && rest.length ? ["Also on:"] : []),
      ...rest.map((e) => `- ${formatEvent(e)}`),
      "(Public Edge City calendar; RSVP on the portal.)",
    ].join("\n");
  },
  async privacyText(id) {
    const u = await user(id);
    if (!u) return "I couldn't find your account.";
    const contact = contactFor(u);
    return [
      "Who sees what:",
      "- Your agent is private to you: it talks only to you, and nobody else can read this chat.",
      "- People whose agent recommends you: your name, your own answers (bio, what you're here for, interests; romance only on a romance intro), shared interests, photos, World ID badge and their agent's take on you. They can ask Kismet about those answers too. You can also show up as someone's top pick (no photos).",
      `- Only matches: your contact (${contact.kind === "telegram" ? `@${contact.value}` : contact.kind === "phone" ? "your WhatsApp" : "Kismet messages"}), your agents' chat, and whether it was a romance intro.`,
      "- Other agents, in an agent chat: a short card about you, shaped by your profile, notes and signals. Never your contact.",
      `- Village Board: anonymous lines, only if you both opted in${u.publicQuotes ? " (you did)" : " (you didn't)"}.`,
      "- Only Edge City India residents are on Kismet: nobody else is ever paired for agent chats, recommended or shown.",
      "- Nobody: your relationship status, openness, gender, who you're into, your yes / no answers, your email.",
      "Change it: EDIT, NOTES, FORGET EVERYTHING, DELETE ME.",
    ].join("\n");
  },
  async addSignal(t, id, signal, message) {
    const saved = await addSignal(id, signal, message);
    if (!saved) return null;
    await logActivity(id, clientOf(t), "signal_add", { signalId: saved.id }); // the id only, never the words
    after(() => enrichProfile(id)); // a new want changes the card, and so who they meet
    return saved.text;
  },
  signalsText: async (id) => signalsText(await listSignals(id, true)),
  async setSignal(t, id, n, action) {
    if (!(await setSignal(id, { n }, action))) return `I couldn't ${action} signal ${n}. Send SIGNALS to see the list.`;
    await logActivity(id, clientOf(t), "signal_change", { action });
    after(() => enrichProfile(id));
    return `${action === "drop" ? "Dropped" : action === "pause" ? "Paused" : "Resumed"} signal ${n}.\n${signalsText(await listSignals(id, true))}`;
  },
  async villageBrief() {
    const events = await villageEvents(1.5);
    return events.slice(0, 10).map((e) => `- ${briefEvent(e)}`).join("\n");
  },
  notesText: async (id) => notesText(await listNotes(id)),
  forgetNotes: async (t, id) => void (await removeAgentNotes(id, "all", clientOf(t))),
  deleteAccount: (t, id) => deleteUser(id, clientOf(t)),
  async linked(t, id) {
    await logActivity(id, clientOf(t), "phone_link", { channel: t.channel });
    await checkReportHistory(id, await threadContacts(t)); // a newly linked number (lib/report-history.ts)
  },
  edgeCity: async (id) => (await user(id))?.edgeCity ?? null,
  setEdgeCity: async (t, id, member, weeks) => void (await setEdgeCity(id, member, weeks, clientOf(t))),
  async log(t, id, action, meta = {}) {
    if (!id) return;
    if (action === "recommendation_shown" && typeof meta.dateId === "string") return markShown(id, [meta.dateId], clientOf(t));
    await logActivity(id, clientOf(t), action as Action, meta);
  },
};

export const deps = (adapter: TextAdapter = whatsapp): Deps => ({ store: neonText, adapter, model: gmiTextModel, app, now: () => new Date(), site: SITE });

/** Handles every inbound message of one webhook delivery (errors are logged, never thrown). */
export async function handleMessages(adapter: TextAdapter, messages: Inbound[]) {
  const d = deps(adapter);
  for (const m of messages) {
    try {
      const outcome = await handleInbound(d, m);
      console.log("text inbound", m.channel, outcome);
    } catch (e) {
      console.error("text inbound failed", e instanceof Error ? e.message : e);
    }
  }
}

/** Under the thread's lock: queued notices first (outside quiet hours), then the next recommendation. */
async function pushThread(d: Deps, id: string) {
  const [r] = await sql`select channel, phone from user_phones where id = ${id}`;
  if (!r) return "gone";
  const first = await d.store.thread(r.channel, r.phone);
  if (!first) return "gone";
  const release = await d.store.lock(first);
  try {
    const t = await d.store.thread(r.channel, r.phone);
    if (!t) return "gone";
    await flushNotices(d, t);
    return await pushNext(d, t);
  } finally {
    await release();
  }
}

/** After a date finished (or anything else that may create a recommendation): text whoever is waiting (and put it in their web chat). */
export async function pushForUsers(userIds: string[]) {
  if (!userIds.length) return;
  const threads = await sql`select id, channel from user_phones where user_id = any(${userIds}::uuid[]) and state = 'active'
    and opted_out_at is null and blocked_at is null`;
  for (const { id, channel } of threads) {
    if (channel === "whatsapp" && !whatsapp.configured()) continue;
    try {
      console.log("text push", channel, await pushThread(deps(channel === "web" ? webAdapter : whatsapp), id as string));
    } catch (e) {
      console.error("text push failed", e instanceof Error ? e.message : e);
    }
  }
}

/** Everyone with an active text or web chat thread: their next open recommendation (and queued notices) goes out now. */
export async function pushAllActive() {
  const active = await sql`select distinct user_id from user_phones where user_id is not null and state = 'active'
    and opted_out_at is null and blocked_at is null`;
  await pushForUsers(active.map((x) => x.user_id as string));
  return active.length;
}

/** A new mutual match (from text, app, web or Agent Village): tell `userId` by text too, and in their web chat. */
export async function notifyMatchByText(userId: string, dateId: string) {
  for (const adapter of whatsapp.configured() ? [whatsapp, webAdapter] : [webAdapter]) {
    try {
      await notifyMatch(deps(adapter), userId, dateId);
    } catch (e) {
      console.error("text match notice failed", adapter.channel, e instanceof Error ? e.message : e);
    }
  }
}

/** The app approved a phone's link request (or the phone confirmed a web-entered code). */
export async function finishWebLink(t: Thread, userId: string) {
  if (t.optedOutAt) return { ok: false as const, error: "That number opted out of Kismet texts. Text START to Kismet first." };
  if (t.userId && t.userId !== userId) return { ok: false as const, error: "That number already has its own Kismet account." };
  await neonText.save({ ...t, userId, state: "active" });
  await logActivity(userId, WHATSAPP, "phone_link", { channel: t.channel });
  await checkReportHistory(userId); // a newly linked number (lib/report-history.ts)
  if (whatsapp.configured()) await linkedFromApp(deps(), { ...t, userId, state: "active" });
  return { ok: true as const };
}
