// Kismet by text: the conversation state machine. Everything it touches is injected (store, provider
// adapter, model, app actions, clock), so it runs against memory fakes in tests and Neon + WhatsApp in
// production (lib/text/runtime.ts). Secret double opt-in is unchanged: a person only hears about people their
// OWN agent recommends, answers yes/no privately, and learns the other side only on a mutual yes.
//
// Concurrency: every inbound message is handled under a per-number lock, sign-up is claimed atomically, and
// the pending recommendation and queued notices change only through atomic store operations.
// Transcripts never hold another resident's name, reason or contact: those outbound texts are stored as
// placeholders with the date id ("[recommendation date:<id>]").
import { createHmac, randomUUID } from "node:crypto";
import type { Inbound, TextAdapter, TextChannel } from "./types.ts";
import {
  chipAnswer, clip, draftProfile, HELP, isExplicitYes, isQuietHours, mergeDraft, nextField, parseCommand, parseYesNo, QUESTIONS, recapText,
  type ContactInfo, type Draft, type Extracted, type Field,
} from "./parse.ts";
import { withoutNames } from "../contacts.ts";
import { stripControls } from "../controls.ts";
import { dropMessage, noDashes } from "../copy.ts";
import { EDGE_CITY, EDGE_QUESTION_EXISTING, edgeOnlyAgainText, edgeWelcomeText, parseEdgeAnswer, type EdgeWeek } from "../edge-city.ts";

export type State = "new" | "consent" | "interview" | "confirm" | "signing_up" | "active" | "delete_confirm";

/** A notice waiting for delivery (quiet hours, or the provider refused). Re-checked when it is delivered. */
export type Notice = { kind: "match"; dateId: string };

export type Thread = {
  id: string;
  channel: TextChannel;
  phone: string;
  userId: string | null;
  state: State;
  draft: Draft;
  verifiedAt: string | null;
  optedOutAt: string | null;
  pausedAt: string | null;
  blockedAt: string | null;
  lastInboundAt: string | null;
  /** Changed only through claimPending / releasePending (never by save). */
  pendingDateId: string | null;
  toldFinal: boolean;
  /** Changed only through queueNotice / takeNotices (never by save). */
  notices: Notice[];
};

export type Msg = { direction: "in" | "out"; text: string };
export type LinkRequest = { id: string; userId: string; userName: string };

export interface TextStore {
  thread(channel: TextChannel, phone: string): Promise<Thread | null>;
  createThread(channel: TextChannel, phone: string): Promise<Thread>;
  /** Saves the thread's own fields (not pendingDateId or notices). */
  save(t: Thread): Promise<void>;
  deleteThread(id: string): Promise<void>;
  /** A per-number lock (a lease in production). Returns its release. */
  lock(t: Thread): Promise<() => Promise<void>>;
  /** Atomically moves the thread from one state to another; false when it was not in `from`. */
  claimState(t: Thread, from: State, to: State): Promise<boolean>;
  /**
   * Atomically moves the thread from confirm to signing_up and fixes the id of the account it signs up: `userId`,
   * unless an earlier try already fixed one (that one is kept). The fixed id; null when it was not in confirm.
   */
  claimSignup(t: Thread, userId: string): Promise<string | null>;
  /** False when this provider message id was already handled (webhook retries). */
  claimInbound(t: Thread, providerId: string, text: string): Promise<boolean>;
  recordOutbound(t: Thread, text: string, providerId: string | null): Promise<void>;
  history(t: Thread, n: number): Promise<Msg[]>;
  /** Counter: true while under `limit` per `windowSec`. */
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
  threadsOfUser(userId: string): Promise<Thread[]>;
  /** Atomically sets the pending recommendation if none is set (two dates finishing at once push once). */
  claimPending(t: Thread, dateId: string): Promise<boolean>;
  releasePending(t: Thread, dateId: string): Promise<void>;
  queueNotice(t: Thread, n: Notice): Promise<void>;
  /** Takes (removes and returns) the queued notices. */
  takeNotices(t: Thread): Promise<Notice[]>;
  /** An app/web code typed on the phone: a link request that the app/web must approve. */
  requestLinkFromUserCode(t: Thread, code: string): Promise<LinkRequest | null>;
  /** A code this thread hands out, to be entered in the app/web (the phone then confirms). */
  createThreadCode(t: Thread): Promise<string>;
  /** A link request entered on the web for this thread, waiting for the phone's YES. */
  phoneLinkRequest(t: Thread): Promise<LinkRequest | null>;
  completeLink(t: Thread, requestId: string): Promise<boolean>;
}

/** drop: this week's Kismet (lib/drop.ts), with the proposed plan's text and its line on why these two fit. */
/** `about`: the person's own public answers (lib/views.ts publicAbout), which the owner may ask about. */
export type Rec = { dateId: string; name: string; why: string; meetup: string; drop?: { plan: string; why: string } | null; about?: string };
export type Decided = { match: boolean; text: string } | null;

