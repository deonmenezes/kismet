"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  CODE_LENGTH as LENGTH, applyCodeInput, attempt, backspaceCode, codeErrorMessage, inAppBrowser, openInBrowserHint, openInBrowserUrl, pasteCode, reducedMotion,
  tooManyTries, type CodeEdit, type InAppBrowser,
} from "@/lib/sign-in-help";

type Step = "pick" | "code" | "done";
const RESEND_AFTER = 30; // seconds before "Send a new code" works (Kismet allows 5 code emails an hour per address)
const at = (i: number) => ({ "--i": i }) as React.CSSProperties; // staggered entrance order

const GoogleMark = () => (
  <svg aria-hidden viewBox="0 0 48 48" className="size-5 shrink-0">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** Kismet's mark, two orbits that meet in a spark, drawn in ink as the sheet opens. */
const OrbitMark = () => (
  <svg aria-hidden viewBox="0 0 100 100" className="k-mark">
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={7}>
      <path pathLength={1} className="k-mark-a" d="M50 86C70 70 86 57 86 40C86 25 78 15 68 15C58 15 54 22 50 30C46 38 40 44 40 55C40 66 44 77 50 86Z" />
      <path pathLength={1} className="k-mark-b" d="M50 86C30 70 14 57 14 40C14 25 22 15 32 15C42 15 46 22 50 30C54 38 60 44 60 55C60 66 56 77 50 86Z" />
    </g>
    <path className="k-mark-spark" d="M50 16C52.2 27.8 52.2 27.8 64 30C52.2 32.2 52.2 32.2 50 44C47.8 32.2 47.8 32.2 36 30C47.8 27.8 47.8 27.8 50 16Z" />
  </svg>
);

/** The brush stroke under the headline's last word. */
const InkStroke = () => (
  <svg aria-hidden viewBox="0 0 200 18" preserveAspectRatio="none" className="k-ink">
    <path pathLength={1} d="M3 12.5C34 5 63 15.5 98 9.5S160 4 197 10" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
  </svg>
);

const Spinner = () => <span aria-hidden className="k-spinner" />;

/** Six boxes for the emailed code: typing moves on, Backspace moves back, a paste or iOS autofill fills them all (rules in sign-in-help.ts). */
function CodeBoxes({ digits, setDigits, onComplete, disabled, shake }: {
  digits: string[]; setDigits: (d: string[]) => void; onComplete: (code: string) => void; disabled: boolean; shake: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { refs.current[0]?.focus(); }, [shake]); // on the code step, and again after a wrong code

  const apply = (edit: CodeEdit | null) => {
    if (!edit) return; // nothing usable: a controlled box goes back to its digit
    setDigits(edit.digits);
    if (edit.complete) {
      (document.activeElement as HTMLElement | null)?.blur();
      onComplete(edit.digits.join(""));
    } else refs.current[edit.focus]?.focus();
  };
  const focus = (i: number) => refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  return (
    <div key={shake} className={`k-code ${shake ? "k-shake" : ""}`} role="group" aria-label="6-digit code">
      {digits.map((v, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={v} disabled={disabled}
          className="k-code-box" inputMode="numeric" pattern="[0-9]*" autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => apply(applyCodeInput(digits, i, e.target.value, v))}
          onPaste={(e) => { e.preventDefault(); apply(pasteCode(digits, i, e.clipboardData.getData("text"))); }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              const edit = backspaceCode(digits, i);
              if (edit) { e.preventDefault(); apply(edit); }
            } else if (e.key === "ArrowLeft") { e.preventDefault(); focus(i - 1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); focus(i + 1); }
          }} />
      ))}
    </div>
  );
}

