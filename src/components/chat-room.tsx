"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { SideView } from "@/lib/text/web-chat";
import { ArrowUpIcon, BackIcon, MenuIcon, SparkIcon } from "./chat/icons";
import { ChatsSidebar, useWide } from "./chat/sidebar";
import { pollDelay } from "@/lib/poll";
import { Avatar } from "./chat/avatar";

type Msg = { id: number; mine: boolean; agent?: boolean; text: string; createdAt: string };
/** mine: this person's answer (null: not asked yet). on: both said yes. */
type Agents = { mine: boolean | null; on: boolean };
const initial = (n: string) => n.trim().slice(0, 1).toUpperCase() || "?";

/** Two agents sliding into one: plays each time a match chat opens (static with reduced motion). */
function Merge({ a, b, size = "lg" }: { a: string; b: string; size?: "lg" | "sm" }) {
  return (
    <span aria-hidden className={`k-merge k-merge-${size}`}>
      <span className="k-orb k-orb-a">{a}</span>
      <span className="k-orb k-orb-b">{b}</span>
    </span>
  );
}

// One conversation with a match. Opt-in per match (lib/match-agents.ts): once both people say yes in the one-time
// popup, their agents merge into one Kismet that reads along and steps in only when it helps. Polls messages every 4 s; ended
// chats show only "This chat has ended."
export function ChatRoom({ matchId, name, photo, me, side: initialSide }: { matchId: string; name: string; photo: string | null; me: string; side: SideView | null }) {
  const router = useRouter();
  // The chats sidebar, as on the Kismet chat: docked on a wide screen, a drawer on a phone. Refreshed every 8 s
  // while visible (unread dots, new matches).
  const wide = useWide();
  const [side, setSide] = useState(initialSide);
  const [drawer, setDrawer] = useState(false);
  const sideIdle = useRef(0); // when the person last did something here (the sidebar polls every 32 s after 2 idle minutes)
  useEffect(() => {
    sideIdle.current = Date.now();
    const onInput = () => { sideIdle.current = Date.now(); };
    window.addEventListener("keydown", onInput);
    window.addEventListener("pointerdown", onInput);
    let n = 0;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - sideIdle.current > 120_000 && ++n % 4 !== 0) return;
      const d = await fetch("/api/chat/side", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (d) setSide(d);
    }, 8000);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
    };
  }, []);
  useEffect(() => {
    if (!drawer || wide) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    document.querySelector<HTMLElement>("#kismet-menu nav a, #kismet-menu nav button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, wide]);
  async function signal(id: string, action: "pause" | "resume" | "drop") {
    await fetch("/api/chat/signals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) }).catch(() => null);
    const d = await fetch("/api/chat/side", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setSide(d);
  }
  async function signOut() {
    await Promise.all([authClient.signOut().catch(() => {}), fetch("/api/signout", { method: "POST" })]);
    router.replace("/");
    router.refresh();
  }
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ended, setEnded] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [loaded, setLoaded] = useState(false); // the first load is not announced, only what arrives after it
  const [agents, setAgents] = useState<Agents | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [savingAgents, setSavingAgents] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const base = `/api/me/matches/${matchId}`;

  // The agents' state changes only when the other person answers (or takes Kismet out): read on open, whenever a new
  // message arrives, and every 8th poll (about 30 s) otherwise; never while my own answer is no (it can't turn on).
  const agentsNow = useRef<Agents | null>(null);
  const ticks = useRef(0);
  const lastActive = useRef(0); // the last message, key or tap (see the polling below); set on mount
  const poll = useCallback(async () => {
    const res = await fetch(`${base}/messages?after=${last.current}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ended) return setEnded(true);
    if (data.messages.length) {
      lastActive.current = Date.now();
      last.current = data.messages.at(-1).id;
      setMsgs((m) => [...m, ...data.messages.filter((x: Msg) => !m.some((y) => y.id === x.id))]);
    }
    const known = agentsNow.current;
    if (known && !data.messages.length && (known.mine === false || ++ticks.current % 8 !== 0)) return;
    const a = await fetch(`${base}/agents`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (a) {
      agentsNow.current = a;
      setAgents(a);
    }
  }, [base]);

  // Polling backs off when nothing happens (QA2: about 25 requests a minute per open tab): every 4 s while the chat is
  // active (a message, a key or a tap in the last 2 minutes), then 8, 16 and at most 30 s; never while the tab is
  // hidden, and at once when it is shown again.
  useEffect(() => {
    poll().finally(() => setLoaded(true));
    if (ended) return;
    lastActive.current = Date.now(); // opening the chat counts as activity
    let stop = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delay = () => pollDelay(Date.now() - lastActive.current);
    const loop = async () => {
      if (stop) return;
      inflight = true;
      if (document.visibilityState === "visible") await poll().catch(() => {});
      inflight = false;
      if (!stop) timer = setTimeout(loop, delay());
    };
    timer = setTimeout(loop, 4000);
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      lastActive.current = Date.now();
      if (!inflight) {
        clearTimeout(timer);
        void loop();
      }
    };
    const onInput = () => { lastActive.current = Date.now(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("keydown", onInput);
    window.addEventListener("pointerdown", onInput);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
    };
  }, [poll, ended]);

  // The one-time question, per match: a real modal (focus stays inside, Escape closes it unanswered).
  const ask = agents !== null && agents.mine === null && !ended;
  useEffect(() => {
    const d = dialog.current;
    if (ask && d && !d.open) d.showModal();
    if (!ask && d?.open) d.close();
  }, [ask]);

  /** Saves the person's own answer; the popup closes only once the server confirmed it. */
  async function answerAgents(on: boolean) {
    setSavingAgents(true);
    setAgentsError("");
    const res = await fetch(`${base}/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    setSavingAgents(false);
    if (!data) return setAgentsError("That didn't save. Check your connection and try again.");
    agentsNow.current = data;
    setAgents(data);
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" }); // newer browsers return a Promise here: not a cleanup
  }, [msgs.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError("");
    const res = await fetch(`${base}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409) return setEnded(true);
    if (!res.ok) return setError(data.error ?? "Couldn't send.");
    setText("");
    await poll();
  }

  async function unmatch() {
    await fetch(`${base}/unmatch`, { method: "POST" });
    router.push("/chat");
    router.refresh();
  }

  const menu = (
    <ChatsSidebar side={side} signedIn current={matchId} docked={wide} onClose={() => setDrawer(false)}
      onSignal={(id, action) => void signal(id, action)} onSignOut={() => void signOut()} />
  );

  return (
    <div className="flex h-full w-full flex-row">
    {/* Until the width is known (useWide runs after hydration) a desktop gets the docked sidebar's room and no phone
        buttons, so nothing jumps when it appears (QA2: desktop CLS 0.194). */}
    {wide ? menu : <div aria-hidden className="hidden w-[280px] shrink-0 md:block" />}
    <div className="mx-auto flex h-full min-w-0 w-full max-w-2xl flex-col" inert={(drawer && !wide) || undefined}>
      <header className="k-header flex h-14 shrink-0 items-center gap-2 px-2">
        {!wide && (
          <>
            <button type="button" className="k-icon grid size-11 place-items-center rounded-full md:hidden" aria-label="Open menu" aria-expanded={drawer} aria-controls="kismet-menu" onClick={() => setDrawer(true)}><MenuIcon /></button>
            <Link href="/chat" className="k-icon -ml-1 grid size-11 place-items-center rounded-full md:hidden" aria-label="Back to Kismet"><BackIcon /></Link>
          </>
        )}
        <Avatar name={name} photo={photo} className="size-9 text-base" eager />
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h1>
        {!ended && agents && (
          <button type="button" className="k-quiet flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold" aria-pressed={agents.mine === true} disabled={savingAgents}
            onClick={() => (agents.mine === null ? dialog.current?.showModal() : void answerAgents(!agents.mine))}
            title="Kismet in this chat: it joins only when you both say yes, and either of you can take it out.">
            <SparkIcon className={`size-4 ${agents.on ? "text-[var(--k-accent-text)]" : "opacity-50"}`} /><span className="max-sm:sr-only">Kismet</span>
          </button>
        )}
        {!ended && (confirm
          ? <button type="button" className="btn btn-danger min-h-11 px-3.5 text-xs" onClick={unmatch}>Unmatch?</button>
          : <button type="button" className="k-muted min-h-11 px-3 text-xs font-medium hover:underline" onClick={() => setConfirm(true)}>Unmatch</button>)}
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4" aria-live={loaded ? "polite" : "off"}>
        {!ended && (
          <div className="k-muted mx-auto mb-2 flex flex-col items-center gap-2 text-center text-xs">
            <Merge a={initial(me)} b={initial(name)} size="sm" />
            <p role="status">
              {agents?.on ? "Kismet is here, with context about both of you. It only steps in when it helps."
                : agents?.mine ? "Kismet joins once you both say yes." : "Kismet is not in this chat."}
            </p>
          </div>
        )}
        {!msgs.length && !ended && <p className="k-muted m-auto max-w-xs text-center text-sm">Say hi to {name}. Only the two of you{agents?.on ? " and Kismet" : ""} see this.</p>}
        {msgs.map((m) => m.agent ? (
          <div key={m.id} className="max-w-[85%] self-start">
            <p className="k-muted mb-1 flex items-center gap-1.5 px-1 text-xs"><SparkIcon className="size-3.5 text-[var(--k-accent-text)]" />Kismet</p>
            <p className="k-agent whitespace-pre-wrap break-words rounded-3xl rounded-tl-lg px-4 py-2.5 leading-relaxed">{m.text}</p>
          </div>
        ) : (
          <p key={m.id} className={`max-w-[80%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 leading-relaxed ${m.mine ? "k-mine self-end rounded-br-lg" : "k-them self-start rounded-bl-lg"}`}>
            {m.text}
          </p>
        ))}
        {ended && <p className="k-them m-auto rounded-2xl px-4 py-3 text-center text-sm">This chat has ended.</p>}
        <div ref={bottom} />
      </div>
      {(error || (agentsError && !ask)) && <p role="alert" className="mb-2 px-5 text-sm font-medium text-danger">{error || agentsError}</p>}
      {!ended && (
        <form onSubmit={send} className="k-composer mx-4 mb-3 flex items-end gap-1 rounded-[26px] p-1.5 pl-4">
          <textarea className="min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 leading-6 outline-none placeholder:text-[var(--k-muted)]" rows={1} maxLength={1000}
            value={text} placeholder={`Message ${name}`} aria-label={`Message ${name}`}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(e); } }} />
          <button className="k-send grid size-11 shrink-0 place-items-center rounded-full" disabled={busy || !text.trim()} aria-label="Send"><ArrowUpIcon /></button>
        </form>
      )}
      {/* Never taller than the visible screen (iPhone toolbars included): it scrolls inside instead of being cut off. */}
      <dialog ref={dialog} className="k-card k-pop m-auto max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2.5rem))] overflow-y-auto overscroll-contain rounded-3xl p-6 pt-7 text-center shadow-[var(--shadow-2)] backdrop:bg-[var(--scrim)]"
        aria-labelledby="agents-intro-title" aria-describedby="agents-intro-text">
        <Merge a={initial(me)} b={initial(name)} />
        <h2 id="agents-intro-title" className="k-serif mt-4 text-2xl leading-tight" tabIndex={-1} autoFocus>Bring Kismet into this chat?</h2>
        <p id="agents-intro-text" className="mt-2 leading-relaxed">Your agents merge into one shared helper that knows both of your sides from their chat. It stays quiet and only steps in when it helps, like a stalled chat or a plan that won&apos;t land, or when you ask &ldquo;Kismet, ...&rdquo;.</p>
        <p className="k-muted mt-3 text-xs leading-relaxed">Private by design: it joins only if you both say yes, uses only what you both already shared (never contact details or anything you marked private), and nothing here goes into memory or other agent chats. Either of you can take it out any time.</p>
        {agentsError && <p role="alert" className="mt-3 text-sm font-medium text-danger">{agentsError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost px-3" disabled={savingAgents} onClick={() => void answerAgents(false)}>No thanks</button>
          <button type="button" className="btn btn-primary whitespace-nowrap px-3" disabled={savingAgents} onClick={() => void answerAgents(true)}>Bring Kismet in</button>
        </div>
      </dialog>
    </div>
    {drawer && !wide && <><button type="button" tabIndex={-1} aria-hidden className="k-scrim fixed inset-0 z-30" onClick={() => setDrawer(false)} />{menu}</>}
    </div>
  );
}
