// Pure helpers for the sign-in popup (no imports; unit-tested in sign-in-help.test.mjs).

/**
 * Apps whose built-in browser Google refuses to sign in from ("disallowed_useragent": an embedded webview).
 * Order matters: Messenger's agent also carries Facebook's FBAN token.
 */
const APPS: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/FBAN\/Messenger|MessengerForiOS|MessengerLite|Orca-Android/i, "Messenger"],
  [/FBAN\/|FBAV\/|FB_IAB\/|FBIOS|\[FB[;_]/, "Facebook"],
  [/Barcelona/, "Threads"],
  [/LinkedInApp/i, "LinkedIn"],
  [/musical_ly|BytedanceWebview|TikTok|\bTrill_|ByteLocale/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/MicroMessenger/i, "WeChat"],
  [/\bLine\/\d/, "LINE"],
  [/Pinterest/i, "Pinterest"],
];

export type InAppBrowser = {
  /** The app, when its browser is a known one ("Instagram"); null for an unnamed embedded webview. */
  app: string | null;
  platform: "ios" | "android" | "other";
};

/**
 * The in-app browser this page is open in, or null for a normal browser (Safari, Chrome, Firefox, Edge, a
 * home-screen web app...). Only what the user agent shows: SFSafariViewController looks exactly like Safari and is
 * not reported (Google works there anyway). `standalone`: navigator.standalone, true for an iOS home-screen app,
 * whose agent has no "Safari/" either.
 */
export function inAppBrowser(ua: string, standalone = false): InAppBrowser | null {
  const ios = /\b(iPhone|iPad|iPod)\b/.test(ua);
  const android = /\bAndroid\b/.test(ua);
  const platform = ios ? "ios" : android ? "android" : "other";
  for (const [re, app] of APPS) if (re.test(ua)) return { app, platform };
  // An unnamed embedded webview: on iOS a WebKit agent without the "Safari/" token (every real iOS browser,
  // Chrome, Firefox and Edge included, keeps it); on Android the "; wv)" WebView marker.
  if (ios && /AppleWebKit\//.test(ua) && !/Safari\//.test(ua) && !standalone) return { app: null, platform };
  if (android && /;\s*wv\)/.test(ua)) return { app: null, platform };
  return null;
}

/**
 * A link that leaves an Android in-app browser for Chrome (an intent: URL), or null where none works (iOS has
 * no documented way out; people use the app's "Open in browser" menu).
 */
export function openInBrowserUrl(href: string, where: InAppBrowser): string | null {
  if (where.platform !== "android") return null;
  try {
    const u = new URL(href);
    if (u.protocol !== "https:") return null;
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  } catch {
    return null;
  }
}

/** What to tell someone in an in-app browser: where the "open in browser" item usually is. */
export function openInBrowserHint(where: InAppBrowser): string {
  const app = where.app ?? "this app";
  if (where.platform === "android") return `Tap ⋮ in ${app} and choose “Open in Chrome” (or your browser).`;
  return `Tap ••• or the share button in ${app} and choose “Open in Safari” (or “Open in browser”).`;
}

/**
 * What to show when Google sends someone back with an error. `error` is the /sign-in page's ?error= (our
 * "google" marker plus Better Auth's own code, e.g. ?error=google&error=state_mismatch). Null: no error.
 */
export function googleErrorMessage(error: string | string[] | undefined): string | null {
  const codes = (Array.isArray(error) ? error : error ? [error] : []).map((c) => c.toLowerCase());
  if (!codes.length) return null;
  const code = codes.find((c) => c !== "google") ?? "";
  if (/^(state_|please_restart)/.test(code)) {
    return "Google sign-in got interrupted: it was started twice, or it took too long. Try Google once more here (just one tap), or use your email.";
  }
  if (code === "access_denied") return "Google sign-in was cancelled. Try again, or use your email instead.";
  if (code === "account_not_linked") return "That Google account's email already signs in another way. Use the email code below with the same address.";
  return "Google sign-in didn't finish. Try again, or use your email.";
}

export const CODE_LENGTH = 6;

/** The six code boxes after an edit; `focus`: the box to focus next; `complete`: every box is filled. */
export type CodeEdit = { digits: string[]; focus: number; complete: boolean };

const settle = (digits: string[]): CodeEdit => {
  const empty = digits.findIndex((x) => !x);
  return { digits, focus: empty === -1 ? CODE_LENGTH - 1 : empty, complete: empty === -1 };
};

