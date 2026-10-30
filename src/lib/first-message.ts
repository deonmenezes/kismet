// Words typed before signing in wait in this tab for 30 minutes (sessionStorage), from the landing page's message box
// to the sign-in page. They are never sent on their own: once signed in, they come back into the chat's message box
// and the person presses send. Leaving the sign-in page back to where they were marks them `back`, and only then does
// the landing page take them back into its own box (never words the chat is still holding, e.g. through consent).
const KEY = "kismet:first-message";
const TTL = 30 * 60_000;
type Entry = { text?: string; at?: number; back?: boolean };

const read = (): Entry | null => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Entry | null;
    return v?.text && v.at && Date.now() - v.at < TTL ? v : null;
  } catch {
    return null;
  }
};
const write = (v: Entry) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: it just won't wait */ } };

export const firstMessage = {
  get: (): string | null => read()?.text ?? null,
  set: (text: string) => write({ text, at: Date.now() }),
  clear: () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
  /** Left the sign-in page without signing in (its Back, or the browser's). */
  markBack: () => { const v = read(); if (v) write({ ...v, back: true }); },
  /** The sign-in page went away inside this tab: unless they signed in, that was a "back" (the browser's Back, an
   *  iOS swipe, Android's Back key, its own Back button or a link). Signed in, the chat takes the words instead. */
  leftSignIn: (signedIn: boolean) => { if (!signedIn) firstMessage.markBack(); },
  /** The words marked `back`, taken out of the stash; else null (and the stash is left alone). */
  takeBack: (): string | null => {
    const v = read();
    if (!v?.back) return null;
    firstMessage.clear();
    return v.text ?? null;
  },
};