export interface AppOps {
  /**
   * Creates the account `userId` (validated like the quiz), or finishes it when an earlier try of this thread
   * already created it. Error text for the person when a field is invalid.
   */
  signup(t: Thread, userId: string, profile: ReturnType<typeof draftProfile>, notes: string[], contactMethod: "telegram" | "phone"): Promise<{ userId: string } | { error: string }>;
  suspended(userId: string): Promise<boolean>;
  exists(userId: string): Promise<boolean>;
  firstName(userId: string): Promise<string>;
  profileText(userId: string): Promise<string>;
  edit(t: Thread, userId: string, field: string, value: string): Promise<string>;
  startDates(t: Thread, userId: string): Promise<string>;
  pending(userId: string): Promise<Rec[]>;
  /**
   * Answers a recommendation (final). On a new mutual match the implementation also tells the other person
   * (notifyMatch). text: what to tell this person (the reveal only on a match).
   */
  decide(t: Thread, userId: string, dateId: string, answer: "meet" | "pass"): Promise<Decided>;
  matchesText(userId: string): Promise<string>;
  /** "It's a match! ... reach them on ..." only while it is still an open match with a visible partner, else null. */
  matchNotice(userId: string, dateId: string): Promise<string | null>;
  contactInfo(userId: string): Promise<ContactInfo | null>;
  addNotes(t: Thread, userId: string, notes: string[]): Promise<void>;
  /** Upcoming public village events (the Edge City calendar), the person's interests first. */
  eventsText?(userId: string): Promise<string>;
  /** Exactly who sees what about this person. */
  privacyText?(userId: string): Promise<string>;
  /**
   * Their open matches, for the chat model's context ("what do you think of ..."): only what a match already sees
   * (the other person's own public answers, shared interests) plus their own agent's take on the date.
   */
  matchesBrief?(userId: string): Promise<MatchBrief[]>;
  /** A few upcoming public village events, one per line, for the chat model's context ("" when none). */
  villageBrief?(): Promise<string>;
  /** Saves a signal (a want in their own words, checked against `message`); the saved text, or null. */
  addSignal?(t: Thread, userId: string, signal: string, message: string): Promise<string | null>;
  signalsText?(userId: string): Promise<string>;
  setSignal?(t: Thread, userId: string, n: number, action: "pause" | "resume" | "drop"): Promise<string>;
  notesText(userId: string): Promise<string>;
  forgetNotes(t: Thread, userId: string): Promise<void>;
  deleteAccount(t: Thread, userId: string): Promise<void>;
  linked(t: Thread, userId: string): Promise<void>;
  log(t: Thread, userId: string | null, action: string, meta?: Record<string, unknown>): Promise<void>;
  /**
   * Edge City only (lib/edge-city.ts): the account's answer to "Are you at Edge City India?" (null: not asked yet) and
   * saving a new one. Left out (older fakes): everyone counts as a member.
   */
  edgeCity?(userId: string): Promise<boolean | null>;
  setEdgeCity?(t: Thread, userId: string, member: boolean, weeks: EdgeWeek[]): Promise<void>;
}

/** reply: a short acknowledgement (no question: the code asks the next one). */
export type InterviewOut = Extracted & { reply: string };
export type MatchBrief = { name: string; about: string };
export type ActiveOut = { reply: string; notes: string[]; answer: "yes" | "no" | "none"; signal?: string | null };

export interface TextModel {
  interview(input: { draft: Draft; asking: Field | null; history: Msg[]; message: string }): Promise<InterviewOut>;
  active(input: { name: string; pending: Rec | null; history: Msg[]; message: string; village?: string; matches?: MatchBrief[] }): Promise<ActiveOut>;
}

export type Deps = { store: TextStore; adapter: TextAdapter; model: TextModel; app: AppOps; now: () => Date; site: string };

export const CAPS = {
  perMinute: 20, perDay: 150, pushesPerDay: 4, globalPerDay: 20_000,
  signupsPerPrefixHour: 20, signupsGlobalHour: 200, linkPerNumberHour: 10, linkFailuresGlobalHour: 300,
};

export const consentText = (site: string) =>
  `Hi, I'm Kismet: intros to friends, collaborators and co-founders for ${EDGE_CITY.name} residents. You get your own private agent: it talks only to you, has short chats with other residents' agents and tells you who is worth meeting, up to 3 a day; you only ever answer yes or no. To start, reply YES to confirm you're 18+ and agree to the terms: ${site}/terms`;
/** The website's consent: shorter, the same request (YES confirms 18+ and agrees to the terms). */
export const webConsentText = (site: string) =>
  `Hi, I'm Kismet, intros to friends, collaborators and co-founders for ${EDGE_CITY.name} residents. Your own private agent chats with other residents' agents and tells only you who's worth meeting; you just say yes or no. To start, reply YES to confirm you're 18+ and agree to the terms: ${site}/terms`;
const consent = (d: Deps) => (d.adapter.channel === "web" ? webConsentText(d.site) : consentText(d.site));

/**
 * Sends a text. `stored`: what the transcript keeps instead (for texts about other residents). Any other text
 * that looks like one of those placeholders ("[match notice date:...]", e.g. a model reply someone talked into
 * it) is stored in quotes, so the web chat never renders it as a card.
 */
async function say(d: Deps, t: Thread, text: string, stored?: string) {
  const body = clip(noDashes(text), d.adapter.live ? 1500 : 640); // the web chat has room; WhatsApp texts stay short
  const r = await d.adapter.sendText(t.phone, body);
  await d.store.recordOutbound(t, stored ?? (/^\s*\[[^\]]*\]\s*$/.test(body) ? `"${body.trim()}"` : body), r.ok ? r.id : null);
  return r.ok;
}

const windowOpen = (d: Deps, t: Thread) => d.adapter.windowOpen(t.lastInboundAt ? new Date(t.lastInboundAt) : null, d.now());
/** Salted like the IP hashes (lib/auth.ts clientIp): stored counter keys can't be mapped back to a number. */
const salted = (v: string) => createHmac("sha256", process.env.IP_SALT || process.env.DATABASE_URL || "agent-dates").update(`text:${v}`).digest("hex").slice(0, 32);
/** A short stable key for a number (rate limits outlive the thread, e.g. across DELETE ME cycles). */
const numberKey = (t: Thread) => `${t.channel}:${salted(t.phone.replace(/\D/g, ""))}`;
/** A sign-up stuck in signing_up longer than this died mid-way (a crash or a timeout): it may be retried. */
export const SIGNUP_STALE_MS = 2 * 60_000;

