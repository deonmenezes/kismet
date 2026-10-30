// The "Your account is deleted" notice on the landing page (QA2 N-L11) shows only in the browser that just deleted an
// account (QA3 N3-L2: "/?deleted=1" alone showed it to anyone, so a crafted link could tell a resident their account
// was gone). The delete flow sets a flag in this tab's sessionStorage; the landing page shows the notice only with that
// flag, fresh, and the "?deleted=1" it was sent to, then clears it, so a reload or a later visit shows nothing.

const KEY = "kismet:deleted";
const FRESH_MS = 10 * 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // storage blocked: no notice, which is the safe side
  }
};

/** Called by a delete flow once the server confirmed the account is gone, before it leaves for "/?deleted=1". */
export function markDeleted(now = Date.now(), s = store()) {
  try {
    s?.setItem(KEY, String(now));
  } catch {
    /* private mode or full: the notice just won't show */
  }
}

/** On the landing page: show the notice? Only with "?deleted=1" and a fresh flag from this tab; the flag is used up. */
export function takeDeleted(search: string, now = Date.now(), s = store()): boolean {
  let at: number | null = null;
  try {
    const v = s?.getItem(KEY) ?? null;
    s?.removeItem(KEY);
    at = v === null ? null : Number(v);
  } catch {
    return false;
  }
  return new URLSearchParams(search).has("deleted") && at !== null && Number.isFinite(at) && now >= at && now - at < FRESH_MS;
}
