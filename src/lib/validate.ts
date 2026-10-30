import { z } from "zod";
import { publicInterests, stripContacts } from "./contacts.ts";
import { AVAILABILITY, GENDER, INTERESTED_IN, LOOKING_FOR, OPENNESS, REL_STATUS, type ProfileInput } from "./options.ts";
import { EDGE_WEEKS, normalizeEdgeCity, normalizeWeeks } from "./edge-city.ts";
import { stripControls, stripControlsDeep } from "./controls.ts";

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((o) => o.id) as [T[number]["id"], ...T[number]["id"][]];

/**
 * Telegram's own username format (letters, digits, underscores; starts with a letter, never ends with one), 4-32 long
 * (4: Telegram's collectible names; ordinary ones are 5+). "12345" or "_____" are not anyone's username.
 */
export const TELEGRAM_FORMAT = /^[A-Za-z][A-Za-z0-9_]{2,30}[A-Za-z0-9]$/;
const bareTelegram = (s: string) => s.trim().replace(/^(https?:\/\/)?(t\.me\/|telegram\.me\/)/i, "").replace(/^@/, "");

const clean = (max: number) =>
  z
    .string()
    .transform(stripControls)
    .pipe(z.string().trim().max(max * 2))
    .transform((s) => stripContacts(s.replace(/\s+\n/g, "\n")).slice(0, max));

