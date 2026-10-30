import { createHmac } from "node:crypto";
import { sql } from "./db";
import { AUTO_HIDE_REPORTERS } from "./safety";
import { stripContacts, withoutNames } from "./contacts";
import { logActivity } from "./records";
import { SYSTEM } from "./client";

// Reports are kept when the reported person deletes their account (Deon, 2026-10-28: "Keep reports + update policy"),
// so a banned or reported person can't delete and rejoin with a clean record. Each report carries one-way keyed hashes
// (HMAC-SHA256 with SAFETY_HASH_KEY) of the reported person's contacts: Telegram, phone numbers, sign-in emails and the
// Agent Village resident key. Never the contacts themselves. Kept reports (the account gone) are deleted 12 months later.
//
// Which contacts go on a report (Telegram usernames are never verified, so a handle typed later must not poison anyone):
// - when it is filed: all of them, Telegram included;
// - when a contact changes: only the verified ones (a linked WhatsApp number, a sign-in email, the resident key);
// - when the account is banned or deleted (and on a report, and the daily backfill): all of them, but the Telegram only
//   while the account is not hidden or banned (a hidden or banned person typing someone else's handle adds nothing).
// A match hides an account pending review, never bans it: an admin sees the history in /admin and can restore it.
// Only a verified contact (a phone number, a sign-in email, the Agent Village key) can hide. A Telegram match alone never
// hides (QA2 N-M2: anyone can type anyone's handle, so an impersonator reported or banned under a real person's handle
// would get its real owner hidden): it is flagged for /admin ("report_history_telegram") and shown in the history there.

/** Kept reports (the reported account was deleted) are deleted this long after the deletion (the daily job). */
export const KEPT_REPORT_MONTHS = 12;
const KEY_MIN = 32;

export type Contacts = { telegram?: string | null; phones?: (string | null | undefined)[]; emails?: (string | null | undefined)[]; village?: string | null };

// Handles people type when they have none (QA2 N-L1: "xxxxx", "nohandle", "no_tg" were hashed, so a stranger who typed the
// same placeholder inherited a banned account's history). Never hashed, whatever the validation lets through.
const NOT_A_HANDLE = new Set([
  "none", "nope", "null", "test", "tests", "na_na", "na_na_na", "unknown", "telegram", "kismet_text", "no_telegram", "notelegram",
  "nohandle", "no_handle", "nohandles", "no_tg", "notg", "notgyet", "no_tg_yet", "notelegramyet", "dont_have", "dont_have_one", "donthave",
  "idonthave", "idonthaveone", "i_dont_have", "nothing", "noone", "no_one", "nobody", "nope_", "none_", "null_", "abcde", "abcdef", "abcdefg",
  "qwerty", "qwertyu", "asdfg", "asdfgh", "asdfghjkl", "username", "user_name", "myusername", "my_username", "handle", "myhandle", "my_handle",
  "telegramhandle", "telegram_handle", "notavailable", "not_available", "notapplicable", "skip_this", "testing", "tester", "testuser", "test_user",
  "example", "sample", "dummy", "placeholder", "later", "will_add", "willadd", "add_later", "addlater", "tbd_tbd", "na_na_na_na",
]);
// The real format (start with a letter, letters / digits / underscores, not ending with one), 5+ like ordinary usernames.
const HANDLE = /^[a-z][a-z0-9_]{3,30}[a-z0-9]$/;
/** One character over and over ("xxxxx", "aaaaa"), or a run of the alphabet / keyboard / digits. */
const filler = (h: string) => /^(.)\1+$/.test(h.replace(/_/g, "")) || (/^(abc|xyz|qwe|asd|zxc)/.test(h) && h.replace(/_/g, "").length <= 7);
/** Telegram usernames are case-insensitive; a t.me link or a leading @ is the same handle. Placeholders, short and malformed ones: "". */
export const normalizeTelegram = (s: string) => {
  const h = s.trim().replace(/^(https?:\/\/)?(t\.me\/|telegram\.me\/)/i, "").replace(/^@/, "").toLowerCase();
  return HANDLE.test(h) && !NOT_A_HANDLE.has(h) && !filler(h) ? h : "";
};
/** Digits only (E.164 without the +), for something that looks like a phone number; anything else (an iMessage email): "". */
export const normalizePhone = (s: string) => {
  const t = s.trim().replace(/[\s().-]/g, "");
  return /^\+?\d{7,15}$/.test(t) ? t.replace(/^\+/, "") : "";
};
/** Lowercase, without a +tag; Gmail ignores dots and googlemail.com is gmail.com. */
export function normalizeEmail(s: string) {
  const e = s.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return "";
  const local = e.slice(0, at).replace(/\+.*$/, "");
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") return `${local.replace(/\./g, "")}@gmail.com`;
  return local ? `${local}@${domain}` : "";
}