/**
 * Delivers one notice now: a re-checked text inside the provider window, the partner-free template outside it.
 * "dropped": the match closed (unmatch, block, report) or the partner left since; "failed": keep it queued.
 */
async function deliver(d: Deps, t: Thread, n: Notice): Promise<"sent" | "dropped" | "failed"> {
  if (!t.userId) return "dropped";
  const text = await d.app.matchNotice(t.userId, n.dateId);
  if (!text) return "dropped";
  if (windowOpen(d, t)) return (await say(d, t, text, `[match notice date:${n.dateId}]`)) ? "sent" : "failed";
  const r = await d.adapter.sendMatchTemplate(t.phone);
  await d.store.recordOutbound(t, `[match template date:${n.dateId}]`, r.ok ? r.id : null);
  return r.ok ? "sent" : "failed";
}

/** Delivers queued notices (not in quiet hours unless the person is texting right now). */
export async function flushNotices(d: Deps, t: Thread, texting = false) {
  if (t.optedOutAt || t.blockedAt || !t.userId) return 0;
  if (!texting && !d.adapter.live && isQuietHours(d.now())) return 0;
  const list = await d.store.takeNotices(t);
  let sent = 0;
  for (const n of list) {
    const r = await deliver(d, t, n);
    if (r === "sent") sent++;
    else if (r === "failed") await d.store.queueNotice(t, n);
  }
  return sent;
}

/** Tells this person about a mutual match on their threads of this adapter's channel: now, or after quiet hours. */
export async function notifyMatch(d: Deps, userId: string, dateId: string) {
  for (const t of await d.store.threadsOfUser(userId)) {
    if (t.channel !== d.adapter.channel || t.state !== "active" || t.optedOutAt || t.blockedAt) continue;
    if ((!d.adapter.live && isQuietHours(d.now())) || (await deliver(d, t, { kind: "match", dateId })) === "failed") await d.store.queueNotice(t, { kind: "match", dateId });
  }
}

const userIdOf = (t: Thread) => t.userId!;

/** Another resident's full or first name (any case) out of text we store: never in a transcript. */
export function withoutName(text: string, name: string) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const n = name.normalize("NFC").trim();
  const words = n.split(/\s+/);
  // The full name, then each part (first and last names alike), longest first; word edges in any script.
  const parts = [n, ...words].filter((p, i, a) => [...p].length >= 1 && (p === n || p.length >= 3 || /[^\p{Script=Latin}]/u.test(p)) && a.indexOf(p) === i)
    .sort((a, b) => b.length - a.length); // short Latin particles ("de", "la") are left alone
  // Scripts written without spaces (Chinese, Japanese, Thai...) have no word edges: match the name anywhere there.
  const noSpaces = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  const pattern = (p: string) => (noSpaces.test(p) ? esc(p) : `(?<![\\p{L}\\p{M}\\p{N}_])${esc(p)}(?![\\p{L}\\p{M}\\p{N}_])`);
  return parts.reduce((s, p) => s.replace(new RegExp(pattern(p), "giu"), "them"), text.normalize("NFC"));
}

/**
 * The website's questions: one short line each (the answers are tap-to-answer chips there). The website's chat has
 * no phone number to share: matches reach web residents on Telegram, or in Kismet when they skip it.
 */
const WEB_QUESTIONS: Partial<Record<Field, string>> = {
  edgeCity: `Are you at ${EDGE_CITY.name} in ${EDGE_CITY.place}? Kismet is just for residents right now. Which weeks too, if you like.`,
  relStatus: "Relationship status? Private, never shown, and prefer not to say is fine.",
  openness: "Open to monogamy, polyamory, or an open relationship? Private, you can skip.",
  lookingFor: "What are you here for? Pick any, or say it your way.",
  genderInterest: "For romance: are you a man, a woman or non-binary, and are you into men, women or everyone? Private, you can skip.",
  interests: "Name 3 or more interests, like AI, surfing or music.",
  contact: "How should matches reach you? Send your Telegram username (only matches see it), or skip and they'll message you here in Kismet.",
};
const ask = (d: Deps, f: Field) => (d.adapter.channel === "web" ? WEB_QUESTIONS[f] ?? QUESTIONS[f] : QUESTIONS[f]);
const WEB_HELP = "Ask me anything, or tell me what you want in your own words. Shortcuts: MATCHES, SIGNALS, PROFILE, EDIT <field> <value> (name, bio, interests, looking, status, telegram), MORE, NOTES, EVENTS, PRIVACY, PAUSE / RESUME, DELETE ME.";
const help = (d: Deps) => (d.adapter.live ? WEB_HELP : HELP);

/** Handles one inbound message end to end (replies included), under the number's lock. */
export async function handleInbound(d: Deps, m: Inbound): Promise<string> {
  if (m.isGroup) return "group-ignored";
  m = { ...m, text: stripControls(m.text) }; // lib/controls.ts: never a NUL into a profile, a note or the store
  const first = (await d.store.thread(m.channel, m.from)) ?? (await d.store.createThread(m.channel, m.from));
  const release = await d.store.lock(first);
  try {
    const t = (await d.store.thread(m.channel, m.from)) ?? first;
    return await handleLocked(d, t, m);
  } finally {
    await release();
  }
}

