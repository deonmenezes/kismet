import { stripControls } from "./controls.ts";

// Which client a request came from, for the records (signup source, last seen per channel, activity log).
// Unit-tested directly (no framework imports).
//
// Apps send `X-Kismet-Client: <channel>/<version>`, e.g. "ios/1.0.0", "imessage/1.0.0", "android/1.0.0".
// Sign-up bodies may carry the same as "client": "ios/1.0.0", or "channel": "ios" plus "appVersion": "1.0.0".
// Without either: a Bearer token is "api" (a resident's own agent calling the API), a cookie is "web".

export const CHANNELS = ["web", "ios", "imessage", "android", "village", "api", "mcp", "waitlist", "system", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];
/** channel: where it came from. client: "<channel>/<version>" when the client said its version, else "". */
export type Client = { channel: Channel; client: string };

/** What a client may say about itself. "village" comes only from the partner API, "system" only from us. */
const CLAIMABLE: readonly Channel[] = ["web", "ios", "imessage", "android", "api"];
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;

export const SYSTEM: Client = { channel: "system", client: "" };
export const VILLAGE: Client = { channel: "village", client: "" };
/** Kismet by text over WhatsApp (never claimable by a client header). */
export const WHATSAPP: Client = { channel: "whatsapp", client: "" };

function parse(channel: unknown, version: unknown): Client | null {
  if (typeof channel !== "string") return null;
  const ch = channel.trim().toLowerCase() as Channel;
  if (!CLAIMABLE.includes(ch)) return null;
  const v = typeof version === "string" && VERSION.test(version.trim()) ? version.trim() : "";
  return { channel: ch, client: v ? `${ch}/${v}` : "" };
}

/** "ios/1.0.0", "ios", "iOS/1.2 (build 7)": the first "<channel>[/<version>]" token. Null when not a known channel. */
export function parseClientHeader(header: string | null | undefined): Client | null {
  if (!header || header.length > 100) return null;
  const m = /^\s*([A-Za-z]+)(?:\/([^\s;,()]+))?/.exec(header);
  return m ? parse(m[1], m[2]) : null;
}

/** The optional client fields of a sign-up or edit body ("client": "ios/1.0.0", or "channel" + "appVersion"). */
export function bodyClient(body: unknown): Client | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.client === "string") return parseClientHeader(b.client);
  return parse(b.channel, b.appVersion ?? b.version);
}

/** Header first, then the body, then by how the request signed in. */
export function resolveClient(header: string | null | undefined, bearer: boolean, body?: unknown): Client {
  return parseClientHeader(header) ?? bodyClient(body) ?? { channel: bearer ? "api" : "web", client: "" };
}

// Profile fields kept in profile_history, in the order they are shown.
export const PROFILE_FIELDS = [
  "name", "telegram", "relStatus", "openness", "gender", "interestedIn", "lookingFor", "interests", "bio",
  "agentProfile", "agentName", "agentPersonality", "publicQuotes", "xHandle", "useXPhoto", "availability", "area",
  "edgeCity", "edgeWeeks",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** The fields whose value changed, with the previous and the new value (compared as JSON). */
export function profileChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: { field: ProfileField; old: unknown; new: unknown }[] = [];
  for (const f of PROFILE_FIELDS) {
    const o = before[f] ?? null;
    const n = after[f] ?? null;
    if (JSON.stringify(o) !== JSON.stringify(n)) out.push({ field: f, old: o, new: n });
  }
  return out;
}

// Agent notes ("what your agent knows about me"): short facts, no contact details (stripped by the caller).
export const NOTE_MAX = 280;
export const NOTES_PER_CALL = 10;
export const NOTES_KEPT = 50;

/** One note or a list of them ("note", "text" or "notes"): trimmed, 1-280 characters, at most 10 per call. */
export function parseNotes(body: unknown): string[] | { error: string } {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return { error: 'Send {"notes": ["<fact>", ...]} or {"text": "<fact>"}.' };
  const raw = b.notes ?? b.note ?? b.text;
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : null;
  if (!list || !list.length) return { error: 'Send {"notes": ["<fact>", ...]} or {"text": "<fact>"}.' };
  if (list.length > NOTES_PER_CALL) return { error: `At most ${NOTES_PER_CALL} notes per call.` };
  const out: string[] = [];
  for (const n of list) {
    if (typeof n !== "string") return { error: "Each note must be a string." };
    const t = stripControls(n).replace(/\s+/g, " ").trim();
    if (!t) return { error: "A note is empty." };
    if (t.length > NOTE_MAX) return { error: `A note is over ${NOTE_MAX} characters.` };
    out.push(t);
  }
  return [...new Set(out)];
}