/** For in-app browsers (Instagram, Facebook, TikTok...), where Google refuses to sign in: the email code, or a real browser. */
function InAppNotice({ where, next }: { where: InAppBrowser; next: string }) {
  const [copied, setCopied] = useState<"" | "yes" | "failed">("");
  const here = `${location.origin}/sign-in${next === "/chat" ? "" : `?next=${encodeURIComponent(next)}`}`;
  const out = openInBrowserUrl(here, where);
  async function copy() {
    try {
      await navigator.clipboard.writeText(here);
      setCopied("yes");
      setTimeout(() => setCopied((c) => (c === "yes" ? "" : c)), 2000);
    } catch {
      setCopied("failed"); // clipboard blocked (common in in-app browsers): show the link to select by hand
    }
  }
  return (
    <div className="k-inapp k-in" style={at(3)} role="note">
      <p className="font-semibold">{where.app ? `You're in ${where.app}'s built-in browser.` : "This looks like an app's built-in browser."}</p>
      <p className="mt-1 text-[0.85rem] text-muted">
        {where.app ? "Google doesn't allow sign-in here, so use the email code below. It works anywhere." : "Google usually doesn't allow sign-in here, so use the email code below. It works anywhere."}
        {" "}{openInBrowserHint(where)}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {out && <a href={out} className="k-pill">Open in Chrome</a>}
        <button type="button" className="k-pill" onClick={copy} aria-live="polite">{copied === "yes" ? "Link copied" : "Copy link"}</button>
      </div>
      {copied === "failed" && (
        <label className="mt-2.5 block text-[0.85rem] text-muted">
          Couldn&apos;t copy, long-press the link:
          <input readOnly value={here} className="k-input mt-1.5 text-sm" onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </div>
  );
}

/**
 * Google, a 6-digit code by email, or an existing private link. New and returning residents use the same buttons.
 * `waiting`: the words they typed before signing in; `notice`: a message from the page (a failed Google return...).
 */
export function SignIn({ next = "/chat", waiting = null, notice = null, onLock }: {
  next?: string; waiting?: string | null; notice?: React.ReactNode;
  /** True while a code is being checked or "You're in" shows: the popup must not close then (their words would be lost). */
  onLock?: (locked: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"" | "google" | "email" | "code" | "link">("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [errorKey, setErrorKey] = useState(0);
  const [where, setWhere] = useState<InAppBrowser | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const googleStarted = useRef(false); // a second tap would start a second Google flow, and only the newer one can finish
  const googleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const locked = busy === "code" || step === "done";
  useEffect(() => { onLock?.(locked); }, [locked, onLock]);

  const fail = (msg: string) => {
    setError(msg);
    setErrorKey((k) => k + 1);
  };

  useEffect(() => {
    // Client-only (the server can't see the in-app browser), so set after mount.
    const t = setTimeout(() => setWhere(inAppBrowser(navigator.userAgent, Boolean((navigator as Navigator & { standalone?: boolean }).standalone))), 0);
    // Back from Google's page (bfcache restores this page as it was): the button must not stay on "Opening Google…".
    // Same for a private link: the page left for /u/<token> and came back.
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      clearTimeout(googleTimer.current);
      googleStarted.current = false;
      setBusy((b) => (b === "google" || b === "link" ? "" : b));
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      clearTimeout(t);
      clearTimeout(googleTimer.current);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function google() {
    if (googleStarted.current) return;
    googleStarted.current = true;
    clearTimeout(googleTimer.current);
    setBusy("google");
    setError("");
    const q = next === "/chat" ? "" : `?next=${encodeURIComponent(next)}`; // Google comes back to /auth/done, which goes on to `next`
    const error = await attempt(() => authClient.signIn.social({ provider: "google", callbackURL: `${location.origin}/auth/done${q}`, errorCallbackURL: `${location.origin}/sign-in?error=google${q && `&${q.slice(1)}`}` }));
    if (error) {
      googleStarted.current = false;
      setBusy("");
      fail(error.status === 429 ? "Lots of people are signing in right now. Try again in a few seconds." : "Google sign-in didn't start. Try again, or use your email.");
      return;
    }
    // The page is leaving for Google now. If a webview swallows the navigation, let them try again.
    googleTimer.current = setTimeout(() => {
      googleStarted.current = false;
      setBusy((b) => (b === "google" ? "" : b));
    }, 30_000);
  }

  async function send(address: string) {
    const error = await attempt(() => authClient.emailOtp.sendVerificationOtp({ email: address, type: "sign-in" }));
    if (error) {
      fail(error.status === 429 ? "Lots of people are signing in right now. Try again in a few seconds." : "We couldn't send a code to that address.");
      return false;
    }
    setResendIn(RESEND_AFTER);
    return true;
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return fail("Enter your email address.");
    setBusy("email");
    setError("");
    const ok = await send(v);
    setBusy("");
    if (!ok) return;
    setEmail(v);
    setDigits(Array(LENGTH).fill(""));
    setStep("code");
  }

  async function resend() {
    setBusy("email");
    setError("");
    await send(email);
    setBusy("");
  }

  async function verify(otp: string) {
    if (otp.length !== LENGTH) return fail("The code has 6 digits.");
    setBusy("code");
    setError("");
    const error = await attempt(() => authClient.signIn.emailOtp({ email, otp }));
    if (error) {
      setBusy("");
      setDigits(Array(LENGTH).fill(""));
      setShake((s) => s + 1);
      if (tooManyTries(error)) setResendIn(0); // that code is spent: a new one must be one tap away
      return fail(codeErrorMessage(error));
    }
    setStep("done");
    onLock?.(true); // now, not after the effect: the sign-in page must know it was signed in before it unmounts
    setTimeout(() => {
      router.replace(next);
      router.refresh();
    }, reducedMotion() ? 0 : 900);
  }

  function openPrivateLink(e: React.FormEvent) {
    e.preventDefault();
    const m = /\/u\/([A-Za-z0-9_-]{20,100})/.exec(link.trim());
    if (!m) return fail("Paste the whole private link (it looks like …/u/abc123…).");
    setBusy("link");
    // A full page load: /u/<token> is a route handler that sets the private-link cookie.
    location.href = `/u/${m[1]}?next=chat`; // eslint-disable-line @next/next/no-location-assign-relative-destination
  }

  // Any in-app browser we can see (named, or an unnamed iOS/Android webview): Google refuses embedded webviews, so the
  // email code comes first and Google is "Try Google anyway". SFSafariViewController (WhatsApp, Telegram on iOS) looks
  // like Safari and keeps Google first, which works there.
  const blocked = Boolean(where);

  const googleButton = (i: number) => (
    <button type="button" className="k-google k-in" style={at(i)} onClick={google} disabled={Boolean(busy)} aria-busy={busy === "google"}>
      {busy === "google" ? <Spinner /> : <GoogleMark />}
      <span>{busy === "google" ? "Opening Google…" : blocked ? "Try Google anyway" : "Continue with Google"}</span>
    </button>
  );

  const emailForm = (i: number) => (
    <form onSubmit={sendCode} className="k-in flex flex-col gap-2.5" style={at(i)} noValidate>
      <label htmlFor="k-email" className="text-sm font-semibold">Email</label>
      <div className="k-ring">
        <input id="k-email" className="k-input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button className="k-primary" disabled={Boolean(busy)} aria-busy={busy === "email"}>
        {busy === "email" && <Spinner />}<span>{busy === "email" ? "Sending your code…" : "Email me a sign-in code"}</span>
      </button>
    </form>
  );

  const divider = (i: number) => (
    <div className="k-or k-in" style={at(i)} aria-hidden><span />or<span /></div>
  );

  return (
    <div className="k-signin">
      <header className="k-head">
        <span className="k-in" style={at(0)}><OrbitMark /></span>
        {step === "pick" && (
          <>
            <p className="k-eyebrow k-in" style={at(1)}>Sign in to continue</p>
            <h2 className="k-display k-in" style={at(1)}>Let fate do the <span className="k-swash">swiping.<InkStroke /></span></h2>
            <p className="k-in mt-2 text-[0.95rem] text-muted" style={at(2)}>For Edge City India residents. New here? The same buttons sign you up, free, in about a minute.</p>
          </>
        )}
        {step === "code" && (
          <div key="code" className="k-step">
            <p className="k-eyebrow">Almost there</p>
            <h2 className="k-display">Check your <span className="k-swash">inbox.<InkStroke /></span></h2>
            <p className="mt-2 text-[0.95rem] text-muted">We sent a 6-digit code to <b className="text-ink [overflow-wrap:anywhere]">{email}</b>. It can take a minute; check spam too.</p>
          </div>
        )}
        {step === "done" && (
          <div key="done" className="k-step">
            <h2 className="k-display">You&apos;re <span className="k-swash">in.<InkStroke /></span></h2>
          </div>
        )}
      </header>

      {step === "pick" && (
        <div className="flex flex-col gap-4">
          {notice && <div className="k-note k-in" style={at(2)} role="status">{notice}</div>}
          {waiting && (
            <figure className="k-quote k-in" style={at(3)}>
              <blockquote>{waiting.length > 140 ? `${waiting.slice(0, 140)}…` : waiting}</blockquote>
              <figcaption>Kismet picks this up as soon as you&apos;re in.</figcaption>
            </figure>
          )}
          {where && <InAppNotice where={where} next={next} />}
          {blocked ? <>{emailForm(4)}{divider(5)}{googleButton(5)}</> : <>{googleButton(4)}{divider(5)}{emailForm(5)}</>}
        </div>
      )}

      {step === "code" && (
        <form key="code-form" className="k-step flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void verify(digits.join("")); }}>
          <CodeBoxes digits={digits} setDigits={setDigits} onComplete={(c) => void verify(c)} disabled={busy === "code"} shake={shake} />
          <button className="k-primary" disabled={Boolean(busy) || digits.some((d) => !d)} aria-busy={busy === "code"}>
            {busy === "code" && <Spinner />}<span>{busy === "code" ? "Signing you in…" : "Sign in"}</span>
          </button>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm">
            <button type="button" className="k-link" disabled={Boolean(busy) || resendIn > 0} onClick={resend}>
              {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
            </button>
            <button type="button" className="k-link" disabled={Boolean(busy)} onClick={() => { setStep("pick"); setDigits(Array(LENGTH).fill("")); setError(""); }}>
              Use a different email
            </button>
          </div>
        </form>
      )}

      {step === "done" && (
        <div className="k-done" role="status">
          <svg aria-hidden viewBox="0 0 64 64" className="k-check">
            <circle pathLength={1} cx="32" cy="32" r="28" />
            <path pathLength={1} d="M20 33l8 8 16-17" />
          </svg>
          <p className="text-muted">Taking you to Kismet…</p>
        </div>
      )}

      {error && <p key={errorKey} role="alert" className="k-error">{error}</p>}

      {step === "pick" && (
        <>
          <details className="k-drawer k-in" style={at(6)} onToggle={(e) => {
            // On a short phone (390x664) the drawer opens below the fold, field and button unseen (QA2 N-M4): bring it into
            // view inside the sheet once it has laid out. Only on the tap that opens it, never as the sheet opens.
            const d = e.currentTarget;
            if (d.open) requestAnimationFrame(() => d.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }));
          }}>
            <summary>I already have a private link</summary>
            <form onSubmit={openPrivateLink} className="mt-3 flex flex-col gap-2">
              <div className="k-ring">
                <input className="k-input text-sm" aria-label="Your private link" placeholder="https://kismet-village.vercel.app/u/…" value={link} onChange={(e) => setLink(e.target.value)} />
              </div>
              <button className="k-ghost" disabled={Boolean(busy)}>{busy === "link" && <Spinner />}Open my account</button>
              <p className="text-xs text-muted">Signed in with Google or email too? Your link connects to it, so next time either one works.</p>
            </form>
          </details>
          <p className="k-in text-center text-xs text-muted" style={at(7)}>
            18+ only. By continuing you agree to the <a href="/terms" className="py-3.5 underline underline-offset-2 hover:text-ink">Terms</a> and <a href="/privacy" className="py-3.5 underline underline-offset-2 hover:text-ink">Privacy policy</a>.
          </p>
        </>
      )}
    </div>
  );
}