export const profileSchema = z
  .object({
    name: z.string().transform(stripControls).pipe(z.string().trim().min(1).max(40)).transform(stripContacts),
    relStatus: z.enum(ids(REL_STATUS)).default("undisclosed"),
    openness: z.enum(ids(OPENNESS)).nullable().default(null),
    lookingFor: z.array(z.enum(ids(LOOKING_FOR))).min(1).max(6).transform((a) => [...new Set(a)]),
    gender: z.enum(ids(GENDER)).nullable().default(null),
    interestedIn: z.enum(ids(INTERESTED_IN)).nullable().default(null),
    interests: z
      .array(z.string().transform(stripControls).pipe(z.string().trim().min(1).max(30)))
      .max(15)
      .transform((a) => [...new Set(publicInterests(a))]), // no contacts, no app-name chip next to a handle chip (QA3 N3-M1)
    bio: clean(160).default(""),
    telegram: z
      .string()
      .trim()
      .transform((s) => s.replace(/^(https?:\/\/)?(t\.me\/|telegram\.me\/)/i, "").replace(/^@/, ""))
      .pipe(z.string().regex(TELEGRAM_FORMAT, "Telegram usernames are 4-32 letters, numbers or underscores, start with a letter and don't end with _")),
    agentProfile: clean(1500).default(""),
    agentName: clean(40).default(""),
    agentPersonality: clean(140).default(""),
    publicQuotes: z.boolean().default(false),
    xHandle: z
      .string()
      .trim()
      .transform((s) => s.replace(/^(https?:\/\/)?(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, ""))
      .pipe(z.string().regex(/^[A-Za-z0-9_]{0,15}$/, "X usernames are up to 15 letters, numbers or underscores"))
      .default(""),
    useXPhoto: z.boolean().default(false),
    // Optional and not private: left out, an edit keeps what they had (lib/actions.ts updateProfile).
    availability: z.enum(ids(AVAILABILITY)).optional(),
    area: clean(40).optional(),
    // Edge City India (lib/edge-city.ts): self-attested. Left out = unchanged (a new account: not asked yet).
    edgeCity: z.boolean({ error: "answer true (yes, at Edge City India) or false (no)" }).optional(),
    edgeWeeks: z.array(z.enum(ids(EDGE_WEEKS))).max(3).optional(),
  })
  .transform((p): ProfileInput => {
    const romance = p.lookingFor.includes("romance");
    return {
      ...p,
      gender: romance ? p.gender : null,
      interestedIn: romance ? p.interestedIn : null,
      useXPhoto: p.useXPhoto && Boolean(p.xHandle),
    };
  });

// Agents may send labels ("In a relationship", "Co-founder") or ids, and the chat field names
// (status, about). Map everything to the ids the schema expects; unknown values fail validation.
const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const ALIASES: Record<string, string> = {
  inarelationship: "relationship", taken: "relationship", itscomplicated: "complicated",
  prefernottosay: "undisclosed", skip: "undisclosed", monogamous: "mono", polyamorous: "poly",
  openrelationship: "open", notsure: "unsure", cofounder: "cofounder", adventurebuddy: "adventure",
  justvibes: "vibes", friend: "friends", collaborator: "collaborators", aman: "man", awoman: "woman",
  male: "man", female: "woman",
};
// Only for availability ("both" or "any" must never turn interestedIn into "flexible").
const AVAILABILITY_ALIASES: Record<string, string> = {
  weekday: "weekday_evenings", weekdays: "weekday_evenings", evenings: "weekday_evenings", weeknights: "weekday_evenings",
  weekdayevening: "weekday_evenings", weekend: "weekends", anytime: "flexible", any: "flexible", either: "flexible", both: "flexible",
};
function toId<T extends readonly { id: string; label: string }[]>(list: T, v: unknown) {
  if (typeof v !== "string") return v;
  const k = key(v);
  return ALIASES[k] ?? list.find((o) => key(o.id) === k || key(o.label) === k)?.id ?? v;
}

function normalize(body: unknown) {
  if (!body || typeof body !== "object") return body;
  const b = { ...(body as Record<string, unknown>) };
  b.relStatus ??= b.status;
  b.bio ??= b.about;
  for (const k of ["relStatus", "openness", "gender", "interestedIn"]) if (b[k] === "" || b[k] === undefined) b[k] = null;
  if (b.relStatus === null) b.relStatus = "undisclosed";
  b.relStatus = toId(REL_STATUS, b.relStatus);
  b.openness = toId(OPENNESS, b.openness);
  b.gender = toId(GENDER, b.gender);
  b.interestedIn = toId(INTERESTED_IN, b.interestedIn);
  if (typeof b.lookingFor === "string") b.lookingFor = b.lookingFor.split(",");
  if (Array.isArray(b.lookingFor)) b.lookingFor = b.lookingFor.map((v) => toId(LOOKING_FOR, typeof v === "string" ? v.trim() : v));
  if (typeof b.interests === "string") b.interests = b.interests.split(",");
  b.availability ??= b.free;
  if (b.availability === "" || b.availability === null) b.availability = undefined;
  if (typeof b.availability === "string") b.availability = AVAILABILITY_ALIASES[key(b.availability)] ?? toId(AVAILABILITY, b.availability);
  if (b.area === null) b.area = undefined;
  // "Are you at Edge City India?": true / false / "yes" / "no" (also atEdgeCity, edge_city); weeks as ids or labels.
  // Present but unreadable ("not sure", "maybe"): kept as given, so the schema refuses it. Never read as left out,
  // which a store app's sign-up would turn into a yes (lib/edge-city.ts signupEdgeCity).
  const rawEdge = b.edgeCity ?? b.atEdgeCity ?? b.edge_city;
  const edge = normalizeEdgeCity(rawEdge);
  b.edgeCity = edge === undefined && rawEdge !== undefined && rawEdge !== null && String(rawEdge).trim() !== "" ? rawEdge : edge;
  b.edgeWeeks = normalizeWeeks(b.edgeWeeks ?? b.weeks ?? b.edge_weeks);
  delete b.atEdgeCity;
  delete b.edge_city;
  delete b.edge_weeks;
  delete b.weeks;
  for (const k of ["bio", "agentProfile", "agentName", "agentPersonality", "xHandle"]) if (b[k] === null) b[k] = undefined;
  return b;
}

/**
 * opts.telegramOptional: Kismet-by-text sign-ups whose matches reach them by phone have no Telegram.
 * opts.keepTelegram: the account's Telegram today; sent back unchanged, it is kept even if it predates TELEGRAM_FORMAT
 * (an edit never fails on a handle saved under the old rule).
 */
export function parseProfile(body: unknown, opts: { telegramOptional?: boolean; keepTelegram?: string } = {}) {
  // Control characters out of every field first (lib/controls.ts): a NUL is stripped, never a 500.
  const b = normalize(stripControlsDeep(body)) as Record<string, unknown> | undefined;
  const noTelegram = opts.telegramOptional && b && typeof b === "object" && !(typeof b.telegram === "string" && b.telegram.trim());
  const kept = !noTelegram && opts.keepTelegram && b && typeof b === "object" && typeof b.telegram === "string"
    && bareTelegram(b.telegram).toLowerCase() === bareTelegram(opts.keepTelegram).toLowerCase() ? bareTelegram(b.telegram) : null;
  const r = profileSchema.safeParse(noTelegram || kept ? { ...b, telegram: "kismet_text" } : b);
  if (r.success && noTelegram) r.data.telegram = "";
  if (r.success && kept) r.data.telegram = kept;
  if (!r.success) {
    const issue = r.error.issues[0];
    return { error: `${issue.path.join(".") || "input"}: ${issue.message}` } as const;
  }
  return { profile: r.data } as const;
}

type Reach = { telegram: string; contactMethod: string | null; contactPhone: string | null };

/** Matches reach this account on WhatsApp (lib/text/parse.ts contactOf), so its Telegram is optional. */
export const reachedByPhone = (me: Reach) => me.contactMethod === "phone" && Boolean(me.contactPhone);

/**
 * May this account save a profile without a Telegram? Yes when matches reach it on WhatsApp, or when it has none today
 * (nothing is taken away; a match reaches it in the Kismet app). Never for an account whose matches reach it on Telegram.
 */
export const telegramOptionalFor = (me: Reach) => reachedByPhone(me) || !me.telegram;

/**
 * A profile edit (PATCH /api/me, the web Edit page): a Telegram left out stays as it is, an empty one is accepted only
 * when telegramOptionalFor allows it (a WhatsApp account clears it), and a given one is checked as at sign-up.
 */
export function parseEdit(body: unknown, me: Reach) {
  body = stripControlsDeep(body);
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const optional = telegramOptionalFor(me);
  if (b && b.telegram !== undefined && b.telegram !== null && typeof b.telegram !== "string") return { error: "telegram: send a username, as text" } as const;
  if (b && !optional && (b.telegram === null || (typeof b.telegram === "string" && !b.telegram.trim())))
    return { error: "telegram: your matches reach you on Telegram, so it can't be left empty" } as const;
  return parseProfile(b && b.telegram === undefined ? { ...b, telegram: me.telegram } : body, { telegramOptional: optional, keepTelegram: me.telegram });
}
