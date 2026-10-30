// Kismet by text: the deterministic parts (commands, yes/no, quiet hours, interview progress, recap).
// No framework or database imports (unit-tested directly).
import { GENDER, INTERESTED_IN, LOOKING_FOR, OPENNESS, REL_STATUS, label } from "../options.ts";
import { EDGE_QUESTION, weeksText } from "../edge-city.ts";

export const MAX_TEXT = 320;
export const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export type Command =
  | { cmd: "help" } | { cmd: "matches" } | { cmd: "profile" } | { cmd: "edit"; field: string; value: string }
  | { cmd: "pause" } | { cmd: "resume" } | { cmd: "stop" } | { cmd: "start" } | { cmd: "delete" }
  | { cmd: "link"; code: string | null } | { cmd: "dates" } | { cmd: "notes" } | { cmd: "forget" } | { cmd: "events" } | { cmd: "privacy" }
  | { cmd: "signals" } | { cmd: "signal"; action: "pause" | "resume" | "drop"; n: number };

/** A whole message that is a command (case-insensitive). Anything else is conversation. */
export function parseCommand(text: string): Command | null {
  const t = text.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  const l = t.toLowerCase();
  if (/^(help|menu|commands|\?)$/.test(l)) return { cmd: "help" };
  if (/^(matches|my matches)$/.test(l)) return { cmd: "matches" };
  if (/^(profile|my profile)$/.test(l)) return { cmd: "profile" };
  if (/^(pause)$/.test(l)) return { cmd: "pause" };
  if (/^(resume|unpause)$/.test(l)) return { cmd: "resume" };
  // Carrier / WhatsApp opt-out words.
  if (/^(stop|stopall|unsubscribe|cancel|end|quit|opt ?out)$/.test(l)) return { cmd: "stop" };
  if (/^(start|unstop|subscribe|opt ?in)$/.test(l)) return { cmd: "start" };
  if (/^(delete me|delete my account|delete account|erase me)$/.test(l)) return { cmd: "delete" };
  if (/^(dates|more dates|find dates|go on dates|more|meet more people)$/.test(l)) return { cmd: "dates" };
  if (/^(notes|what do you know( about me)?\??)$/.test(l)) return { cmd: "notes" };
  if (/^(forget (everything|it all|me))$/.test(l)) return { cmd: "forget" };
  if (/^(events|village events|what['’]?s on( today| tomorrow)?\??|what['’]?s happening( today)?\??)$/.test(l)) return { cmd: "events" };
  if (/^(privacy|my privacy|who sees what\??|what do others see( about me)?\??)$/.test(l)) return { cmd: "privacy" };
  if (/^(signals|my signals|what am i looking for\??)$/.test(l)) return { cmd: "signals" };
  const sig = /^(pause|resume|drop|remove|delete) signal (\d{1,2})$/.exec(l);
  if (sig) return { cmd: "signal", action: sig[1] === "pause" ? "pause" : sig[1] === "resume" ? "resume" : "drop", n: Number(sig[2]) };
  const link = /^link(?: ([0-9a-z]{4}-?[0-9a-z]{4}))?$/.exec(l);
  if (link) return { cmd: "link", code: link[1] ? normalizeCode(link[1]) : null };
  const edit = /^edit ([a-z]+)(?: ([\s\S]+))?$/i.exec(text.trim().replace(/\s+/g, " "));
  if (edit) return { cmd: "edit", field: edit[1].toLowerCase(), value: (edit[2] ?? "").trim() };
  return null;
}

