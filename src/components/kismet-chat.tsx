"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { markDeleted, takeDeleted } from "@/lib/deleted-note";
import { firstMessage as stash } from "@/lib/first-message";
import { fraunces } from "@/lib/fonts";
import { signInAsPage } from "@/lib/sign-in-help";
import type { ChatMessage, ChatView } from "@/lib/text/web-chat";
import {
  askedMemo, deviceStore, dismissMemo, hiddenNow, loadMemo, saveMemo, SESSION_KEY, showCardLine, showPhotoCard, showSessionAsk, type NudgeMemo,
} from "@/lib/photo-nudge";
import { CHECKIN_LABELS, CheckinCard, ConnectCard, MatchCard, NewcomerCard, PhotoCard, RecCard, TrainingCard } from "./chat/cards";
import { SignInDialog, StartDialog } from "./chat/start";
import { ArrowUpIcon, MenuIcon, PlusIcon } from "./chat/icons";
import { ChatsSidebar, NeonLogo, useWide } from "./chat/sidebar";

// The whole website: one conversation with your Kismet agent, kept to one next step at a time. Signed out, it is
// the front door (one question, the message box, a few examples; sign-in opens when you send, and your first
// message waits: the /sign-in page on phones and iOS, a popup on a desktop-wide screen). Signed in: the sign-up interview, recommendation cards with Yes / No, matches and free chat.
// Everything else lives one level down, in the menu. Polls every 6 s while visible (one request at a time; a poll
// that started before a send is dropped).

// Words typed before signing in wait in this tab for 30 minutes (lib/first-message.ts), then come back into the message
// box (never sent on their own: the person sees them and presses send). Cleared when the sign-in popup is dismissed
// or on sign-out; back from the sign-in page without signing in, they go back into the landing page's message box.
// No photo yet (lib/photo-nudge.ts): the photo card after sign-up, one mention in the first message of a browser session,
// a quiet line beside the cards, and a line on match and plan cards. "Not now" / "Skip" wait a few days on this device,
// twice is for good.
const asPage = () => signInAsPage(navigator.userAgent, innerWidth, navigator.maxTouchPoints);

// The first screen's examples: a short label, and the sentence it puts in the message box.
const EXAMPLES = [
  ["A co-founder", "Find me a co-founder for my AI startup"],
  ["New friends", "Friends who love live music"],
  ["A collaborator", "Someone to build a side project with this week"],
] as const;

function Composer({ value, onChange, onSubmit, onPlus, busy, placeholder, inputRef }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onPlus: () => void; busy: boolean; placeholder: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value, inputRef]);
  return (
    <form className="k-composer flex items-end gap-1 rounded-[26px] p-1.5" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <button type="button" onClick={onPlus} className="k-icon grid size-11 shrink-0 place-items-center rounded-full" aria-label="More ways to start">
        <PlusIcon />
      </button>
      <textarea ref={inputRef} rows={1} maxLength={2000} value={value} placeholder={placeholder} aria-label="Message Kismet"
        className="max-h-48 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[1rem] leading-6 outline-none placeholder:text-[var(--k-muted)]"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); } }} />
      <button type="submit" disabled={busy || !value.trim()} aria-label="Send" className="k-send grid size-11 shrink-0 place-items-center rounded-full">
        <ArrowUpIcon />
      </button>
    </form>
  );
}

function Message({ m, busy, noPhoto, onAnswer, onCheckin }: {
  m: ChatMessage; busy: boolean; noPhoto: boolean; onAnswer: (dateId: string, yes: boolean) => void; onCheckin: (dateId: string, a: keyof typeof CHECKIN_LABELS) => void;
}) {
  if (m.from === "me") {
    return <p className="k-mine max-w-[85%] self-end whitespace-pre-wrap break-words rounded-3xl rounded-br-lg px-4 py-2.5 leading-relaxed">{m.text}</p>;
  }
  return (
    <div className="group flex flex-col items-start gap-2">
      <p className="k-them max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-bl-lg px-4 py-2.5 leading-relaxed">{m.text}</p>
      {m.card?.kind === "rec" && <RecCard c={m.card} busy={busy} noPhoto={noPhoto} onAnswer={(yes) => onAnswer(m.card!.dateId, yes)} />}
      {m.card?.kind === "match" && <MatchCard c={m.card} noPhoto={noPhoto} />}
      {m.card?.kind === "checkin" && <CheckinCard c={m.card} busy={busy} onAnswer={(a) => onCheckin(m.card!.dateId, a)} />}
    </div>
  );
}

