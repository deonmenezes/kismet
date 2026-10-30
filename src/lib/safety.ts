import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stripControls } from "./controls.ts";

// Reports, blocks and moderation: request checks with no database or framework imports (unit-tested directly).

export const REPORT_REASONS = ["harassment", "spam", "fake", "inappropriate", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** Distinct reporters that hide a person from everyone until an admin reviews them. */
export const AUTO_HIDE_REPORTERS = 3;
export const NOTE_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The date (or match: same id) that identifies the other person. Accepts "dateId" or "matchId". */
function pairId(b: Record<string, unknown>): string | { error: string } {
  const id = b.dateId ?? b.matchId;
  if (typeof id !== "string" || !UUID.test(id)) return { error: 'Send "dateId" (or "matchId") from your summary.' };
  return id.toLowerCase();
}

const asObject = (body: unknown) => (body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null);

export function parseReport(body: unknown): { dateId: string; reason: ReportReason; note: string; photoId: string | null } | { error: string } {
  const b = asObject(body);
  if (!b) return { error: "Body must be a JSON object." };
  const dateId = pairId(b);
  if (typeof dateId !== "string") return dateId;
  if (typeof b.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(b.reason)) {
    return { error: `reason must be one of: ${REPORT_REASONS.join(", ")}.` };
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") return { error: "note must be a string." };
  const note = typeof b.note === "string" ? stripControls(b.note).trim() : "";
  if (note.length > NOTE_MAX) return { error: `note is over ${NOTE_MAX} characters.` };
  if (b.photoId !== undefined && b.photoId !== null && (typeof b.photoId !== "string" || !UUID.test(b.photoId))) return { error: "photoId must be one of their photo ids." };
  return { dateId, reason: b.reason as ReportReason, note, photoId: typeof b.photoId === "string" ? b.photoId.toLowerCase() : null };
}

export function parseBlock(body: unknown): { dateId: string } | { error: string } {
  const b = asObject(body);
  if (!b) return { error: "Body must be a JSON object." };
  const dateId = pairId(b);
  return typeof dateId === "string" ? { dateId } : dateId;
}

/**
 * Block, unblock or report on a recommendation or match that is no longer there (the other person deleted their
 * account, or the app's list is out of date): 410 Gone with a plain answer, the same for every such id (unknown or
 * someone else's too, so nothing can be probed). Never a 404: the app reads 404 as "not available yet".
 */
export const GONE = {
  block: { error: "gone", text: "This recommendation or match is no longer there (they may have left Kismet), so there's no one to block. You won't see them again." },
  unblock: { error: "gone", text: "There's no block on this one any more. Nothing to undo." },
  report: { error: "gone", text: "This recommendation or match is no longer there (they may have left Kismet), so it can't be reported from here. If something happened, email us from the Support page." },
} as const;

/** A banned or auto-hidden person is invisible to everyone and cannot go on dates. */
export const isSuspended = (u: { bannedAt: string | null; hiddenAt: string | null }) => Boolean(u.bannedAt || u.hiddenAt);

/** ADMIN_KEY check: a key of at least 24 characters, compared in constant time (hashed both sides). */
export function adminKeyOk(given: string | null | undefined, key: string | undefined) {
  if (!key || key.length < 24 || !given || given.length > 512) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(key));
}

export const ADMIN_COOKIE = "ad_admin";
export const ADMIN_SESSION_SECONDS = 12 * 3600;
const adminMac = (key: string, issued: number) => createHmac("sha256", `agent-dates-admin:${key}`).update(String(issued)).digest("hex");
/**
 * The admin session cookie: "<issued at>.<HMAC of it keyed by ADMIN_KEY>". The key itself never sits in a cookie,
 * and the server checks the age, so a copied cookie stops working after 12 hours (or when the key changes).
 */
export const adminSession = (key: string, now = Date.now()) => {
  const issued = Math.floor(now / 1000);
  return `${issued}.${adminMac(key, issued)}`;
};

export function adminCookieOk(cookie: string | null | undefined, key: string | undefined, now = Date.now()) {
  if (!key || key.length < 24 || !cookie || cookie.length > 100) return false;
  const m = /^(\d{10})\.([0-9a-f]{64})$/.exec(cookie);
  if (!m) return false;
  const issued = Number(m[1]);
  const age = Math.floor(now / 1000) - issued;
  if (age < -60 || age > ADMIN_SESSION_SECONDS) return false;
  return timingSafeEqual(Buffer.from(m[2]), Buffer.from(adminMac(key, issued)));
}

/** Signup consent: both must be exactly true (or "yes"/"true" from a chat agent). */
export function consentError(body: unknown): string | null {
  const b = asObject(body) ?? {};
  const yes = (v: unknown) => v === true || (typeof v === "string" && /^(true|yes)$/i.test(v.trim()));
  if (!yes(b.ageConfirmed)) return "ageConfirmed: Kismet is 18+ only. Ask: are you 18 or older?";
  if (!yes(b.agreedToTerms)) return "agreedToTerms: the owner must agree to the Terms (/terms) to sign up.";
  return null;
}