let warned = false;
/**
 * SAFETY_HASH_KEY (32+ characters, the same in every environment: they share one database). Missing or short: null, and
 * nothing is hashed (fails closed: never a default key); sign-ups and reports work as before, only unchecked. Logged once.
 */
export function safetyKey(env: Record<string, string | undefined> = process.env): string | null {
  const k = env.SAFETY_HASH_KEY;
  if (k && k.length >= KEY_MIN) return k;
  if (!warned) {
    warned = true;
    const msg = `SAFETY_HASH_KEY is ${k ? `shorter than ${KEY_MIN} characters` : "not set"}: reports are kept without contact hashes and re-sign-ups are not checked.`;
    if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") console.error(msg);
    else console.warn(msg);
  }
  return null;
}

/** The sorted, distinct HMACs of these contacts ("tg:", "phone:", "email:", "village:" + the normalized value). */
export function contactKeys(c: Contacts, key: string | null = safetyKey()): string[] {
  if (!key) return [];
  const raw = [
    c.telegram ? `tg:${normalizeTelegram(c.telegram)}` : "",
    ...(c.phones ?? []).map((p) => (p ? `phone:${normalizePhone(p)}` : "")),
    ...(c.emails ?? []).map((e) => (e ? `email:${normalizeEmail(e)}` : "")),
    c.village ? `village:${c.village}` : "",
  ].filter((s) => s && !s.endsWith(":"));
  return [...new Set(raw.map((s) => createHmac("sha256", key).update(`kismet-report:${s}`).digest("hex")))].sort();
}

/** The account's contacts now, its state, and what a kept note must not mention. Null: no such account. */
async function account(userId: string) {
  const [u] = await sql`select u.name, u.telegram, u.x_handle, u.contact_phone, u.village_resident, u.is_demo, u.banned_at, u.hidden_at,
      coalesce((select array_agg(p.phone) from user_phones p where p.user_id = u.id and p.channel <> 'web'), '{}') as phones,
      coalesce((select array_agg(i.email) from auth_identities i where i.user_id = u.id and i.email <> ''), '{}') as emails
    from users u where u.id = ${userId}`;
  if (!u) return null;
  return {
    name: u.name as string, telegram: u.telegram as string, xHandle: u.x_handle as string, isDemo: u.is_demo as boolean,
    suspended: Boolean(u.banned_at || u.hidden_at),
    phones: [u.contact_phone as string | null, ...(u.phones as string[])], emails: u.emails as string[], village: u.village_resident as string | null,
  };
}
type Account = NonNullable<Awaited<ReturnType<typeof account>>>;

/** An account's hashes: none for demo accounts (lib/demo.ts: they stay on their side of the line) or without a key. */
const keysOf = (a: Account | null, extra: Contacts, telegram: boolean) => (!a || a.isDemo ? [] : contactKeys({
  telegram: telegram ? a.telegram : null,
  phones: [...a.phones, ...(extra.phones ?? [])],
  emails: [...a.emails, ...(extra.emails ?? [])],
  village: a.village,
}));

/** Every contact hash of an account now, Telegram included (what /admin's history shows). */
export const accountKeys = async (userId: string, extra: Contacts = {}) => (safetyKey() ? keysOf(await account(userId), extra, true) : []);

