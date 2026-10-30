"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { firstMessage } from "@/lib/first-message";
import { fraunces } from "@/lib/fonts";
import { SignIn } from "@/components/sign-in";
import { BackIcon } from "./chat/icons";

/**
 * Sign-in as a page of its own, in normal document flow: no <dialog>, nothing fixed or transformed at rest, no
 * viewport units placing it, and no entrance holding a field back (globals.css .k-signin-page), so every field is on
 * the first paint and the page scrolls like any other. Phones and every iOS browser come here from the chat
 * (lib/sign-in-help.ts signInAsPage); so does everyone who opens /sign-in. Words typed on the landing page wait in
 * this tab (lib/first-message.ts) and show here; Back returns to the page they came from, where the words go back
 * into the message box.
 */
export function SignInPage({ next, notice, enabled, back }: {
  next: string; notice: React.ReactNode; enabled: boolean;
  /** Opened from a page of this site (`?back=1`): Back goes back in history rather than to the landing page. */
  back: boolean;
}) {
  const router = useRouter();
  const [waiting, setWaiting] = useState<string | null>(null);
  const [locked, setLocked] = useState(false); // a code being checked, or "You're in": leaving now would drop it
  const lockedRef = useRef(false); // set at once (not in an effect): the page may unmount right after "You're in"
  const onLock = useCallback((v: boolean) => { lockedRef.current = v; setLocked(v); }, []);
  useEffect(() => {
    const t = setTimeout(() => setWaiting(firstMessage.get()), 0); // sessionStorage is client-only
    return () => {
      clearTimeout(t);
      // Leaving this page inside the tab: the browser's own Back (Safari's ‹, an iOS swipe, Android's Back) puts their
      // words back into the landing page's message box, as the Back button here does. Not a popstate listener: Next's
      // router handles popstate first and unmounts this page during that same event, so ours never ran (QA6 Q6-M1).
      // Not once signed in ("You're in" goes on to the chat, which takes the words). Google and a private link leave
      // with a full page load, which runs no cleanup.
      firstMessage.leftSignIn(lockedRef.current);
    };
  }, []);
  const goBack = () => {
    firstMessage.markBack();
    if (back && history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <div className={`k-signin-page ${fraunces.variable}`}>
      <nav className="k-signin-bar" aria-label="Sign-in">
        <button type="button" className="k-signin-back" onClick={goBack} disabled={locked}><BackIcon className="size-5" /><span>Back</span></button>
      </nav>
      <main className="k-signin-main">
        {enabled ? <><h1 className="sr-only">Sign in to Kismet</h1><SignIn next={next} waiting={waiting} notice={notice} onLock={onLock} /></> : (
          <div className="k-signin">
            <h1 className="k-display">Sign in to continue</h1>
            <p className="mt-3 text-sm text-muted">Sign-in is being set up. Meanwhile, <a href="/join" className="font-bold underline">sign up with the quiz</a>.</p>
          </div>
        )}
      </main>
    </div>
  );
}
