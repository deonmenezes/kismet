// Asking someone with no photo to add one, without nagging: the photo step in the chat right after sign-up, the first
// message of a chat session, the card on /home and the line on a match or plan card. Pure, for the browser and the
// tests (lib/photo-nudge.test.mjs).
// Whether a person may be asked at all is the server's (lib/photos.ts addPhotoHint: no photo, and they never removed
// one or said no to their Google picture). How often is this device's memory, in localStorage: no account state is
// written, so demo accounts follow the same rules and stay as they are.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** This device's memory of the photo asks (all of them share it). */
export const NUDGE_KEY = "kismet:photo-nudge";
/** The chat's earlier "Not now" ("no"): it said "never again on this device", so it still counts as for good. */
export const LEGACY_HINT_KEY = "kismet:photo-hint";
/** sessionStorage: the chat already mentioned the photo in this browser session. */
export const SESSION_KEY = "kismet:photo-ask";

/** Waved off once: back after this long, or a few hours before the next drop when that comes sooner. */
export const SNOOZE_MS = 3 * DAY;
const BEFORE_DROP_MS = 3 * HOUR;
/** Never back sooner than this, drop or not. */
const MIN_QUIET_MS = 12 * HOUR;
/** Waved off this many times: not asked again on this device. */
export const FOR_GOOD = 2;
/** An account this new has just signed up: the chat offers the photo step. */
export const FRESH_MS = DAY;
/** The chat's session mention, at most this often on this device (a phone opens many tabs: Telegram links, the app). */
export const ASK_GAP_MS = 20 * HOUR;

/** n: times waved off on this device; until: hidden before this time; asked: the last session mention (ms since 1970). */
export type NudgeMemo = { n: number; until: number; asked?: number };
export const NO_MEMO: NudgeMemo = { n: 0, until: 0 };

/** The stored memo (anything unreadable is a fresh start); the old chat "Not now" is for good. */
export function readMemo(raw: string | null | undefined, legacy: string | null = null): NudgeMemo {
  if (legacy === "no") return { n: FOR_GOOD, until: 0 };
  try {
    const m = JSON.parse(raw ?? "");
    if (Number.isInteger(m?.n) && m.n >= 0 && Number.isFinite(m?.until)) return { n: m.n, until: m.until, ...(Number.isFinite(m.asked) ? { asked: m.asked } : {}) };
  } catch {
    // not JSON: a fresh start
  }
  return NO_MEMO;
}

type Store = Pick<Storage, "getItem" | "setItem">;
/** localStorage, or null where the browser blocks it (reading it can throw). */
export function deviceStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
/** This device's memo as stored now (another tab may have changed it): blocked or unreadable is a fresh start. */
export function loadMemo(store: Store | null): NudgeMemo {
  try {
    return store ? readMemo(store.getItem(NUDGE_KEY), store.getItem(LEGACY_HINT_KEY)) : NO_MEMO;
  } catch {
    return NO_MEMO;
  }
}
export function saveMemo(store: Store | null, m: NudgeMemo) {
  try {
    store?.setItem(NUDGE_KEY, JSON.stringify(m));
  } catch {
    // private mode: it holds for this page only
  }
}

export const hiddenNow = (m: NudgeMemo, now: number) => m.n >= FOR_GOOD || now < m.until;

/** When a once-waved-off ask comes back: in SNOOZE_MS, or before the next drop if that is sooner (and not too soon). */
export function comeBackAt(now: number, nextDropAt?: string | null) {
  const beforeDrop = nextDropAt ? Date.parse(nextDropAt) - BEFORE_DROP_MS : NaN;
  return beforeDrop >= now + MIN_QUIET_MS && beforeDrop < now + SNOOZE_MS ? beforeDrop : now + SNOOZE_MS;
}

/** "Not now" / "Skip": the first time hides it for a few days, the second time for good (on this device). */
export function dismissMemo(m: NudgeMemo, now: number, nextDropAt?: string | null): NudgeMemo {
  const n = m.n + 1;
  return { ...m, n, until: n >= FOR_GOOD ? 0 : comeBackAt(now, nextDropAt) };
}

/** The session mention was just shown. */
export const askedMemo = (m: NudgeMemo, now: number): NudgeMemo => ({ ...m, asked: now });

export const isFresh = (createdAt: string, now: number) => now - Date.parse(createdAt) < FRESH_MS;

type Ask = { eligible: boolean; memo: NudgeMemo; now: number };

/**
 * The chat's photo card (upload, or their Google picture): right after sign-up (fresh), or for a Google sign-in with a
 * picture (the Google question, which it replaces). Skip hides it like any "Not now".
 */
export const showPhotoCard = (a: Ask & { fresh: boolean; google: boolean }) =>
  a.eligible && !hiddenNow(a.memo, a.now) && (a.fresh || a.google);

/**
 * The first message of a chat session mentions the photo: once per browser session and at most once in ASK_GAP_MS on
 * this device, never beside the photo card.
 */
export const showSessionAsk = (a: Ask & { fresh: boolean; google: boolean; askedThisSession: boolean }) =>
  a.eligible && !hiddenNow(a.memo, a.now) && !a.fresh && !a.google && !a.askedThisSession && a.now - (a.memo.asked ?? 0) >= ASK_GAP_MS;

/** The card near the top of /home. */
export const showHomeCard = (a: Ask & { photos: number }) => a.eligible && a.photos === 0 && !hiddenNow(a.memo, a.now);

/**
 * "Add a photo so <name> can spot you" on a match or plan card (the newest one only): small and in context, so not
 * snoozed, but gone once waved off for good.
 */
export const showCardLine = (a: { eligible: boolean; photos: number; memo: NudgeMemo }) => a.eligible && a.photos === 0 && a.memo.n < FOR_GOOD;

/** "Priya Sharma" -> "Priya": the name on the card line. */
export const firstWord = (name: string) => name.trim().split(/\s+/)[0] || name;