async function handleLocked(d: Deps, t: Thread, m: Inbound): Promise<string> {
  if (!(await d.store.claimInbound(t, m.providerId, m.text || (m.buttonId ?? "")))) return "duplicate";
  if (t.blockedAt) return "blocked";
  const now = d.now();
  t.lastInboundAt = now.toISOString();
  t.verifiedAt ??= now.toISOString(); // the number proved itself by texting in
  const cmd = parseCommand(m.text);

  // Opt-out first, in every state and whatever the caps: after STOP only START brings them back.
  // (Not in the website's chat: signing out is how you leave it, and "stop" there is just a message.)
  if (cmd?.cmd === "stop" && !d.adapter.live) {
    if (t.optedOutAt) {
      await d.store.save(t);
      return "opted-out-ignored";
    }
    t.optedOutAt = now.toISOString();
    await d.store.save(t);
    await d.app.log(t, t.userId, "text_opt_out");
    await say(d, t, "You're unsubscribed: Kismet won't text you again. Reply START anytime to come back.");
    return "opted-out";
  }
  if (t.optedOutAt) {
    if (cmd?.cmd !== "start" && cmd?.cmd !== "resume") {
      await d.store.save(t);
      return "opted-out-ignored";
    }
    t.optedOutAt = null;
    if (!t.userId) t.state = "consent";
    await d.store.save(t);
    await d.app.log(t, t.userId, "text_opt_in");
    await say(d, t, t.userId ? "Welcome back! I'll text you when your agent finds someone." : consentText(d.site));
    return "opted-in";
  }

  // Caps: per number (a minute and a day) and global. Over them: one notice, then silence.
  const minuteOk = await d.store.hit(`text-min:${numberKey(t)}`, CAPS.perMinute, 60);
  const dayOk = await d.store.hit(`text-day:${numberKey(t)}`, CAPS.perDay, 86400);
  // Site-wide volume (threads without an account, per channel) is watched, never enforced: a refusal for everyone
  // is a lever for whoever floods it. The per-number caps above are the limit.
  if (!t.userId && !(await d.store.hit(`text-global:${t.channel}`, CAPS.globalPerDay, 86400))) console.warn("text volume over the daily watch level", t.channel);
  if (!minuteOk || !dayOk) {
    await d.store.save(t);
    if (!dayOk && (await d.store.hit(`text-capnote:${numberKey(t)}`, 1, 86400))) await say(d, t, "That's a lot of messages for one day. Let's pick this up tomorrow.");
    return "capped";
  }
  if (t.userId && !(await d.app.exists(t.userId))) {
    // The account was deleted elsewhere (app or web): start over.
    t.userId = null;
    t.state = "new";
    t.draft = {};
  }
  await d.store.save(t);
  d.adapter.typing?.(m).catch(() => {});
  await flushNotices(d, t, true);

  // A link entered on the web for this number waits for the phone's YES.
  const phoneLink = await d.store.phoneLinkRequest(t);
  if (phoneLink && isExplicitYes(m.text)) return finishLink(d, t, phoneLink);

  if (cmd?.cmd === "link") {
    if (!d.adapter.live) return link(d, t, cmd.code);
    await say(d, t, "Linking is for Kismet on WhatsApp. Here on the website you're already signed in.");
    return "link-web";
  }
  if (cmd?.cmd === "delete") {
    t.state = "delete_confirm";
    await d.store.save(t);
    await say(d, t, "Reply DELETE to erase your Kismet account and everything we stored about you, including this conversation (reports others made about you are kept up to 12 months, for safety). Anything else cancels.");
    return "delete-asked";
  }
  if (t.state === "delete_confirm") {
    if (/^\s*delete\s*$/i.test(m.text)) {
      if (t.userId) await d.app.deleteAccount(t, t.userId); // its threads and transcripts go with it
      await d.store.deleteThread(t.id);
      // Not recorded: there is no transcript any more.
      await d.adapter.sendText(t.phone, "Done: your account and this conversation are deleted. Text me anytime to start again.");
      return "deleted";
    }
    t.state = t.userId ? "active" : t.draft.consentAt ? "interview" : "new";
    await d.store.save(t);
    await say(d, t, "Okay, nothing was deleted.");
    return "delete-cancelled";
  }

  switch (t.state) {
    case "new":
      t.state = "consent";
      await d.store.save(t);
      await say(d, t, consent(d));
      return "consent-asked";
    case "consent": {
      // Consent needs the words: YES or I AGREE (not "ok", not a button from some other message).
      if (!m.buttonId && isExplicitYes(m.text)) {
        t.state = "interview";
        t.draft = { ...t.draft, consentAt: d.now().toISOString(), asked: [...(t.draft.asked ?? []), "edgeCity"] }; // asked just below
        await d.store.save(t);
        await d.app.log(t, null, "text_consent");
        await say(d, t, `Thanks! A few quick questions, one at a time. What you say about yourself is shown to people your agent recommends you to; anything marked private stays private. ${ask(d, nextField(t.draft) ?? "name")}`);
        return "consented";
      }
      const no = parseYesNo(m.text)?.answer === "no";
      await say(d, t, no ? "No problem. Text me anytime if you change your mind." : `I need a clear YES first. ${consent(d)}`);
      return "consent-pending";
    }
    case "signing_up": {
      const at = t.draft.signupAt ? new Date(t.draft.signupAt).getTime() : 0;
      if (now.getTime() - at < SIGNUP_STALE_MS || !(await d.store.claimState(t, "signing_up", "confirm"))) {
        await say(d, t, "One moment, I'm setting up your account.");
        return "signing-up";
      }
      t.state = "confirm"; // stale: back to the recap, so YES retries
      return interview(d, t, m);
    }
    case "interview":
    case "confirm":
      return interview(d, t, m);
    case "active":
      return active(d, t, m, cmd);
  }
  return "noop";
}