// Strict words are a final answer; loose ones ("ok", "sure", a thumbs-up) are confirmed first.
const YES = /^(y|yes|yeah|yep|yup|yes please|let'?s meet|absolutely|definitely)$/;
const NO = /^(n|no|nope|nah|no thanks|no thank you|pass|not interested)$/;
const LOOSE_YES = /^(ya|yea|sure|ok|okay|k|of course|let'?s do it|i'?m in|go|why not|👍|✅)$/;
const LOOSE_NO = /^(skip|not really|nope thanks|meh|👎|❌)$/;
const norm = (text: string) => text.trim().toLowerCase().replace(/[.!,]+$/g, "").replace(/\s+/g, " ");

/** Yes / no, else null (the model reads fuzzy replies). strict: a final answer. Button ids name their date. */
export function parseYesNo(text: string, buttonId?: string | null): { answer: "yes" | "no"; dateId: string | null; strict: boolean } | null {
  const b = /^kismet:(yes|no):([0-9a-f-]{36})$/i.exec(buttonId ?? "");
  if (b) return { answer: b[1].toLowerCase() as "yes" | "no", dateId: b[2].toLowerCase(), strict: true };
  const l = norm(text);
  if (YES.test(l)) return { answer: "yes", dateId: null, strict: true };
  if (NO.test(l)) return { answer: "no", dateId: null, strict: true };
  if (LOOSE_YES.test(l)) return { answer: "yes", dateId: null, strict: false };
  if (LOOSE_NO.test(l)) return { answer: "no", dateId: null, strict: false };
  return null;
}

/** Consent and confirmations: the words YES or I AGREE only. */
export const isExplicitYes = (text: string) => /^(yes|yes please|i agree|agree|yes,? i agree)$/.test(norm(text));

// Link codes: 8 characters of Crockford base32 (no I, L, O, U), shown as XXXX-XXXX.
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** 23:00-08:00 in Asia/Kolkata: no pushes (replies to the person are always fine). */
export function isQuietHours(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(now)) % 24;
  return h >= 23 || h < 8;
}

// ---- Signals (a want in their own words; lib/signals.ts) ----------------------------------------------

export const wordsOf = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

/**
 * Their own words only (Index Network's rule): every word of the signal appears in their message, in order.
 * Words may be cut, never added or reworded.
 */
export function isOwnWords(signal: string, message: string) {
  const want = wordsOf(signal);
  const have = wordsOf(message);
  if (want.length < 2 || signal.length > 280) return false;
  let i = 0;
  for (const w of have) if (w === want[i] && ++i === want.length) return true;
  return false;
}

// ---- Interview -------------------------------------------------------------------------------------

export type Draft = {
  /** "Are you at Edge City India?" (lib/edge-city.ts): asked first; only a yes goes on to the other questions. */
  edgeCity?: boolean;
  edgeWeeks?: string[];
  /** An account from before Edge City only was shown the question (its next typed reply may answer it). */
  edgeAsked?: boolean;
  name?: string;
  relStatus?: string;
  openness?: string;
  lookingFor?: string[];
  gender?: string;
  interestedIn?: string;
  interests?: string[];
  bio?: string;
  telegram?: string;
  contactMethod?: "telegram" | "phone";
  notes?: string[];
  /** Optional questions already asked (and skipped). */
  asked?: string[];
  consentAt?: string;
  /** A fuzzy yes/no waiting for "Just to confirm". */
  confirmAnswer?: { dateId: string; answer: "yes" | "no" };
  /** When the thread moved to signing_up (an older one is stale: the sign-up died). */
  signupAt?: string;
};

export type Field = "edgeCity" | "name" | "relStatus" | "openness" | "lookingFor" | "genderInterest" | "interests" | "bio" | "contact";

export const QUESTIONS: Record<Field, string> = {
  edgeCity: EDGE_QUESTION,
  name: "What name should other residents see?",
  relStatus: "Relationship status? (private, never shown) Single, in a relationship, married, it's complicated, or prefer not to say.",
  openness: "Open to: monogamous, polyamorous, open, or not sure? (private, you can skip)",
  lookingFor: "What are you here for? Any of: romance, friends, collaborators, co-founder, adventure buddy, just vibes.",
  genderInterest: "For romance: which describes you (a man, a woman, non-binary), and who are you interested in (men, women, everyone)? Private.",
  interests: "Name 3 or more interests (AI, startups, surfing, music, art, yoga, books... or your own).",
  bio: "One line about you? (optional, you can skip)",
  contact: "When you match with someone, how should they reach you? Send your Telegram username, or reply PHONE to share this WhatsApp number (only with your matches).",
};