/** The hashes that may hide an account: its verified contacts only, never the Telegram (see the top of this file). */
export const hideKeys = async (userId: string, extra: Contacts = {}) => (safetyKey() ? keysOf(await account(userId), extra, false) : []);

/** What a new report about this account carries: every hash, but the Telegram only while it is not hidden or banned. */
export async function reportKeys(userId: string) {
  if (!safetyKey()) return [];
  const a = await account(userId);
  return keysOf(a, {}, Boolean(a && !a.suspended));
}

/** The note of a report that stands for an admin's ban with no report behind it (no reporter). Unban deletes it. */
export const BAN_NOTE = "Banned by an admin (no report).";

/** Adds hashes to the reports about this account (never removes any). */
async function addKeys(userId: string, keys: string[]) {
  if (!keys.length) return;
  await sql`update reports set reported_keys = array(select distinct k from unnest(reported_keys || ${keys}::text[]) as k order by k)
    where reported_id = ${userId} and not (reported_keys @> ${keys}::text[])`;
}

/** Before a ban (app/api/admin/action) and on the daily backfill: the account's hashes onto its reports (Telegram only while visible). */
export async function refreshReportKeys(userId: string) {
  await addKeys(userId, await reportKeys(userId));
}

/**
 * Hides `userId` pending review (unless already hidden or banned) when, counting the reports about this account and the
 * ones about any account with one of these contact hashes (verified ones only: hideKeys, never a Telegram) (a deleted one included): AUTO_HIDE_REPORTERS distinct reporters
 * count (the same rule as a report: accounts a day old, or verified, on the same side of the demo line), or such an account
 * was banned or hidden when it was deleted. Reports about other accounts filed before an admin restored this one
 * (history_reviewed_at) no longer count. A hide that other accounts' reports took part in is logged as "report_history".
 */
export async function hideOnHistory(userId: string, keys: string[]) {
  const [r] = await sql`update users set hidden_at = now() where id = ${userId} and hidden_at is null and banned_at is null and (
      exists (select 1 from reports r where r.reported_keys && ${keys}::text[] and r.reported_id is distinct from users.id
        and r.created_at > coalesce(users.history_reviewed_at, '-infinity'::timestamptz)
        and (r.reported_banned or r.reported_hidden or exists (select 1 from users b where b.id = r.reported_id and b.banned_at is not null)))
      or (select count(distinct r.reporter_id) from reports r join users ru on ru.id = r.reporter_id
        where (r.reported_id = users.id or (r.reported_keys && ${keys}::text[] and r.created_at > coalesce(users.history_reviewed_at, '-infinity'::timestamptz)))
          and r.status <> 'dismissed' and ru.is_demo = users.is_demo
          and (ru.created_at < r.created_at - interval '1 day' or ru.world_verified_at is not null)) >= ${AUTO_HIDE_REPORTERS})
    returning (select count(*) from reports r where r.reported_keys && ${keys}::text[] and r.reported_id is distinct from users.id)::int as others`;
  if (r?.others) await logActivity(userId, SYSTEM, "report_history", { reports: r.others });
  return Boolean(r);
}

/**
 * The report history check, on sign-up and whenever a contact changes (Telegram, phone, sign-in email, a linked number):
 * adds the account's verified contact hashes to the reports about it, then hides it pending review if an earlier account
 * with one of its contacts was banned or reported over the threshold (hideOnHistory). Never throws: a failed check must
 * not fail a sign-up. Returns true when it hid the account just now.
 */