async function interview(d: Deps, t: Thread, m: Inbound): Promise<string> {
  // A recap from before Kismet became Edge City only: the Edge City question comes before any sign-up.
  if (t.state === "confirm" && t.draft.edgeCity !== true) t.state = "interview";
  if (t.state === "confirm" && !m.buttonId && isExplicitYes(m.text)) return signup(d, t);
  const cmd = parseCommand(m.text);
  if (cmd?.cmd === "help") {
    await say(d, t, `We're setting up your profile. ${ask(d, nextField(t.draft) ?? "name")}`);
    return "help";
  }
  const asking = t.state === "confirm" ? null : nextField(t.draft);
  if (asking === "edgeCity") {
    // A thread from before Kismet became Edge City only (mid-interview or at its recap) has not seen the question:
    // this message (an answer to another question, or the YES to that recap) never counts as the answer.
    if (!(t.draft.asked ?? []).includes("edgeCity")) {
      t.draft = { ...t.draft, asked: [...(t.draft.asked ?? []), "edgeCity"] };
      await d.store.save(t);
      await say(d, t, `One question first. ${ask(d, "edgeCity")}`);
      return "asked:edgeCity";
    }
    return edgeStep(d, t, m);
  }
  // A tapped suggestion (or the same words typed) is read here: no model call, no wait (lib/text/parse.ts chipAnswer).
  const quick = chipAnswer(asking, m.text);
  let out: InterviewOut;
  if (quick) out = { ...quick, reply: "" };
  else {
    try {
      out = await d.model.interview({ draft: t.draft, asking, history: await d.store.history(t, 8), message: m.text });
    } catch {
      await say(d, t, asking ? `Sorry, I missed that. ${ask(d, asking)}` : "Sorry, I missed that. What should I change?");
      return "model-failed";
    }
  }
  // A reply that is plainly a Telegram username (Telegram's rules: a letter first, 5-32 letters, digits or
  // underscores; with @, t.me/, or a digit or underscore in it) answers the contact question, whatever the model
  // made of it. Plain words ("skip", "later") and phone numbers are left to the model.
  // Also at the recap of a website sign-up that skipped Telegram ("send your Telegram username anytime to add it").
  const h = (asking === "contact" || (asking === null && d.adapter.channel === "web" && !t.draft.telegram)) && !out.telegram && out.contactMethod !== "phone"
    ? /^(@|(?:https?:\/\/)?t\.me\/)?([A-Za-z][A-Za-z0-9_]{4,31})$/i.exec(m.text.trim()) : null;
  if (h && (h[1] || /[_0-9]/.test(h[2]))) out = { ...out, telegram: h[2] };
  t.draft = mergeDraft(t.draft, out, asking);
  if (d.adapter.channel === "web" && t.draft.contactMethod === "phone") t.draft = { ...t.draft, contactMethod: t.draft.telegram ? "telegram" : undefined };
  // The website: no Telegram is fine, matches message them in Kismet (WhatsApp offers this number instead).
  if (d.adapter.channel === "web" && asking === "contact" && out.skipped && !t.draft.telegram) t.draft = { ...t.draft, asked: [...(t.draft.asked ?? []), "contact"] };
  const next = nextField(t.draft);
  // The model writes a short acknowledgement only; the next question is always ours (quiz order).
  const ack = clip((out.reply ?? "").trim(), 160);
  if (!next) {
    t.state = "confirm";
    await d.store.save(t);
    await say(d, t, recapText(t.draft, t.phone));
    return "recap";
  }
  t.state = "interview";
  await d.store.save(t);
  await say(d, t, ack ? `${ack} ${ask(d, next)}` : ask(d, next));
  return `asked:${next}`;
}

/** What Edge City India is, for someone who asks instead of answering. */
const edgeExplain = `${EDGE_CITY.name} is a pop-up village in ${EDGE_CITY.place} (${EDGE_CITY.dates}), and Kismet is just for the people there right now. Are you at Edge City? Reply YES or NO.`;

/**
 * The sign-up's first question, "Are you at Edge City India?", read without the model: a yes (with any weeks it
 * names) goes on to the next question, a no gets the waitlist (nothing is created), anything else asks again.
 */
async function edgeStep(d: Deps, t: Thread, m: Inbound): Promise<string> {
  const a = parseEdgeAnswer(m.text);
  if (a.answer === "yes") {
    t.draft = { ...t.draft, edgeCity: true, edgeWeeks: a.weeks.length ? a.weeks : t.draft.edgeWeeks };
    const next = nextField(t.draft);
    if (!next) {
      // Everything else was already answered (a recap from before Edge City only): back to the recap.
      t.state = "confirm";
      await d.store.save(t);
      await say(d, t, `${edgeWelcomeText}\n${recapText(t.draft, t.phone)}`);
      return "recap";
    }
    t.state = "interview";
    await d.store.save(t);
    await say(d, t, `${edgeWelcomeText} ${ask(d, next)}`);
    return `asked:${next}`;
  }
  if (a.answer === "no") {
    t.draft = { ...t.draft, edgeCity: false };
    await d.store.save(t);
    await say(d, t, edgeOnlyAgainText(d.site));
    return "edge-only";
  }
  await say(d, t, t.draft.edgeCity === false ? edgeOnlyAgainText(d.site) : edgeExplain);
  return "asked:edgeCity";
}

/**
 * An account that is not in the Edge City pool (it said no, or it is from before and was never asked): the question,
 * once per message until answered. Commands still work (MATCHES, PROFILE, DELETE ME...); there are no recommendations.
 */