const ids = (list: readonly { id: string }[]) => list.map((o) => o.id);
const has = (v: unknown) => v !== undefined && v !== null && v !== "";

/**
 * The next question, in quiz order. Optional ones are asked once (skipped = in `asked`). Null: all done.
 * What they are here for comes before anything private: relationship status, openness, gender and who they're into
 * only matter for romance (lib/match.ts romanceCompatible), so only someone who picked Romance is asked them; everyone
 * else keeps "prefer not to say". `contact` in `asked`: the website's "Skip" (matches message them in Kismet).
 */
export function nextField(d: Draft): Field | null {
  const asked = new Set(d.asked ?? []);
  const romance = (d.lookingFor ?? []).includes("romance");
  // Edge City only: nothing else is asked until they said they are there (a "no" gets the waitlist instead).
  if (d.edgeCity !== true) return "edgeCity";
  if (!has(d.name)) return "name";
  if (!d.lookingFor?.length) return "lookingFor";
  if (romance && !has(d.relStatus) && !asked.has("relStatus")) return "relStatus";
  if (romance && (d.relStatus === "single" || d.relStatus === "complicated") && !has(d.openness) && !asked.has("openness")) return "openness";
  if (romance && (!has(d.gender) || !has(d.interestedIn)) && !asked.has("genderInterest")) return "genderInterest";
  if ((d.interests?.length ?? 0) < 3 && !(asked.has("interests") && (d.interests?.length ?? 0) >= 1)) return "interests";
  if (!has(d.bio) && !asked.has("bio")) return "bio";
  if ((!d.contactMethod || (d.contactMethod === "telegram" && !has(d.telegram))) && !asked.has("contact")) return "contact";
  return null;
}

/**
 * Where the sign-up is, for a "Step 3 of 8" line: agreeing, each question this draft will be asked (the romance ones only
 * once Romance is picked), and the recap's YES. `at`: the thread's state ("consent", "interview" or "confirm").
 */
export function signupProgress(d: Draft, at: string): { step: number; total: number } | null {
  if ((at !== "consent" && at !== "interview" && at !== "confirm") || d.edgeCity === false) return null; // not at Edge City: the waitlist
  const romance = (d.lookingFor ?? []).includes("romance");
  const fields: Field[] = ["edgeCity", "name", "lookingFor"];
  if (romance) fields.push("relStatus");
  if (romance && (d.relStatus === "single" || d.relStatus === "complicated")) fields.push("openness");
  if (romance) fields.push("genderInterest");
  fields.push("interests", "bio", "contact");
  const total = fields.length + 2;
  if (at === "consent") return { step: 1, total };
  if (at === "confirm") return { step: total, total };
  const next = nextField(d);
  return { step: next ? fields.indexOf(next) + 2 : total, total };
}

const oneOf = (v: unknown, allowed: string[]) => (typeof v === "string" && allowed.includes(v) ? v : undefined);
const TELEGRAM = /^[A-Za-z0-9_]{4,32}$/;

export type Extracted = {
  name?: string | null; relStatus?: string | null; openness?: string | null; lookingFor?: string[] | null; gender?: string | null;
  interestedIn?: string | null; interests?: string[] | null; bio?: string | null; telegram?: string | null;
  contactMethod?: string | null; notes?: string[] | null; skipped?: boolean | null;
};

/**
 * Merges what the model extracted into the draft, keeping only valid values. A skipped (or unanswered)
 * optional question is marked asked so it is not asked again.
 */