export async function checkReportHistory(userId: string, extra: Contacts = {}) {
  try {
    if (!safetyKey()) return false;
    const a = await account(userId);
    if (!a) return false;
    const verified = keysOf(a, extra, false);
    await addKeys(userId, verified);
    await flagTelegramMatch(userId, a);
    return verified.length ? await hideOnHistory(userId, verified) : false;
  } catch (e) {
    console.error("report history check failed", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * A Telegram that is on reports about another account (deleted or not): never a hide (it is not verified), but logged
 * once per check as "report_history_telegram" so /admin lists the account with that history to look at.
 */
async function flagTelegramMatch(userId: string, a: Account) {
  const tg = a.isDemo ? [] : contactKeys({ telegram: a.telegram });
  if (!tg.length) return;
  const [m] = await sql`select count(*)::int as n from reports r where r.reported_keys && ${tg}::text[] and r.reported_id is distinct from ${userId}::uuid`;
  if (m?.n) await logActivity(userId, SYSTEM, "report_history_telegram", { reports: m.n });
}

/** A kept report's note: the reporter's words without contact details, the deleted person's name or their handles. */
export const keptNote = (note: string, names: string[]) => withoutNames(stripContacts(note), names, "them");

/**
 * Account deletion, part one (lib/actions.ts deleteUser, before its transaction): what the kept reports get. The hashes
 * (Telegram only while the account is not hidden or banned), and per report its note without contacts, name or handles.
 */
export async function keepReportsOf(userId: string) {
  const a = await account(userId);
  if (!a) return null;
  const rows = await sql`select id, note from reports where reported_id = ${userId}`;
  const names = [a.name, a.telegram, a.xHandle];
  return { keys: keysOf(a, {}, !a.suspended), ids: rows.map((r) => r.id as string), notes: rows.map((r) => keptNote(r.note as string, names)), names };
}

/** Account deletion, part two: reports filed while it was being deleted (not in part one) get their notes scrubbed too. */
export async function scrubLateNotes(ids: string[], names: string[]) {
  if (!ids.length) return;
  const late = await sql`select id, note from reports where id = any(${ids}::uuid[])`;
  for (const r of late) await sql`update reports set note = ${keptNote(r.note as string, names)} where id = ${r.id}`;
}

/**
 * The daily job (app/api/text/cron): kept reports whose account was deleted more than KEPT_REPORT_MONTHS ago go. A kept
 * report with no reported_gone_at (its account deleted by code that does not stamp it: a build from before, a rollback or
 * an old Preview still serving) goes KEPT_REPORT_MONTHS after it was filed, never sooner (QA2 N-L2: it went the next
 * morning, whatever its age, so such a deploy wiped that history). Returns how many went.
 */
export async function purgeKeptReports() {
  return (await sql`delete from reports where reported_id is null and (
      (reported_gone_at is not null and reported_gone_at < now() - make_interval(months => ${KEPT_REPORT_MONTHS}))
      or (reported_gone_at is null and created_at < now() - make_interval(months => ${KEPT_REPORT_MONTHS}))
    ) returning id`).length;
}

/**
 * The daily job: hashes for reports filed before this change (or while the key was missing), up to `limit` accounts a day,
 * picked at random (an account with nothing to hash can't hold the queue). As if filed now: the Telegram only while the
 * account is visible. Returns how many accounts were looked at.
 */
export async function backfillReportKeys(limit = 200) {
  if (!safetyKey()) return 0;
  const rows = await sql`select r.reported_id from reports r join users u on u.id = r.reported_id
    where r.reported_keys = '{}' and not u.is_demo group by r.reported_id order by random() limit ${limit}`;
  for (const r of rows) await refreshReportKeys(r.reported_id as string);
  return rows.length;
}

/**
 * For /admin: the reports behind a hide by history, i.e. about other accounts (a deleted one included) that share one of
 * this account's contact hashes, newest first.
 */
export async function historyOf(userId: string) {
  const keys = await accountKeys(userId);
  if (!keys.length) return [];
  return sql`select r.reason, r.note, r.status, r.created_at, r.reported_banned, r.reported_hidden, r.reported_gone_at, rp.name as reporter, ru.name as reported
    from reports r left join users rp on rp.id = r.reporter_id left join users ru on ru.id = r.reported_id
    where r.reported_keys && ${keys}::text[] and r.reported_id is distinct from ${userId}::uuid
    order by r.created_at desc limit 50`;
}