async function edgeActive(d: Deps, t: Thread, m: Inbound, cmd: ReturnType<typeof parseCommand>, member: boolean | null): Promise<string> {
  const userId = userIdOf(t);
  // Only a typed reply after they were shown the question (or their earlier no) counts as the answer: never a tap on
  // an old recommendation's Yes / No button, never a YES typed to a recommendation pushed before the question.
  const seen = member === false || Boolean(t.draft.edgeAsked);
  const a = cmd || m.buttonId || !seen ? null : parseEdgeAnswer(m.text);
  if (a?.answer === "yes") {
    await d.app.setEdgeCity!(t, userId, true, a.weeks);
    t.draft = { ...t.draft, edgeAsked: undefined };
    await d.store.save(t);
    const started = await d.app.startDates(t, userId);
    await say(d, t, `${edgeWelcomeText} ${started}`);
    await pushNext(d, t);
    return "edge-yes";
  }
  if (a?.answer === "no") {
    if (member !== false) await d.app.setEdgeCity!(t, userId, false, []);
    await say(d, t, edgeOnlyAgainText(d.site));
    return "edge-no";
  }
  if (cmd) return command(d, t, cmd);
  if (!seen) {
    t.draft = { ...t.draft, edgeAsked: true };
    await d.store.save(t);
  }
  await say(d, t, member === false ? edgeOnlyAgainText(d.site) : EDGE_QUESTION_EXISTING);
  return "edge-asked";
}

async function signup(d: Deps, t: Thread): Promise<string> {
  // Sign-up caps like the web's: per number prefix (a source) is the limit; the site-wide hourly count is watched.
  const prefix = salted(t.phone.replace(/\D/g, "").slice(0, 8)); // narrow enough not to cover a whole region
  if (!(await d.store.hit(`text-signup:all:${t.channel}`, CAPS.signupsGlobalHour, 3600))) console.warn("text sign-ups over the hourly watch level", t.channel);
  if (!(await d.store.hit(`text-signup:${t.channel}:${prefix}`, CAPS.signupsPerPrefixHour, 3600))) {
    await say(d, t, "Lots of sign-ups right now. Reply YES again in an hour.");
    return "signup-limited";
  }
  // Exactly one account per thread, however many YES messages arrive at once and however a try dies (a crash
  // after the insert, or a slow try overtaken by the stale retry): the account id is fixed on the thread before
  // anything is created, and every later try creates or finishes that same account.
  const userId = await d.store.claimSignup(t, randomUUID());
  if (!userId) return "signup-busy";
  t.state = "signing_up";
  t.draft = { ...t.draft, signupAt: d.now().toISOString() };
  await d.store.save(t);
  const contactMethod = t.draft.contactMethod ?? "telegram";
  let r: Awaited<ReturnType<AppOps["signup"]>>;
  try {
    // app.signup removes a half-created account itself when a later step fails.
    r = await d.app.signup(t, userId, draftProfile(t.draft), t.draft.notes ?? [], contactMethod);
  } catch (e) {
    console.error("text signup failed", e instanceof Error ? e.message : e);
    t.state = "confirm";
    t.draft = { ...t.draft, signupAt: undefined };
    await d.store.save(t);
    await say(d, t, "Something went wrong setting up your account. Reply YES to try again.");
    return "signup-failed";
  }
  if ("error" in r) {
    t.state = "interview";
    t.draft = { ...t.draft, signupAt: undefined };
    await d.store.save(t);
    await say(d, t, `Something in your answers needs a fix: ${r.error}. Tell me the right value.`);
    return "signup-invalid";
  }
  t.userId = r.userId;
  t.state = "active";
  t.draft = { consentAt: t.draft.consentAt };
  await d.store.save(t);
  const started = await d.app.startDates(t, r.userId);
  await say(d, t, d.adapter.live
    ? `You're in! ${started} I'll tell you here when I find someone worth meeting.`
    : `You're in! ${started} I'll text you when your agent finds someone worth meeting. Text HELP for commands.`);
  return "signed-up";
}

async function link(d: Deps, t: Thread, code: string | null): Promise<string> {
  // Per number (survives DELETE ME), and a global budget of failed attempts.
  if (!(await d.store.hit(`text-link:${numberKey(t)}`, CAPS.linkPerNumberHour, 3600))) {
    await say(d, t, "Too many link attempts. Try again in an hour.");
    return "link-limited";
  }
  if (!code) {
    if (t.userId) {
      await say(d, t, "This number is already linked to your Kismet account.");
      return "link-already";
    }
    const c = await d.store.createThreadCode(t);
    await say(d, t, `Your link code is ${c}. Enter it in the Kismet app or website (Link WhatsApp) within 15 minutes; I'll ask you to confirm here.`, "[link code sent]");
    return "link-code-sent";
  }
  // Link codes are 40 bits and live 15 minutes: the per-number limit above is the guard; the site-wide count is watched.
  if (!(await d.store.hit("text-link-fail:all", CAPS.linkFailuresGlobalHour, 3600))) console.warn("link attempts over the hourly watch level");
  const req = await d.store.requestLinkFromUserCode(t, code);
  if (!req) {
    await say(d, t, "That code didn't work (wrong or expired). Get a new one in the Kismet app or website.");
    return "link-bad";
  }
  if (t.userId && t.userId !== req.userId) {
    await say(d, t, "This number already has its own Kismet account. Text DELETE ME first if you want to link it to another one.");
    return "link-conflict";
  }
  await say(d, t, "Almost done: approve the link in the Kismet app or website where you got the code.");
  return "link-requested";
}