/** Writes digits into the boxes: a whole code (6 or more digits: the last 6) fills them all, fewer go in from `index`. */
function put(digits: string[], index: number, d: string): CodeEdit {
  const next = [...digits];
  if (d.length >= CODE_LENGTH) {
    d.slice(-CODE_LENGTH).split("").forEach((c, k) => { next[k] = c; });
  } else {
    for (let k = 0; k < d.length && index + k < CODE_LENGTH; k++) next[index + k] = d[k];
  }
  return settle(next);
}

/**
 * One box's input event. `raw`: the box's new value; `prev`: the digit it held. Null: ignore the event (no digit
 * in it, e.g. a letter typed over a selected digit; the box keeps its digit). Empty: the box is cleared. A box that
 * held a digit and now holds more (a digit typed after it, a keyboard suggestion like Gboard's "123456" added to it,
 * iOS autofill) loses the old digit first.
 */
export function applyCodeInput(digits: string[], index: number, raw: string, prev: string): CodeEdit | null {
  if (!raw) {
    const next = [...digits];
    next[index] = "";
    return { digits: next, focus: index, complete: false };
  }
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (prev && d.length > 1) {
    const at = raw.startsWith(prev) ? 0 : raw.endsWith(prev) ? d.length - 1 : d.indexOf(prev);
    if (at >= 0) d = d.slice(0, at) + d.slice(at + 1);
  }
  return d ? put(digits, index, d) : null;
}

/** A paste into any box: a 6-digit group in the text (a pasted email line) wins, otherwise its digits as if typed. */
export function pasteCode(digits: string[], index: number, text: string): CodeEdit | null {
  const group = /(?:^|\D)(\d{6})(?!\d)/.exec(text);
  if (group) return put(digits, 0, group[1]);
  const d = text.replace(/\D/g, "");
  return d ? put(digits, index, d) : null;
}

/** Backspace in an empty box: clears the box before it and moves there. Null: nothing to do (first box, or this one has a digit). */
export function backspaceCode(digits: string[], index: number): CodeEdit | null {
  if (digits[index] || index === 0) return null;
  const next = [...digits];
  next[index - 1] = "";
  return { digits: next, focus: index - 1, complete: false };
}

/**
 * Sign in on its own page (/sign-in, in normal document flow) instead of the popup: every phone-sized screen, and every
 * iOS / iPadOS browser (all WebKit; iPadOS asks for the desktop site, so a Mac with a touch screen). On iOS 26 a modal
 * <dialog> in the top layer can be placed against the large viewport while Safari's floating tab bar shows (WebKit bug
 * 300965): the sheet then rests below the screen with only a strip of it in view, the page behind it undimmed.
 */
export function signInAsPage(ua: string, width: number, touchPoints = 0): boolean {
  if (width < 768) return true;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && touchPoints > 1;
}

/**
 * Where to go once signed in: one of the signed-in pages (the chat, a match's chat, Home, Edit), with any query or hash.
 * Anything else (another host, "//host", "/\host", a sign-in page, a private link, the API...): the chat.
 */
export function safeNext(next: unknown, fallback = "/chat"): string {
  if (typeof next !== "string" || next.length > 512 || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return /^\/(?:chat(?:\/[A-Za-z0-9_-]+)?|home|edit)(?:[?#]|$)/.test(next) ? next : fallback;
}

/** The user asked the system for less motion (false where there is no window, e.g. tests). */
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export type AuthFail = { status?: number; code?: string; message?: string };

/**
 * Runs a Neon Auth client call. The client rejects on a non-2xx answer (a wrong code, a 429 from our proxy, a
 * network error) instead of returning { error } as its types say, which used to leave buttons stuck on "Signing
 * you in…": both ways come back here as a failure, or null for success.
 */
export async function attempt(call: () => Promise<{ error?: unknown } | null | undefined>): Promise<AuthFail | null> {
  try {
    return ((await call())?.error as AuthFail | null | undefined) ?? null;
  } catch (e) {
    return (e && typeof e === "object" ? e : {}) as AuthFail;
  }
}

/** Too many wrong codes: the code is spent, only a new one works. The client rewrites unknown codes, so the message is checked too. */
export const tooManyTries = (e: AuthFail) => e.code === "TOO_MANY_ATTEMPTS" || /too many attempts/i.test(e.message ?? "");

/** What to say when the emailed code is refused. */
export function codeErrorMessage(e: AuthFail): string {
  if (tooManyTries(e)) return "Too many tries. Send a new code.";
  if (e.status === 429) return "Lots of people are signing in right now. Try again in a few seconds.";
  return "That code didn't work. Check it, or send a new one.";
}