/** The first message of a session, when they have no photo: one mention, with the way to add one. */
function PhotoAsk({ name, onNotNow }: { name: string | null; onNotNow: () => void }) {
  const first = name?.trim().split(/\s+/)[0];
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="k-them max-w-[85%] rounded-3xl rounded-bl-lg px-4 py-2.5 leading-relaxed">
        {first ? `Welcome back, ${first}! ` : "Welcome back! "}One thing: add a photo so your match can recognise you when you meet.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/home#photos" className="k-chip inline-flex items-center px-3.5 py-1.5 text-sm font-medium">Add a photo</Link>
        <button type="button" className="k-chip k-muted px-3.5 py-1.5 text-sm" onClick={onNotNow}>Not now</button>
      </div>
    </div>
  );
}

const Typing = () => (
  <div className="k-them flex items-center gap-1 self-start rounded-3xl rounded-bl-lg px-4 py-3.5" role="status">
    <span className="sr-only">Kismet is typing</span>
    {[0, 150, 300].map((d) => <span key={d} aria-hidden className="size-1.5 animate-bounce rounded-full bg-[var(--k-muted)]" style={{ animationDelay: `${d}ms` }} />)}
  </div>
);

export function KismetChat({ initial, whatsappUrl = null, signInEnabled = true }: {
  initial: ChatView | null; whatsappUrl?: string | null; signInEnabled?: boolean;
}) {
  const router = useRouter();
  const signedIn = initial !== null;
  const [view, setView] = useState<ChatView | null>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [side, setSide] = useState(false);
  const wide = useWide(); // desktop width: the menu stays open beside the chat
  const [photoNote, setPhotoNote] = useState<string | null>(null); // the outcome of a one-time question (Google photo, sharing)
  const [trainingDone, setTrainingDone] = useState(false); // answered here: a poll already in flight can't bring it back
  const [allChips, setAllChips] = useState<string | null>(null); // the suggestion list shown in full
  const [startOpen, setStartOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [restored, setRestored] = useState(false); // their pre-sign-in words are back in the box
  const [hasStash, setHasStash] = useState(false); // read after mount (sessionStorage is client-only)
  // This device's photo asks (read after mount; null until then, so nothing shows before), and where in this session's
  // conversation its one mention sits (after the message with this id), if it has one.
  const [nudge, setNudge] = useState<{ memo: NudgeMemo; now: number } | null>(null);
  const [sessionAsk, setSessionAsk] = useState<number | null>(null);
  const [deletedNote, setDeletedNote] = useState(false); // arrived from "Delete my account" (/?deleted=1)
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nudgeRead = useRef(false); // once per page, whatever re-renders it (storage blocked included)

  useEffect(() => {
    const t = setTimeout(() => {
      if (nudgeRead.current) return;
      nudgeRead.current = true;
      const now = Date.now();
      const store = deviceStore();
      let memo = loadMemo(store);
      let asked = false;
      try { asked = sessionStorage.getItem(SESSION_KEY) === "1"; } catch { /* blocked: the device memo still limits it */ }
      // The first message of a browser session (the chat as it opened) may mention the photo, once.
      const v = initial;
      if (v?.state === "active" && showSessionAsk({ eligible: v.addPhoto, memo, now, fresh: v.photoStep, google: v.googlePhoto, askedThisSession: asked })) {
        setSessionAsk(v.messages.at(-1)?.id ?? 0);
        memo = askedMemo(memo, now);
        saveMemo(store, memo);
        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* the device memo holds it */ }
      }
      setNudge({ memo, now });
    }, 0);
    return () => clearTimeout(t);
  }, [initial]);
  useEffect(() => {
    // After "Delete my account" (QA2 N-L11): say it worked, then drop the flag from the address. Only in the tab that
    // just deleted (lib/deleted-note.ts, QA3 N3-L2): a "/?deleted=1" link on its own shows nothing.
    const t = setTimeout(() => {
      if (signedIn || !new URLSearchParams(location.search).has("deleted")) return;
      if (takeDeleted(location.search)) setDeletedNote(true);
      history.replaceState(null, "", "/");
    }, 0);
    return () => clearTimeout(t);
  }, [signedIn]);
  // "Not now" / "Skip" on any photo ask: hidden a few days (back once, before a drop if one is sooner), then for good.
  // The chat has no drop time, so it waits the full few days.
  const waveOffPhoto = () => {
    const now = Date.now();
    const store = deviceStore();
    const memo = dismissMemo(store ? loadMemo(store) : nudge?.memo ?? loadMemo(null), now);
    setNudge({ memo, now });
    setSessionAsk(null);
    saveMemo(store, memo);
  };
  const menuButton = useRef<HTMLButtonElement>(null);
  const focusAfterMenu = useRef<"button" | "input">("button"); // where focus lands when the menu closes
  const sendingRef = useRef(false);
  const generation = useRef(0); // bumped by every send: older poll answers are stale
  const sending = pending !== null;
  const messages = view?.messages ?? [];
  const empty = !messages.length && !sending;

  const refresh = useCallback(async () => {
    const gen = generation.current;
    const res = await fetch("/api/chat", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return router.replace("/sign-in");
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (data && gen === generation.current && !sendingRef.current) setView(data);
  }, [router]);

  useEffect(() => {
    if (!signedIn) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!stop && document.visibilityState === "visible" && !sendingRef.current) await refresh();
      if (!stop) timer = setTimeout(loop, 6000);
    };
    timer = setTimeout(loop, 6000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [refresh, signedIn]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); // newer browsers return a Promise here: not a cleanup
  }, [messages.length, pending]);

  const post = useCallback(async (url: string, body: unknown) => {
    if (sendingRef.current) return null;
    sendingRef.current = true;
    generation.current++;
    setError("");
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    sendingRef.current = false;
    generation.current++;
    if (res?.status === 401) {
      router.replace("/sign-in");
      return null;
    }
    if (!res?.ok) {
      setError(data?.error ?? "That didn't send. Check your connection and try again.");
      return null;
    }
    return data;
  }, [router]);

  // Signing in: on phones and every iOS browser the /sign-in page (a modal <dialog> can rest off-screen there, see
  // signInAsPage), elsewhere the popup. The page comes back here with Back, or goes on to the chat once signed in.
  const signIn = useCallback(() => {
    if (!asPage()) return setSignInOpen(true);
    router.push("/sign-in?back=1");
  }, [router]);

  const send = useCallback(async (body: { text: string; buttonId?: string }) => {
    if (!signedIn) {
      // Signed out: keep their words, sign in (or up), then pick up right here.
      stash.set(body.text);
      setWaiting(body.text);
      signIn();
      return true;
    }
    if (sendingRef.current) return false;
    setPending(body.text);
    const data = await post("/api/chat", body);
    setPending(null);
    if (!data) return false;
    if (data.deleted) {
      markDeleted(); // the notice shows only in this tab (QA3 N3-L2)
      await authClient.signOut().catch(() => {});
      router.replace("/?deleted=1"); // the landing page with its "account deleted" notice
      router.refresh();
      return true;
    }
    setView(data);
    return true;
  }, [post, router, signedIn, signIn]);

  // Back from the sign-in page without signing in: their words go back into the landing page's message box.
  useEffect(() => {
    if (signedIn) return;
    const t = setTimeout(() => {
      const first = stash.takeBack();
      if (first) setText((cur) => cur || first);
    }, 0);
    return () => clearTimeout(t);
  }, [signedIn]);

  // Words typed before signing in come back into the message box once the chat can take them: once signed up (during
  // the sign-up questions they would be sent as an answer), never while a Connect question is open. The person sends
  // them: nothing goes out on its own.
  useEffect(() => {
    if (!signedIn || !view) return;
    const first = stash.get();
    const t = setTimeout(() => {
      setHasStash(Boolean(first));
      if (!first || view.connect || view.state !== "active") return;
      stash.clear();
      setHasStash(false);
      setText((cur) => cur || first);
      setRestored(true);
      input.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [view, signedIn]);

  // Signed in, the menu (Kismet and the matches) stays open beside the chat on a desktop-wide screen.
  const docked = wide && signedIn;
  const drawer = side && !docked;
  // Docking closes the drawer for good, so it never reopens by itself if the window narrows later.
  const [wasDocked, setWasDocked] = useState(docked);
  if (docked !== wasDocked) {
    setWasDocked(docked);
    if (docked) setSide(false);
  }

  // The menu: Escape closes it, focus moves in, and goes back to the menu button (or the message box) when it closes.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSide(false);
    window.addEventListener("keydown", onKey);
    focusAfterMenu.current = "button";
    document.querySelector<HTMLElement>("#kismet-menu nav a, #kismet-menu nav button")?.focus();
    const button = menuButton.current;
    const box = input.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      (focusAfterMenu.current === "input" || !button?.isConnected ? box : button)?.focus();
    };
  }, [drawer]);
  const closeMenuToChat = () => {
    focusAfterMenu.current = "input";
    setSide(false);
    if (docked) input.current?.focus(); // the docked menu never closes: go straight to the message box
  };

  async function signal(id: string, action: "pause" | "resume" | "drop") {
    const data = await post("/api/chat/signals", { id, action });
    if (data) setView(data);
  }

  async function checkin(dateId: string, answer: keyof typeof CHECKIN_LABELS) {
    const data = await post("/api/chat/checkin", { dateId, answer });
    if (data) setView(data);
  }

  async function submit() {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (!(await send({ text: t }))) setText(t);
    input.current?.focus();
  }

  async function signOut() {
    stash.clear();
    await Promise.all([authClient.signOut().catch(() => {}), fetch("/api/signout", { method: "POST" })]);
    router.replace("/");
    router.refresh();
  }

  const ask = (t: string) => {
    closeMenuToChat();
    void send({ text: t });
  };
  const signingUp = view?.state === "consent" || view?.state === "interview" || view?.state === "confirm";
  const stashed = signedIn && signingUp && hasStash;
  const openSignIn = () => {
    setSide(false);
    setWaiting(null);
    // Leaving for the sign-in page: words typed but not sent wait too (the popup keeps this page, and its box, open).
    const typed = text.trim();
    if (typed && !signedIn && asPage()) stash.set(typed);
    else stash.clear();
    signIn();
  };
  const onDate = Boolean(view && view.running > 0);
  // The photo asks (lib/photo-nudge.ts): only once this device's memory is read, never while sending or beside a note.
  const asking = Boolean(view?.state === "active" && view.addPhoto && nudge && !photoNote);
  const photoCard = asking && !sending && showPhotoCard({ eligible: true, memo: nudge!.memo, now: nudge!.now, fresh: view!.photoStep, google: view!.googlePhoto });
  const trainingCard = Boolean(view?.training && !photoCard && !trainingDone && !photoNote);
  const photoAsk = asking && sessionAsk !== null && !photoCard;
  const askAt = photoAsk ? messages.findIndex((m) => m.id === sessionAsk) : -1;
  const quietLine = asking && !hiddenNow(nudge!.memo, nudge!.now) && !photoCard && !photoAsk && !trainingCard
    && messages.some((m) => m.card?.kind === "rec" || m.card?.kind === "match");
  // "Add a photo so <name> can spot you": on the newest match or plan card only.
  const spotOn = Boolean(view?.state === "active" && nudge && showCardLine({ eligible: Boolean(view.addPhoto), photos: 0, memo: nudge.memo }))
    ? messages.findLast((m) => m.card?.kind === "match" || (m.card?.kind === "rec" && m.card.plan))?.id ?? null
    : null;
  const suggestions = view && !sending ? view.suggestions : [];
  const chipsKey = suggestions.join("|");
  const chips = suggestions.length > 3 && allChips !== chipsKey ? suggestions.slice(0, 3) : suggestions;

  const menu = (
    <ChatsSidebar side={view} signedIn={signedIn} current="kismet" docked={docked} onClose={() => setSide(false)} onKismet={closeMenuToChat}
      onAsk={ask} onSignal={(id, action) => void signal(id, action)} onSignIn={openSignIn} onSignOut={() => void signOut()} />
  );

  const composer = (
    <Composer value={text} onChange={setText} onSubmit={submit} onPlus={() => setStartOpen(true)} busy={sending} inputRef={input}
      placeholder={view?.state === "active" ? "Message Kismet" : signedIn ? "Type your answer" : "Tell me who you'd like to meet"} />
  );

  return (
    <div className={`kchat k-shell ${fraunces.variable} flex overflow-hidden ${docked ? "flex-row" : "flex-col"}`}>
      {docked && menu}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={drawer || undefined}>
        <header className={`relative flex h-14 shrink-0 items-center gap-2 px-2 ${empty ? "" : "k-header"}`}>
          {!docked && (
            <button ref={menuButton} type="button" className="k-icon grid size-11 place-items-center rounded-full" aria-label="Open menu" aria-expanded={side} aria-controls="kismet-menu" onClick={() => setSide(true)}>
              <MenuIcon />
            </button>
          )}
          {!empty && <h1 className="sr-only">Chat with Kismet</h1>}
          {!empty && <Link href={signedIn ? "/chat" : "/"} aria-label="Kismet home" className="absolute left-1/2 grid min-h-11 min-w-14 -translate-x-1/2 place-items-center"><NeonLogo className="block h-8 w-14" /></Link>}
          <span className="flex-1" />
          <span className="k-muted flex items-center gap-1.5 px-2 text-xs" role="status">
            {onDate && <><span aria-hidden className="k-live size-1.5 rounded-full bg-[var(--k-accent-text)]" />Chatting with an agent now</>}
          </span>
          {!signedIn && <button type="button" className="k-quiet min-h-11 rounded-full px-4 text-sm font-semibold" onClick={openSignIn}>Sign in</button>}
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          {empty ? (
            <div className="flex flex-1 flex-col items-center overflow-y-auto px-5">
              <div className="my-auto flex w-full max-w-xl flex-col items-center pb-[8vh] pt-6">
                {deletedNote && (
                  <p role="status" className="k-card mb-6 w-full rounded-2xl px-4 py-3 text-center text-sm">
                    <b>Your account is deleted.</b> Your profile, agent chats, matches, messages and photos are gone. Reports others made about you are
                    kept up to 12 months, for safety.
                  </p>
                )}
                <NeonLogo className="block h-14 w-24 md:h-16 md:w-28" />
                <h1 className="k-serif mt-6 text-center text-[2rem] leading-tight md:text-[2.6rem]">Who would you like to meet?</h1>
                <p className="k-muted mt-3 max-w-md text-center text-[0.95rem] leading-relaxed">
                  Intros to friends, collaborators and co-founders for Edge City India residents. Your own private agent meets other residents&apos; agents and tells only you who&apos;s worth meeting.
                </p>
                <div className="mt-8 w-full">{composer}</div>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map(([label, sentence]) => (
                    <button key={label} type="button" className="k-chip px-3.5 py-1.5 text-sm" onClick={() => { setText(sentence); input.current?.focus(); }}>{label}</button>
                  ))}
                </div>
              </div>
              <Link href="/privacy" className="k-muted mb-2 inline-flex min-h-11 min-w-11 items-center justify-center text-xs hover:underline">Private agents · Edge City India residents only</Link>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6" aria-live="polite">
                  {view?.connect && <ConnectCard c={view.connect} onDone={(v) => (v ? setView(v) : router.refresh())} />}
                  {view?.newcomer && !view.connect && <NewcomerCard />}
                  {messages.map((m, i) => (
                    <Fragment key={m.id}>
                      <Message m={m} busy={sending} noPhoto={m.id === spotOn} onCheckin={checkin}
                        onAnswer={(dateId, yes) => void send({ text: yes ? "Yes" : "No", buttonId: `kismet:${yes ? "yes" : "no"}:${dateId}` })} />
                      {photoAsk && i === askAt && <PhotoAsk name={view?.name ?? null} onNotNow={waveOffPhoto} />}
                    </Fragment>
                  ))}
                  {photoAsk && askAt === -1 && <PhotoAsk name={view?.name ?? null} onNotNow={waveOffPhoto} />}
                  {photoCard && <PhotoCard google={Boolean(view?.googlePhoto)} onSkip={waveOffPhoto} onDone={(note) => { setPhotoNote(note || null); void refresh(); }} />}
                  {trainingCard && <TrainingCard onDone={(note) => { setTrainingDone(true); setPhotoNote(note || null); }} />}
                  {/* No photo of their own: one quiet line, only once someone is on a card here, never beside another photo ask or question. */}
                  {quietLine && (
                    <p className="k-muted flex flex-wrap items-baseline gap-x-2 self-start px-1 text-sm">
                      <span><Link href="/home#photos" className="py-3.5 font-medium text-[var(--k-text)] underline underline-offset-2">Add a photo</Link> so your matches can see you too.</span>
                      <button type="button" className="-my-3.5 px-1.5 py-3.5 text-xs underline-offset-2 hover:underline" onClick={waveOffPhoto}>Not now</button>
                    </p>
                  )}
                  {photoNote && (
                    <p role="status" className="k-them max-w-[85%] self-start rounded-3xl rounded-bl-lg px-4 py-2.5 leading-relaxed">
                      {photoNote} <button type="button" className="k-muted ml-1 text-xs underline-offset-2 hover:underline" onClick={() => setPhotoNote(null)}>Dismiss</button>
                    </p>
                  )}
                  {pending !== null && <p className="k-mine max-w-[85%] self-end whitespace-pre-wrap break-words rounded-3xl rounded-br-lg px-4 py-2.5">{pending}</p>}
                  {sending && <Typing />}
                  <div ref={bottom} />
                </div>
              </div>
              <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pb-3">
                {view?.progress && (
                  <p className="k-muted mb-2 flex flex-wrap items-baseline gap-x-2 px-2 text-sm" role="status">
                    <span className="font-semibold text-[var(--k-text)]">Step {view.progress.step} of {view.progress.total}</span>
                    {stashed ? <span>Your first message comes back here once you&apos;re set up.</span> : chips.length > 0 ? <span>Tap an answer or type your own.</span> : null}
                  </p>
                )}
                {/* No step line while signing up means "No, I'm not at Edge City" (lib/text/parse.ts signupProgress): nobody
                    is set up then, so their words are not promised back (QA8 L1). */}
                {restored && text && <p className="k-muted mb-2 px-2 text-sm">Here&apos;s what you wrote before signing in. Send it when you&apos;re ready.</p>}
                {chips.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Suggested replies">
                    {chips.map((s) => <button key={s} type="button" className="k-chip px-3.5 py-1.5 text-sm" onClick={() => void send({ text: s })}>{s}</button>)}
                    {chips.length < suggestions.length && (
                      <button type="button" className="k-chip k-muted px-3.5 py-1.5 text-sm" aria-label="More suggested replies"
                        onClick={(e) => { const group = e.currentTarget.parentElement; setAllChips(chipsKey); requestAnimationFrame(() => group?.querySelectorAll("button")[3]?.focus()); }}>More</button>
                    )}
                  </div>
                )}
                {error && <p role="alert" className="mb-2 px-2 text-sm font-medium text-danger">{error}</p>}
                {composer}
              </div>
            </>
          )}
        </main>
      </div>

      {drawer && <button type="button" tabIndex={-1} aria-hidden className="k-scrim fixed inset-0 z-30" onClick={() => setSide(false)} />}
      {drawer && menu}

      <StartDialog open={startOpen} onClose={() => setStartOpen(false)} whatsappUrl={whatsappUrl}
        onType={() => input.current?.focus()} onSend={(t) => void send({ text: t })} />
      <SignInDialog open={signInOpen} waiting={waiting} enabled={signInEnabled}
        onClose={() => { stash.clear(); setWaiting(null); setSignInOpen(false); }} />
    </div>
  );
}