/** The phone said YES to a link entered on the web. */
async function finishLink(d: Deps, t: Thread, req: LinkRequest): Promise<string> {
  if (t.userId && t.userId !== req.userId) {
    await say(d, t, "This number already has its own Kismet account. Text DELETE ME first if you want to link it to another one.");
    return "link-conflict";
  }
  if (!(await d.store.completeLink(t, req.id))) {
    await say(d, t, "That link request expired. Start again from the app or website.");
    return "link-expired";
  }
  t.userId = req.userId;
  t.state = "active";
  await d.store.save(t);
  await d.app.linked(t, req.userId);
  await say(d, t, "Linked! I'll text you here when your agent finds someone worth meeting. Text HELP for commands.");
  await pushNext(d, t);
  return "linked";
}

/** Linked from the app/web side (the app approved a phone-typed code): activate and greet. */
export async function linkedFromApp(d: Deps, t: Thread) {
  if (t.optedOutAt || t.blockedAt) return "skip:opted-out";
  await say(d, t, "Linked! I'll text you here when your agent finds someone worth meeting. Text HELP for commands.");
  return pushNext(d, t);
}

async function answer(d: Deps, t: Thread, rec: Rec, a: "yes" | "no"): Promise<string> {
  const userId = userIdOf(t);
  const decision = a === "yes" ? "meet" : "pass";
  const r = await d.app.decide(t, userId, rec.dateId, decision);
  await d.store.releasePending(t, rec.dateId);
  t.pendingDateId = null;
  t.draft = { ...t.draft, confirmAnswer: undefined };
  await d.store.save(t);
  if (!r) {
    await say(d, t, "That recommendation isn't open anymore.");
    return "decide-gone";
  }
  await say(d, t, r.text, `[answer ${decision} date:${rec.dateId}]`);
  await pushNext(d, t);
  return r.match ? "matched" : `decided:${decision}`;
}

/** A yes/no that was not explicit (model-read, or "ok"/"sure"): ask once before it becomes final. */
async function confirmFirst(d: Deps, t: Thread, rec: Rec, a: "yes" | "no") {
  t.draft = { ...t.draft, confirmAnswer: { dateId: rec.dateId, answer: a } };
  await d.store.save(t);
  const what = a === "yes" ? `YES to meeting ${rec.name}` : `NO to ${rec.name}`;
  await say(d, t, `Just to confirm: ${what}? This is final. Reply YES to confirm or NO to think again.`, `[confirm ${a} date:${rec.dateId}]`);
  return `confirm:${a}`;
}

async function active(d: Deps, t: Thread, m: Inbound, cmd: ReturnType<typeof parseCommand>): Promise<string> {
  const userId = userIdOf(t);
  if (await d.app.suspended(userId)) {
    await say(d, t, "Your account is paused while we review a report. Email support if you think this is a mistake.");
    return "suspended";
  }
  // Edge City only: an account out of the pool answers the question first (no recommendations until then).
  // Both ops or neither (a fake without setEdgeCity treats everyone as a member).
  const member = d.app.edgeCity && d.app.setEdgeCity ? await d.app.edgeCity(userId) : true;
  if (member !== true) return edgeActive(d, t, m, cmd, member);
  const pending = await currentPending(d, t);
  const yn = parseYesNo(m.text, m.buttonId);

  // Waiting for "Just to confirm": an explicit YES applies it, NO keeps the recommendation open.
  const c = t.draft.confirmAnswer;
  if (c) {
    t.draft = { ...t.draft, confirmAnswer: undefined };
    await d.store.save(t);
    if (pending && pending.dateId === c.dateId && !m.buttonId && isExplicitYes(m.text)) return answer(d, t, pending, c.answer);
    if (pending && pending.dateId === c.dateId && yn?.answer === "no" && yn.strict) {
      await say(d, t, `Okay, nothing saved. Meet ${pending.name}? Reply YES or NO.`, `[reprompt date:${pending.dateId}]`);
      return "confirm-cancelled";
    }
  }

  // Buttons answer only the question that is open now (an old message's button does not).
  if (yn?.dateId) {
    if (!pending || pending.dateId !== yn.dateId) {
      await say(d, t, pending ? `That one's no longer open. Meet ${pending.name}? Reply YES or NO.` : "That recommendation isn't open anymore.",
        pending ? `[stale button, reprompt date:${pending.dateId}]` : undefined);
      return "decide-stale";
    }
    return answer(d, t, pending, yn.answer);
  }
  if (pending && yn) return yn.strict ? answer(d, t, pending, yn.answer) : confirmFirst(d, t, pending, yn.answer);
  if (cmd) return command(d, t, cmd);
  const history = await d.store.history(t, 8);
  let out: ActiveOut;
  let matches: MatchBrief[] = [];
  try {
    const [village, briefs] = await Promise.all([d.app.villageBrief?.().catch(() => "") ?? "", d.app.matchesBrief?.(userId).catch(() => []) ?? []]);
    matches = briefs ?? [];
    out = await d.model.active({ name: await d.app.firstName(userId), pending, history, message: m.text, village: village ?? "", matches });
  } catch {
    await say(d, t, pending ? `Sorry, I didn't get that. Meet ${pending.name}? Reply YES or NO.` : `Sorry, I didn't get that. ${d.adapter.live ? "Try again, or type HELP." : help(d)}`,
      pending ? `[reprompt date:${pending.dateId}]` : undefined);
    return "model-failed";
  }
  if (pending && out.answer !== "none") return confirmFirst(d, t, pending, out.answer);
  // Notes only ever describe the resident: never on a turn that carried another person's own words (<about_them>).
  if (out.notes?.length && !pending?.about) await d.app.addNotes(t, userId, out.notes);
  // A want in their own words becomes a signal (Index Network's rule: never the agent's paraphrase).
  const saved = out.signal ? await d.app.addSignal?.(t, userId, out.signal, m.text) : null;
  // In case the model names the person on the open card or a match anyway: never store another resident's name
  // (the reply outlives a pass, an unmatch, a block or a deletion).
  const named = out.reply && pending ? withoutNames(withoutName(out.reply, pending.name), [pending.name]) : out.reply;
  const reply = named ? withoutNames(named, matches.map((x) => x.name), "your match") : help(d);
  const more = d.adapter.live ? "" : " Your agent looks for it from now on (SIGNALS to see them all).";
  await say(d, t, saved ? `${reply}\nSaved as a signal: "${saved}".${more}` : reply);
  if (!pending) await pushNext(d, t);
  return "chat";
}