export function mergeDraft(d: Draft, x: Extracted, askedField: Field | null): Draft {
  const out: Draft = { ...d, asked: [...(d.asked ?? [])] };
  if (typeof x.name === "string" && x.name.trim()) out.name = x.name.trim().slice(0, 40);
  out.relStatus = oneOf(x.relStatus, ids(REL_STATUS)) ?? out.relStatus;
  out.openness = oneOf(x.openness, ids(OPENNESS)) ?? out.openness;
  if (Array.isArray(x.lookingFor)) {
    const lf = [...new Set(x.lookingFor.filter((v) => ids(LOOKING_FOR).includes(v)))];
    if (lf.length) out.lookingFor = lf;
  }
  out.gender = oneOf(x.gender, ids(GENDER)) ?? out.gender;
  out.interestedIn = oneOf(x.interestedIn, ids(INTERESTED_IN)) ?? out.interestedIn;
  if (Array.isArray(x.interests)) {
    // Once each, whatever the case ("startups" again from the model after a tapped "AI, startups, surfing").
    const all = [...(out.interests ?? []), ...x.interests.filter((s) => typeof s === "string").map((s) => s.trim().slice(0, 30)).filter(Boolean)];
    const merged = all.filter((s, i) => all.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i);
    out.interests = merged.slice(0, 15);
  }
  if (typeof x.bio === "string" && x.bio.trim()) out.bio = x.bio.trim().slice(0, 160);
  if (typeof x.telegram === "string") {
    const t = x.telegram.trim().replace(/^(https?:\/\/)?(t\.me\/)/i, "").replace(/^@/, "");
    if (TELEGRAM.test(t)) {
      out.telegram = t;
      out.contactMethod = "telegram";
    }
  }
  if (x.contactMethod === "phone") out.contactMethod = "phone";
  if (Array.isArray(x.notes)) out.notes = [...new Set([...(out.notes ?? []), ...x.notes.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim().slice(0, 280))])].slice(-10);
  // The question just asked got no usable answer: optional ones count as skipped.
  if (askedField && ["relStatus", "openness", "genderInterest", "bio", "interests"].includes(askedField)) {
    const answered = nextField({ ...out, asked: out.asked }) !== askedField;
    if (x.skipped || !answered) out.asked!.push(askedField);
  }
  out.asked = [...new Set(out.asked)];
  return out;
}

const list = (l: readonly { id: string; label: string }[], v: string[] | undefined) => (v ?? []).map((x) => label(l, x) || x).join(", ");

