import { createHash, randomBytes } from "node:crypto";

// Waitlist for people outside Edge City India and for the app launch. All logic runs against an injected
// store (Neon in production, in-memory in tests), so it has no database or framework imports.

export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];
/** Places a referral moves you up. */
export const REFERRAL_BOOST = 3;
/** Sign-up attempts per IP per hour (checked before anything else, so emails can't be probed). */
export const WAITLIST_PER_IP_HOUR = 10;

export type WaitlistInput = {
  email: string;
  name: string;
  place: string;
  handle: string;
  interests: string[];
  platforms: Platform[];
  ref: string | null;
};

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const REF = /^[a-z0-9]{8}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** "bot" when the hidden honeypot field was filled in (answer as if it worked, store nothing). */
export function parseWaitlist(body: unknown): { input: WaitlistInput } | { error: string } | "bot" {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (typeof b.website === "string" && b.website.trim()) return "bot";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return { error: "Enter a valid email address." };
  if (b.consent !== true) return { error: "Tick \"Email me when Kismet opens\" to join." };
  const interests = Array.isArray(b.interests)
    ? [...new Set(b.interests.map((s) => text(s, 30)).filter(Boolean))].slice(0, 12)
    : [];
  const platforms = Array.isArray(b.platforms) ? PLATFORMS.filter((p) => (b.platforms as unknown[]).includes(p)) : [];
  const handle = text(b.handle, 60).replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram\.com|x\.com|twitter\.com)\//i, "");
  const ref = typeof b.ref === "string" && REF.test(b.ref) ? b.ref : null;
  return { input: { email, name: text(b.name, 60), place: text(b.place, 80), handle: handle.slice(0, 40), interests, platforms, ref } };
}

/** Created order minus REFERRAL_BOOST places per referral, never above #1. */
export const position = (order: number, referrals: number) => Math.max(1, order - REFERRAL_BOOST * referrals);

export const newRefCode = () => {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join("");
};
export const newRemovalToken = () => randomBytes(24).toString("base64url");
export const removalHash = (token: string) => createHash("sha256").update(`agent-dates-waitlist:${token}`).digest("hex");

export type WaitlistRow = { refCode: string; order: number; referrals: number };
export type WaitlistStore = {
  /** Counts one attempt for this IP hash; false once over the hourly limit. */
  hit(ipHash: string): Promise<boolean>;
  byEmail(email: string): Promise<WaitlistRow | null>;
  refExists(code: string): Promise<boolean>;
  /** Null when the email is already on the list (a concurrent sign-up won). */
  insert(row: WaitlistInput & { refCode: string; referredBy: string | null; removalHash: string; ipHash: string }): Promise<WaitlistRow | null>;
};

export type JoinResult =
  | { ok: true; existing: boolean; position: number; refCode: string; removalToken: string | null }
  | { ok: true; bot: true }
  | { ok: false; status: number; error: string };

export async function joinWaitlist(store: WaitlistStore, body: unknown, ipHash: string): Promise<JoinResult> {
  if (!(await store.hit(ipHash))) return { ok: false, status: 429, error: "Too many sign-ups from this network. Try again in an hour." };
  const parsed = parseWaitlist(body);
  if (parsed === "bot") return { ok: true, bot: true };
  if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };
  const { input } = parsed;
  const show = (r: WaitlistRow, existing: boolean, removalToken: string | null): JoinResult =>
    ({ ok: true, existing, position: position(r.order, r.referrals), refCode: r.refCode, removalToken });
  const found = await store.byEmail(input.email);
  if (found) return show(found, true, null);
  const referredBy = input.ref && (await store.refExists(input.ref)) ? input.ref : null;
  const token = newRemovalToken();
  const row = await store.insert({ ...input, refCode: newRefCode(), referredBy, removalHash: removalHash(token), ipHash });
  if (row) return show(row, false, token);
  const raced = await store.byEmail(input.email);
  return raced ? show(raced, true, null) : { ok: false, status: 409, error: "Please try again." };
}