async function command(d: Deps, t: Thread, cmd: NonNullable<ReturnType<typeof parseCommand>>): Promise<string> {
  const userId = userIdOf(t);
  switch (cmd.cmd) {
    case "help":
      await say(d, t, help(d));
      break;
    case "matches":
      await say(d, t, await d.app.matchesText(userId), "[matches list]");
      break;
    case "profile":
      await say(d, t, `${await d.app.profileText(userId)}\nChange something with EDIT <field> <value>.`);
      break;
    case "edit":
      await say(d, t, cmd.value ? await d.app.edit(t, userId, cmd.field, cmd.value) : `Send it like this: EDIT ${cmd.field} <new value>`);
      break;
    case "pause":
      t.pausedAt = d.now().toISOString();
      await d.store.save(t);
      await d.app.log(t, userId, "text_pause");
      await say(d, t, "Paused: I won't text you about new people until you reply RESUME.");
      break;
    case "resume":
    case "start":
      t.pausedAt = null;
      await d.store.save(t);
      await d.app.log(t, userId, "text_resume");
      await say(d, t, "Resumed. I'll text you when your agent finds someone.");
      await pushNext(d, t);
      break;
    case "dates":
      await say(d, t, await d.app.startDates(t, userId));
      break;
    case "notes":
      await say(d, t, await d.app.notesText(userId));
      break;
    case "events":
      await say(d, t, (await d.app.eventsText?.(userId)) ?? "The village calendar isn't connected right now.");
      break;
    case "signals":
      await say(d, t, (await d.app.signalsText?.(userId)) ?? help(d));
      break;
    case "signal":
      await say(d, t, (await d.app.setSignal?.(t, userId, cmd.n, cmd.action)) ?? help(d));
      break;
    case "privacy":
      await say(d, t, (await d.app.privacyText?.(userId)) ?? help(d));
      break;
    case "forget":
      await d.app.forgetNotes(t, userId);
      await say(d, t, "Done: I forgot everything I had saved about you.");
      break;
    default:
      await say(d, t, help(d));
  }
  return `cmd:${cmd.cmd}`;
}

/** The recommendation this thread is waiting on, if it is still open (else released). */
async function currentPending(d: Deps, t: Thread): Promise<Rec | null> {
  if (!t.pendingDateId || !t.userId) return null;
  const rec = (await d.app.pending(t.userId)).find((r) => r.dateId === t.pendingDateId) ?? null;
  if (!rec) {
    await d.store.releasePending(t, t.pendingDateId);
    t.pendingDateId = null;
  }
  return rec;
}

/**
 * Texts the next open recommendation: one at a time, at most CAPS.pushesPerDay a day, never in quiet hours
 * (23:00-08:00 Asia/Kolkata), never to paused, opted-out or blocked threads. Returns what it did.
 */
export async function pushNext(d: Deps, t: Thread): Promise<string> {
  if (t.state !== "active" || !t.userId || t.optedOutAt || t.pausedAt || t.blockedAt) return "skip:inactive";
  if (await currentPending(d, t)) return "skip:pending";
  if (!d.adapter.live && isQuietHours(d.now())) return "skip:quiet";
  if (await d.app.suspended(t.userId)) return "skip:suspended";
  const recs = await d.app.pending(t.userId);
  const rec = recs[0];
  if (!rec) return "skip:none";
  if (!(await d.store.claimPending(t, rec.dateId))) return "skip:pending";
  if (!d.adapter.live && !(await d.store.hit(`text-push:${numberKey(t)}`, CAPS.pushesPerDay, 86400))) {
    await d.store.releasePending(t, rec.dateId);
    return "skip:cap";
  }
  const final = t.toldFinal ? "" : " Your answer is private and final.";
  // This week's Kismet carries its plan; outside the 24 h window the existing template carries it in its "why" slot.
  const text = rec.drop
    ? clip(`${dropMessage(rec.name, clip(rec.drop.why, 140), rec.drop.plan)}${final}`, 600)
    : clip(`Your agent chatted with ${rec.name}'s agent. Why it clicked: ${clip(rec.why, 140)}${rec.meetup ? ` Idea: ${clip(rec.meetup, 70)}.` : ""} Want to meet them? Reply YES or NO.${final}`);
  // The plan first, so the template's 200-character parameter never cuts it; the why line is clipped after it.
  const why = rec.drop ? clip(`Plan: ${rec.drop.plan}. ${rec.drop.why}`, 200) : rec.why;
  const open = windowOpen(d, t);
  const r = await d.adapter.sendYesNo(t.phone, { text: noDashes(text), dateId: rec.dateId, name: rec.name, why: noDashes(why) }, open);
  await d.store.recordOutbound(t, `[recommendation${open ? "" : " template"} date:${rec.dateId}]`, r.ok ? r.id : null);
  if (!r.ok) {
    await d.store.releasePending(t, rec.dateId);
    return `failed:${r.error}`;
  }
  t.pendingDateId = rec.dateId;
  t.toldFinal = true;
  await d.store.save(t);
  await d.app.log(t, t.userId, "recommendation_shown", { dateId: rec.dateId, via: open ? "buttons" : "template" });
  return open ? "pushed" : "pushed:template";
}