/** The recap before sign-up: short, everything the profile will hold. */
export function recapText(d: Draft, phone: string) {
  const contact = d.contactMethod === "phone" ? `this number (${phone})` : d.telegram ? `Telegram @${d.telegram}` : null;
  const lines = [
    `Here's your profile: ${d.name}.`,
    d.edgeCity ? `At Edge City India${d.edgeWeeks?.length ? `: ${weeksText(d.edgeWeeks)}` : ""}.` : "",
    `Here for: ${list(LOOKING_FOR, d.lookingFor)}.`,
    `Interests: ${(d.interests ?? []).slice(0, 6).join(", ")}.`,
    d.bio ? `About: ${clip(d.bio, 80)}` : "",
    d.relStatus && (d.lookingFor ?? []).includes("romance") ? `Status (private): ${label(REL_STATUS, d.relStatus)}.` : "",
    contact ? `Matches reach you via ${contact}.` : "Matches message you here in Kismet (send your Telegram username anytime to add it).",
    "Reply YES to sign up, or tell me what to change.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** The website's "skip" on the contact question: no Telegram, matches message them in Kismet (lib/views.ts contactFor). */
export const SKIP_CONTACT = "Skip, message me in Kismet";
/** The tap-to-answer interest sets the website offers (lib/text/web-chat.ts). */
export const INTEREST_SETS = ["AI, startups, surfing", "Music, art, yoga", "Books, hiking, food"] as const;

const sameText = (a: string, b: string) => a.trim().replace(/[.!]+$/, "").toLowerCase() === b.toLowerCase();
const byLabel = <T extends { id: string; label: string }>(l: readonly T[], text: string) => l.find((o) => sameText(text, o.label))?.id;

/**
 * A reply that is exactly one of the offered answers (a tapped suggestion, or the same words typed) read without the
 * model: no wait, and nothing for the model to misread. Anything else is null and goes to the model as before.
 */
export function chipAnswer(field: Field | null, text: string): Extracted | null {
  const t = text.trim();
  if (!field || !t || t.length > 60) return null;
  const skip = /^(skip|skip for now|skip it|pass)$/i.test(t.replace(/[.!]+$/, ""));
  switch (field) {
    case "relStatus": {
      const id = byLabel(REL_STATUS, t);
      return id ? { relStatus: id } : null;
    }
    case "openness": {
      if (skip) return { skipped: true };
      const id = byLabel(OPENNESS, t);
      return id ? { openness: id } : null;
    }
    case "lookingFor": {
      const parts = t.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean);
      const found = parts.map((x) => byLabel(LOOKING_FOR, x));
      return found.length && found.every(Boolean) ? { lookingFor: [...new Set(found as string[])] } : null;
    }
    case "genderInterest": {
      if (skip) return { skipped: true };
      const m = /^(.+?),\s*into\s+(.+)$/i.exec(t);
      const gender = m && byLabel(GENDER, m[1]);
      const interestedIn = m && byLabel(INTERESTED_IN, m[2]);
      return gender && interestedIn ? { gender, interestedIn } : null;
    }
    case "interests": {
      const set = INTEREST_SETS.find((x) => sameText(t, x));
      return set ? { interests: set.split(",").map((x) => x.trim()) } : null;
    }
    case "bio":
      return skip ? { skipped: true } : null;
    case "contact":
      return skip || sameText(t, SKIP_CONTACT) ? { skipped: true } : null;
    default:
      return null;
  }
}

/** The profile fields for sign-up (validated again by the app's profile schema). */
export function draftProfile(d: Draft) {
  // The private answers only with Romance (nextField asks them only then; one given and Romance dropped later is not kept).
  const romance = (d.lookingFor ?? []).includes("romance");
  return {
    name: d.name, relStatus: romance ? d.relStatus ?? "undisclosed" : "undisclosed", openness: romance ? d.openness ?? null : null, lookingFor: d.lookingFor ?? [],
    gender: romance ? d.gender ?? null : null, interestedIn: romance ? d.interestedIn ?? null : null, interests: d.interests ?? [], bio: d.bio ?? "",
    telegram: d.contactMethod === "telegram" ? d.telegram ?? "" : "",
    edgeCity: d.edgeCity === true ? true : undefined, edgeWeeks: d.edgeWeeks ?? [],
  };
}

// ---- Contact reveal on a mutual match ------------------------------------------------------------------

export type ContactInfo = { telegram: string; contactMethod: string | null; contactPhone: string | null; contactChannel?: string | null };

/** How a match reaches this person: their phone only when they chose it, else Telegram. */
export function contactOf(c: ContactInfo) {
  if (c.contactMethod === "phone" && c.contactPhone) {
    const digits = c.contactPhone.replace(/\D/g, "");
    return { kind: "phone" as const, value: c.contactPhone, link: `https://wa.me/${digits}`, text: `WhatsApp ${c.contactPhone} (wa.me/${digits})` };
  }
  if (c.telegram) return { kind: "telegram" as const, value: c.telegram, link: `https://t.me/${c.telegram}`, text: `Telegram t.me/${c.telegram}` };
  return { kind: "app" as const, value: "", link: null, text: "a message in the Kismet app" };
}

/** The Telegram username a match may see: only when Telegram is how they chose to be reached. */
export const revealTelegram = (c: ContactInfo) => (contactOf(c).kind === "telegram" ? c.telegram : "");

export type ContactChoice = { method: "telegram" | "phone"; phone: string | null };

/**
 * Saves how matches reach this person; a change (not the first choice, not a no-op) also writes a
 * profile_history row (#13). io: the users update and recordContactChange in production, fakes in tests.
 */
export async function applyContact(
  io: { save(c: ContactChoice): Promise<void>; record(before: ContactChoice, after: ContactChoice): Promise<void> },
  before: ContactChoice | null, after: ContactChoice,
) {
  await io.save(after);
  if (before && (before.method !== after.method || before.phone !== after.phone)) await io.record(before, after);
}

export const HELP =
  "Text me anytime. Commands: MATCHES, PROFILE, EDIT <field> <value> (name, bio, interests, looking, status, telegram, contact), MORE, NOTES, SIGNALS, EVENTS, PRIVACY, PAUSE / RESUME, LINK <code>, DELETE ME, STOP.";
