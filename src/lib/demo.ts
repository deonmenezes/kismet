import { createHash, timingSafeEqual } from "node:crypto";
import { foldName } from "./fold.ts";

// Demo accounts: the App Review reviewer ("Sam (demo)") and the partners its agent dates, made by
// agent-dates-mobile tools/demo_review.py for App Review and the store screenshots. They live in their own pool:
// they date, are recommended, dropped, matched and shown only with each other, never with real residents (and
// real residents never with them), and stay off the public board and counters. users.is_demo (db/schema.sql) is set
// by the migration for the demo accounts that already exist, and at sign-up only with the server's DEMO_SIGNUP_KEY
// (header X-Kismet-Demo-Key): a demo name and handle alone never make an account a demo (anyone could type them, and
// would then reach App Review's account), and without the key they are refused (so no demo account is ever made real).
export const DEMO_HANDLES = ["kismet_review_demo", "maya_demo_kismet", "arjun_demo_kismet", "priya_demo_kismet", "leo_demo_kismet", "zara_demo_kismet"] as const;

// Compared folded (lib/fold.ts: NFKC, lookalike letters, lower case, one space), so "Sam (Demo)", "Sam\u00a0(demo)",
// "Sam （demo）", "Sam (demo)." or "KISMET_REVIEW_DEMO" are the same name and handle (QA2 N-L3: they got through).
const handleOf = (telegram: string) => telegram.trim().replace(/^@/, "").toLowerCase();
const isDemoHandle = (telegram: string) => (DEMO_HANDLES as readonly string[]).includes(handleOf(telegram));
/** A name marked "(demo)" anywhere, however it is spaced, cased or punctuated. */
const demoName = (name: string) => /\(\s*demo\s*\)/.test(foldName(name));

/** A demo profile: one of the demo Telegram handles and a name ending "(demo)" (folded). What a demo account is made of. */
export const isDemoProfile = (p: { name: string; telegram: string }) =>
  isDemoHandle(p.telegram) && /\(\s*demo\s*\)[\s.!,:;-]*$/.test(foldName(p.name));

/** Why a reserved demo name and handle are refused (the text chat puts it after "needs a fix: "). */
export const DEMO_RESERVED = "that name and Telegram username are reserved for Kismet's demo accounts, so please use your own";
export const DEMO_RESERVED_TEXT = "That name and Telegram username are reserved for Kismet's demo accounts. Please use your own.";

/**
 * A profile that takes a demo account's name OR handle without being one: refused on every door (/api/signup without the
 * demo key, partner API and MCP sign-ups, profile edits, the text chat), so no real account can pass for "Sam (demo)" or
 * show the reviewer's Telegram. Only /api/signup with the demo key makes a demo account, and a demo account may keep its
 * own name and handle when it edits its profile.
 */
export const reservedForDemo = (p: { name: string; telegram: string }, isDemo = false) => !isDemo && (demoName(p.name) || isDemoHandle(p.telegram));

/** The sign-up's X-Kismet-Demo-Key against DEMO_SIGNUP_KEY (24+ characters), in constant time. No key set: never. */
export function demoKeyOk(given: string | null | undefined, key = process.env.DEMO_SIGNUP_KEY) {
  if (!key || key.length < 24 || !given || given.length > 512) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(key));
}
