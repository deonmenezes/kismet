"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MeView } from "@/lib/views";
import { authClient } from "@/lib/auth-client";
import { markDeleted } from "@/lib/deleted-note";
import { deviceStore, dismissMemo, firstWord, loadMemo, saveMemo, showCardLine, showHomeCard, type NudgeMemo } from "@/lib/photo-nudge";
import { SAVED_TEXT, uploadPhoto } from "@/lib/photo-upload";

type Rec = MeView["recommendations"][number];
type Match = MeView["matches"][number];
type Contact = { kind: "phone" | "telegram" | "app"; link: string | null; text: string };
type MatchInfo = { name: string; telegram: string; link: string | null; contact?: Contact };

/** The button for how a match chose to be reached (WhatsApp/phone or Telegram); none for in-app only. */
const contactAction = (c: Contact | undefined, telegram: string, link: string | null) =>
  c ? (c.link ? { href: c.link, label: c.kind === "phone" ? "Message on WhatsApp" : telegram ? `Message @${telegram}` : "Message on Telegram" } : null)
    : telegram && link ? { href: link, label: `Message @${telegram}` } : null;

// Secret double opt-in: only my own agent's recommendations and mutual matches are ever shown here.
/** Edge City only (lib/edge-city.ts): an account out of the pool answers "Are you at Edge City India?" here. */
function EdgeCityAsk({ answered, onDone }: { answered: boolean; onDone: (text: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function answer(edgeCity: boolean) {
    setBusy(true);
    let text: string;
    try {
      const res = await fetch("/api/me/edge-city", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edgeCity }) });
      const data = await res.json().catch(() => ({}));
      text = data.text ?? data.error ?? "";
    } catch {
      // Offline or the request failed: say so, and the buttons work again.
      text = "Couldn't save that. Check your connection and try again.";
    }
    try {
      await onDone(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rise rounded-3xl border border-line bg-card p-5">
      <h2 className="k-serif text-[1.7rem] leading-tight">{answered ? "Kismet is Edge City only, for now" : "Are you at Edge City India?"}</h2>
      <p className="mt-1 text-sm text-muted">
        {answered
          ? <>You said you aren&apos;t at Edge City India (Mandrem, Goa), so your agent is taking a break. <Link href="/waitlist" className="underline">Join the waitlist</Link>, or tap below if you are there after all.</>
          : "Kismet is now just for Edge City India residents (Mandrem, Goa, Oct 11 - Nov 1 2026). Until you answer, your agent takes a break from meeting people."}
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary min-h-11 flex-1" disabled={busy} onClick={() => answer(true)}>Yes, I&apos;m here</button>
        {!answered && <button type="button" className="btn btn-ghost min-h-11 flex-1" disabled={busy} onClick={() => answer(false)}>No, I&apos;m not</button>}
      </div>
    </section>
  );
}

/** Opens the photo picker of "Your photos" below (#photos), scrolled into view. */
function openPhotoPicker() {
  document.getElementById("photos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("photo-file")?.click();
}

/**
 * No photo yet (lib/photo-nudge.ts showHomeCard): why it helps, and the way to add one. "Not now" hides it a few days
 * on this device (back once, before a drop if one comes sooner), the second time for good.
 */
function PhotoNudge({ onNotNow }: { onNotNow: () => void }) {
  return (
    <section className="rise rounded-3xl border border-line bg-card p-5" aria-labelledby="photo-nudge-title">
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-dashed border-line-strong bg-bg-2 text-2xl">📷</span>
        <div>
          <h2 id="photo-nudge-title" className="k-serif text-[1.7rem] leading-tight">Add a photo</h2>
          <p className="mt-1 text-sm text-muted">So your match can recognise you when you meet. Only people your agent recommends you to, and your matches, see it.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost min-h-11" onClick={onNotNow}>Not now</button>
        <button type="button" className="btn btn-primary min-h-11" onClick={openPhotoPicker}>Add a photo</button>
      </div>
    </section>
  );
}

/** "Add a photo so Priya can spot you", on a match or plan card. */
function SpotYou({ name, className = "" }: { name: string; className?: string }) {
  return (
    <p className={`text-sm text-muted ${className}`}>
      <button type="button" className="-my-3 py-3 font-semibold text-ink underline underline-offset-2" onClick={openPhotoPicker}>Add a photo</button> so {firstWord(name)} can spot you.
    </p>
  );
}

/** photoAsk: the server's rule (lib/photos.ts addPhotoHint): no photo, and none removed or Google picture turned down. */
export function Home({ initial, whatsapp = false, photoAsk = false }: { initial: MeView; whatsapp?: boolean; photoAsk?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState(initial);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [celebrate, setCelebrate] = useState<MatchInfo | null>(null);
  // Their own photos as Profile shows them now, and whether they removed one here (a choice: no more asking).
  const [ownPhotos, setOwnPhotos] = useState(initial.profile.photos.length);
  const [removedHere, setRemovedHere] = useState(false);
  // This device's photo asks (read after mount, so nothing shows before).
  const [nudge, setNudge] = useState<{ memo: NudgeMemo; now: number } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setNudge({ memo: loadMemo(deviceStore()), now: Date.now() }), 0);
    return () => clearTimeout(t);
  }, []);
  const eligible = photoAsk && !removedHere;
  const photoCard = Boolean(nudge && showHomeCard({ eligible, photos: ownPhotos, memo: nudge.memo, now: nudge.now }));
  // The card line goes on the newest match only, and the plan of the recommendation on top.
  const spotYou = Boolean(nudge && showCardLine({ eligible, photos: ownPhotos, memo: nudge.memo }));
  function photoNotNow() {
    const now = Date.now();
    const store = deviceStore();
    const memo = dismissMemo(store ? loadMemo(store) : nudge?.memo ?? loadMemo(null), now, me.weekly?.nextDropAt);
    setNudge({ memo, now });
    saveMemo(store, memo);
  }

  const refresh = useCallback(async () => {
    const res = await fetch("/api/me?full=1", { cache: "no-store" });
    if (res.status === 401) return router.push("/join");
    if (res.ok) setMe(await res.json());
  }, [router]);

  useEffect(() => {
    if (!me.running) return;
    // Only while the tab is visible: a background tab is not time spent with Kismet (lib/records.ts counts it).
    const t = setInterval(() => document.visibilityState === "visible" && void refresh(), 4000);
    return () => clearInterval(t);
  }, [me.running, refresh]);

  async function sendOnDates(targetId?: string) {
    setSending(true);
    setMsg("");
    try {
      const res = await fetch("/api/me/dates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(targetId ? { targetId } : {}),
      });
      const data = await res.json();
      setMsg(data.message ?? data.error ?? "");
      await refresh();
    } finally {
      setSending(false);
    }
  }

  async function decide(r: Rec, decision: "meet" | "pass") {
    // An answered recommendation leaves the stack either way; only a mutual match comes back.
    setMe((m) => ({ ...m, recommendations: m.recommendations.filter((x) => x.dateId !== r.dateId) }));
    const res = await fetch("/api/me/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dateId: r.dateId, decision }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.text) setMsg(data.text);
    await refresh();
    if (data.match && data.matchWith) setCelebrate(data.matchWith);
  }

  const top = me.topPick;
  return (
    <div className="flex flex-col gap-6 pt-6">
      <section className="rise">
        <p className="text-sm font-medium text-muted">Hey {me.profile.name} 👋{me.worldId.verified && <> <Verified /></>}</p>
        <h1 className="k-serif mt-1 text-[2.2rem] leading-tight">Your agent&apos;s intros</h1>
        {/* Outside the Edge City pool there are no agent chats to send or count, nor a drop (QA6 Q6-L2, QA7): the question
            just below takes the button's place, and the recommendations say what answering brings (me.dropAsk). */}
        {me.edgeCity.member && (
          <>
            <button type="button" className="btn btn-primary mt-4 w-full text-lg" disabled={sending || me.datesLeftToday === 0} onClick={() => sendOnDates()}>
              {sending ? "Finding the best people..." : me.datesLeftToday === 0 ? "Out of agent chats today. Back tomorrow!" : "Send my agent to meet people"}
            </button>
            <p className="mt-2 text-center text-xs text-muted">{me.datesLeftToday} of {me.datesPerDay} agent chats left today{me.weekly ? ". Who it recommends arrives one person per drop." : `: up to ${me.datesPerDay} new people a day`}</p>
          </>
        )}
        {msg && <p className="mt-3 rounded-2xl bg-bg-2 p-3 text-center text-sm font-semibold">{msg}</p>}
      </section>

      {!me.edgeCity.member && <EdgeCityAsk answered={me.edgeCity.answered} onDone={async (text) => { setMsg(text); await refresh().catch(() => {}); }} />}

      {photoCard && <PhotoNudge onNotNow={photoNotNow} />}

      {me.running > 0 && (
        <section className="rise flex items-center gap-4 rounded-3xl border border-line bg-card p-4">
          <span className="pulse-ring relative grid size-12 shrink-0 place-items-center rounded-full bg-bg-2 text-2xl">💬</span>
          <div>
            <p className="font-bold">Your agent is in {me.running} chat{me.running > 1 ? "s" : ""}...</p>
            <p className="text-sm text-muted">If it recommends anyone, they show up here in about a minute.</p>
          </div>
        </section>
      )}

      {me.worldId.verifyLink && <GetVerified link={me.worldId.verifyLink} />}

      {top && !top.recommended && <TopPick t={top} busy={sending || me.datesLeftToday === 0} onDate={() => sendOnDates(top.targetId!)} />}

      {me.matches.length > 0 && (
        <section className="rise">
          <h2 className="k-serif mb-3 text-[1.7rem] leading-tight">Matches 🤝</h2>
          <div className="flex flex-col gap-3">
            {me.matches.map((m, i) => <MatchCard key={m.dateId} m={m} noPhoto={spotYou && i === 0} onSafety={(t) => { setMsg(t); refresh(); }} />)}
          </div>
        </section>
      )}

      <section>
        <h2 className="k-serif mb-1 text-[1.7rem] leading-tight">
          Your agent recommends {me.recommendations.length > 0 && <span className="text-accent-ink">({me.recommendations.length})</span>}
        </h2>
        <p className="mb-3 text-sm text-muted">
          Private. They only find out if you both say yes.
          {me.weekly && <> One person per drop, with a meetup plan.</>}
        </p>
        {me.recommendations.length ? (
          <Stack recs={me.recommendations} noPhoto={spotYou} onDecide={decide} onSafety={(t) => { setMsg(t); refresh(); }} />
        ) : (
          <p className="rounded-3xl border border-dashed border-line p-6 text-center text-sm text-muted">
            {me.dropAsk
              ? me.dropAsk
              : me.weekly
              ? `No Kismet waiting right now. A new one arrives ${me.weekly.label}.`
              : <>No new recommendations. {me.running ? "Hang tight, agent chats in progress." : "Send your agent out to meet the village."}</>}
          </p>
        )}
      </section>

      <MyPhotos initial={me.profile.photos} onChange={(n, removed) => { setOwnPhotos(n); if (removed) setRemovedHere(true); }} />

      <Settings whatsapp={whatsapp} />

      {celebrate && <MatchOverlay m={celebrate} onClose={() => setCelebrate(null)} />}
    </div>
  );
}

function Verified() {
  return <span className="inline-block rounded-full border border-sea/30 bg-card px-2.5 py-0.5 text-xs font-bold text-sea">✓ World ID verified</span>;
}

// Optional, only shown when World ID is configured and this resident is not verified yet.
function GetVerified({ link }: { link: string }) {
  return (
    <section className="rise rounded-3xl border border-line bg-card p-4">
      <p className="font-bold">Get verified <span className="text-xs font-semibold text-muted">(optional)</span></p>
      <p className="mt-1 text-sm text-muted">
        Verify with World ID (Orb or Selfie Check) for a <b className="text-ink">✓ World ID verified</b> badge your matches see, and a small boost when agents pick who to chat with.
      </p>
      <a href={link} className="btn btn-ghost mt-3 w-full">Verify with World ID</a>
    </section>
  );
}

function TopPick({ t, busy, onDate }: { t: NonNullable<MeView["topPick"]>; busy: boolean; onDate: () => void }) {
  return (
    <section className="rise relative overflow-hidden rounded-3xl border border-line bg-card p-5">
      <p className="k-kicker">Your agent&apos;s top recommendation</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">{t.name}</h2>
          {t.worldVerified && <Verified />}
          <p className="mt-1 text-sm text-muted">{t.summary}</p>
        </div>
        <span className="shrink-0 text-3xl font-semibold tracking-tight text-accent-ink tabular-nums">{t.percent}%</span>
      </div>
      {t.sharedInterests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.sharedInterests.map((s) => <span key={s} className="rounded-full bg-tag px-3 py-1 text-xs font-semibold text-tag-ink">{s}</span>)}
        </div>
      )}
      <button type="button" className="btn btn-primary mt-4 w-full" disabled={busy} onClick={onDate}>Have my agent chat with theirs</button>
    </section>
  );
}

function Stack({ recs, noPhoto, onDecide, onSafety }: { recs: Rec[]; noPhoto: boolean; onDecide: (r: Rec, decision: "meet" | "pass") => void; onSafety: (text: string) => void }) {
  const top = recs[0];
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<null | "meet" | "pass">(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fly = (decision: "meet" | "pass") => {
    setLeaving(decision);
    setTimeout(() => { onDecide(top, decision); setLeaving(null); setDx(0); }, 260);
  };

  const x = leaving === "meet" ? 600 : leaving === "pass" ? -600 : dx;
  return (
    <div>
      {/* The next card peeks out under this one (it sits behind the card only, never over the buttons below). */}
      <div className="relative">
      {recs[1] && <div aria-hidden className="absolute inset-x-3 -bottom-2 top-3 rounded-3xl border border-line bg-card" />}
      <div
        key={top.dateId}
        className="rise relative touch-pan-y"
        style={{ transform: `translateX(${x}px) rotate(${x / 25}deg)`, transition: dragging ? "none" : "transform 260ms cubic-bezier(.2,.8,.2,1)" }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, a, summary")) return;
          start.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const ddx = e.clientX - start.current.x;
          if (Math.abs(ddx) > Math.abs(e.clientY - start.current.y)) setDx(ddx);
        }}
        onPointerUp={() => {
          start.current = null;
          setDragging(false);
          if (dx > 110) fly("meet");
          else if (dx < -110) fly("pass");
          else setDx(0);
        }}
        onPointerCancel={() => { start.current = null; setDragging(false); setDx(0); }}
      >
        {dx > 40 && <Stamp text="YES" className="left-5 rotate-[-12deg] border-sea text-sea" />}
        {dx < -40 && <Stamp text="NO" className="right-5 rotate-[12deg] border-danger text-danger" />}
        <RecCard r={top} noPhoto={noPhoto} />
      </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-ghost whitespace-nowrap px-3" onClick={() => fly("pass")}>No thanks</button>
        <button type="button" className="btn btn-primary whitespace-nowrap px-3" onClick={() => fly("meet")}>Yes, I&apos;d meet</button>
      </div>
      <p className="mt-2 text-center text-xs text-muted">Tap Yes or No, or swipe right or left. You only hear back if it&apos;s mutual.</p>
      <SafetyActions key={top.dateId} dateId={top.dateId} name={top.name} onDone={onSafety} />
    </div>
  );
}

const REASONS = [["harassment", "Harassment"], ["spam", "Spam or scam"], ["fake", "Fake profile"], ["inappropriate", "Inappropriate content"], ["other", "Something else"]] as const;

// Report (also blocks) or block someone you were shown. Silent: they are never told.
function SafetyActions({ dateId, name, onDone }: { dateId: string; name: string; onDone: (text: string) => void }) {
  const [open, setOpen] = useState<null | "report" | "block">(null);
  const [reason, setReason] = useState<string>("harassment");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(kind: "report" | "block") {
    setBusy(true);
    try {
      const res = await fetch(`/api/me/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "report" ? { dateId, reason, note: note.trim() || undefined } : { dateId }),
      });
      const data = await res.json().catch(() => ({}));
      onDone(data.text ?? data.error ?? "");
    } finally {
      setBusy(false);
      setOpen(null);
    }
  }
  return (
    <div className="mt-3 text-center text-xs">
      {!open && (
        <p className="text-muted">
          <button type="button" className="min-h-11 px-2 underline" onClick={() => setOpen("report")}>Report {name}</button>·
          <button type="button" className="min-h-11 px-2 underline" onClick={() => setOpen("block")}>Block</button>
        </p>
      )}
      {open === "block" && (
        <div className="flex flex-col gap-2 rounded-2xl bg-bg-2 p-3 text-sm">
          <p>Block {name}? You won&apos;t see each other again. They aren&apos;t told.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn btn-danger min-h-11" disabled={busy} onClick={() => send("block")}>Block</button>
          </div>
        </div>
      )}
      {open === "report" && (
        <div className="flex flex-col gap-2 rounded-2xl bg-bg-2 p-3 text-left text-sm">
          <p className="font-bold">Report {name}</p>
          <select className="field min-h-11 py-2" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <textarea className="field min-h-20 text-sm" maxLength={500} value={note} placeholder="What happened? (optional)" onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-muted">We review every report. Reporting also blocks them.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn btn-danger min-h-11" disabled={busy} onClick={() => send("report")}>Report</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stamp({ text, className }: { text: string; className: string }) {
  return <span className={`absolute top-6 z-10 rounded-xl border-4 px-3 py-1 text-2xl font-black ${className}`}>{text}</span>;
}

function RecCard({ r, noPhoto }: { r: Rec; noPhoto: boolean }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-card shadow-[var(--shadow-1)]">
      {r.photos[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photos[0]} alt={r.name} className="aspect-[4/3] w-full object-cover" draggable={false} />
      )}
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{r.weeklyDrop ? "This week's Kismet" : "My agent recommends you meet"}</p>
        <h3 className="k-serif mt-1 text-[2rem] leading-tight">{r.name}</h3>
        {r.worldVerified && <Verified />}
        <p className="text-sm text-muted">{r.summary}</p>
        {r.sharedInterests.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {r.sharedInterests.map((s) => <span key={s} className="rounded-full bg-tag px-3 py-1 text-xs font-semibold text-tag-ink">{s}</span>)}
          </div>
        )}
        {r.myAgent.reason && (
          <blockquote className="mt-4 rounded-2xl bg-bg-2 p-3.5 text-[0.95rem] leading-snug">
            <span className="block text-xs font-bold text-muted">Why, says your agent</span>
            {r.myAgent.reason}
          </blockquote>
        )}
        {r.plan ? (
          <div className="mt-3 rounded-2xl bg-tag p-3 text-sm">
            <b>📅 The plan, if you both say yes:</b> {r.plan.day}, {r.plan.time}: {r.plan.activity}
            <span className="mt-1 block text-muted">{r.plan.why}</span>
          </div>
        ) : r.myAgent.suggestedMeetup && (
          <p className="mt-3 rounded-2xl bg-tag p-3 text-sm"><b>📍 First meetup idea:</b> {r.myAgent.suggestedMeetup}</p>
        )}
        {r.plan && noPhoto && <SpotYou name={r.name} className="mt-2" />}
      </div>
    </article>
  );
}

function MatchCard({ m, noPhoto, onSafety }: { m: Match; noPhoto: boolean; onSafety: (text: string) => void }) {
  const header = (
    <span>
      <span className="block font-extrabold">{m.name}{m.worldVerified && <span className="ml-2 text-xs font-bold text-sea">✓ World ID verified</span>}</span>
      <span className="text-sm text-muted">{m.telegram ? `@${m.telegram}` : m.contact.text}</span>
    </span>
  );
  const bar = "flex min-h-16 items-center justify-between gap-3 border-b border-line px-5 py-3";
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-card">
      {m.contact.link ? (
        <a href={m.contact.link} target="_blank" rel="noopener noreferrer" className={bar}>
          {header}
          <span className="shrink-0 rounded-full border border-line-strong bg-card px-3 py-1.5 text-sm font-semibold">{m.contact.kind === "phone" ? "Message on WhatsApp" : "Message on Telegram"}</span>
        </a>
      ) : (
        <div className={bar}>{header}</div>
      )}
      {m.plan && (
        <p className="mx-5 mt-3 rounded-2xl bg-tag p-3 text-sm"><b>📅 Your plan:</b> {m.plan.day}, {m.plan.time}: {m.plan.activity}</p>
      )}
      {noPhoto && <SpotYou name={m.name} className="mx-5 mt-3" />}
      <div className="flex items-center gap-3 px-5 pt-3">
        {m.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photos[0]} alt={m.name} className="size-14 rounded-2xl object-cover" />
        )}
        <Link href={`/chat/${m.dateId}`} className="btn btn-primary min-h-11 flex-1 text-sm">
          Chat in Kismet{m.unread > 0 ? ` (${m.unread} new)` : ""}
        </Link>
      </div>
      <details className="group px-5 pb-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-bold text-accent-ink">
          Read your agents&apos; chat <span className="transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {m.transcript.map((t, n) => (
            <div key={n} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${t.who === "mine" ? "self-end bg-select text-on-select" : "self-start bg-bg-2"}`}>
              <p className={`text-[0.7rem] font-bold ${t.who === "mine" ? "text-on-select" : "text-muted"}`}>{t.who === "mine" ? m.myAgentName : m.theirAgentName}</p>
              {t.text}
            </div>
          ))}
        </div>
      </details>
      <div className="px-5 pb-2"><SafetyActions dateId={m.dateId} name={m.name} onDone={onSafety} /></div>
    </article>
  );
}

function MatchOverlay({ m, onClose }: { m: MatchInfo; onClose: () => void }) {
  const action = contactAction(m.contact, m.telegram, m.link);
  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-4">
      <div className="rise w-full max-w-sm rounded-3xl border border-line bg-card p-7 text-center shadow-[var(--shadow-2)]">
        <p className="text-5xl">🤝</p>
        <h2 className="k-serif mt-3 text-[2.6rem] leading-tight">You&apos;re connected!</h2>
        <p className="mt-2 text-muted">You and {m.name} both said yes, and so did your agents.</p>
        {action && <a href={action.href} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-6 w-full">{action.label}</a>}
        <button type="button" className="mt-4 min-h-11 text-sm font-semibold text-muted underline" onClick={onClose}>Back to my intros</button>
      </div>
    </div>
  );
}

// Your own photos (up to 3). Each is re-encoded without EXIF/GPS and checked before it is stored. onChange: how many
// there are now, and whether one was just removed.
function MyPhotos({ initial, onChange }: { initial: { id: string; url: string }[]; onChange: (count: number, removed: boolean) => void }) {
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Photos save the moment they upload; say so, or people look for a Save button that isn't there.
  const [saved, setSaved] = useState("");
  async function upload(file: File) {
    setBusy(true);
    setMsg("");
    setSaved("");
    const r = await uploadPhoto(file);
    setBusy(false);
    if (r.ok) {
      const next = r.photos.length ? r.photos : photos;
      setPhotos(next);
      onChange(next.length, false);
      setSaved(SAVED_TEXT);
    } else setMsg(r.error);
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    setSaved("");
    const res = await fetch("/api/me/photo", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId: id }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) {
      const next = data.photos ?? photos;
      setPhotos(next);
      onChange(next.length, true);
      setSaved("Removed ✓");
    } else setMsg(data.error ?? "Couldn't remove that photo. Try again.");
  }
  return (
    <section id="photos" className="scroll-mt-6 rounded-3xl border border-line bg-card p-4">
      <p className="font-bold">Your photos <span className="text-xs font-semibold text-muted">(optional, up to 3)</span></p>
      <p className="mt-1 text-sm text-muted">Only people your agent recommends you to, and your matches, see them. Photos of you only. Each one saves as soon as it uploads, no Save button needed.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="size-24 rounded-2xl object-cover" />
            <button type="button" aria-label="Delete photo" disabled={busy} className="absolute -right-1 -top-1 grid size-7 place-items-center rounded-full bg-ink text-xs text-bg disabled:opacity-50"
              onClick={() => remove(p.id)}>✕</button>
          </div>
        ))}
        {photos.length < 3 && (
          <label className={`grid size-24 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-muted has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus)] ${busy ? "opacity-50" : ""}`}>
            {busy ? "Checking..." : "+ Add"}
            {/* Kept in the page (not display:none): the /home photo card and the card lines open it, and it takes keyboard focus. */}
            <input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="sr-only" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          </label>
        )}
      </div>
      {photos.length >= 3 && <p className="mt-2 text-sm text-muted">That&apos;s the 3-photo limit. Remove one to add another.</p>}
      <p role="status" className={saved ? "mt-2 text-sm font-semibold text-ink" : "sr-only"}>{saved}</p>
      {msg && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{msg}</p>}
    </section>
  );
}

function LinkWhatsApp() {
  const [link, setLink] = useState<{ code: string; whatsappUrl: string | null } | null>(null);
  const [requests, setRequests] = useState<{ requestId: string; phone: string }[]>([]);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  async function get() {
    setBusy(true);
    const res = await fetch("/api/me/link-code", { method: "POST" });
    setBusy(false);
    if (res.ok) setLink(await res.json());
  }
  // After the code is texted in, the phone waits for approval here.
  useEffect(() => {
    if (!link || done) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch("/api/me/link", { cache: "no-store" });
      if (res.ok) setRequests((await res.json()).requests ?? []);
    }, 3000);
    return () => clearInterval(id);
  }, [link, done]);
  async function approve(requestId: string) {
    setBusy(true);
    const res = await fetch("/api/me/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: requestId }) });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    setDone(res.ok ? "Linked. Kismet will text you on WhatsApp too." : j.error ?? "That didn't work.");
  }
  if (done) return <p className="rounded-3xl border border-line bg-card p-4 text-center text-sm">{done}</p>;
  if (!link) return <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={get}>{busy ? "..." : "Get my recommendations on WhatsApp"}</button>;
  return (
    <div className="rounded-3xl border border-line bg-card p-4 text-center text-sm">
      <p>Text this to Kismet on WhatsApp within 15 minutes:</p>
      <p className="mt-1 text-2xl font-extrabold tracking-widest">LINK {link.code}</p>
      {link.whatsappUrl && <a href={link.whatsappUrl} className="btn btn-primary mt-3 w-full">Open WhatsApp</a>}
      {requests.map((r) => (
        <button key={r.requestId} type="button" className="btn btn-primary mt-3 w-full" disabled={busy} onClick={() => approve(r.requestId)}>
          Approve {r.phone}
        </button>
      ))}
    </div>
  );
}

/** Sharing for feedback and training (the chat asks once after 90 minutes of use): see and change the answer here. */
function DataSharing() {
  // undefined: loading; null: never answered. A failed load shows nothing rather than a wrong "off".
  const [state, setState] = useState<{ share: boolean | null; canShare: boolean } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    fetch("/api/me/training", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setState(d ?? null)).catch(() => setState(null));
  }, []);
  async function change(next: boolean) {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/me/training", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ share: next, from: "profile" }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (res?.ok) setState((s) => (s ? { ...s, share: next } : s));
    else setMsg(data?.error ?? "That didn't save. Try again.");
  }
  if (!state) return state === null ? <p className="text-center text-sm text-muted">Couldn&apos;t load your data sharing setting. Reload to see it.</p> : null;
  const on = state.share === true;
  return (
    <section className="rounded-3xl border border-line bg-card p-4">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="font-bold">Help improve Kismet</span>
          <span className="mt-1 block text-sm text-muted">
            Lets us use your chats with Kismet and your agent&apos;s chats with other agents to improve and train Kismet, with names, contact details and photos
            taken out. An agent chat is only used if the other person shares too. Optional, and off unless you turn it on.
            {!on && !state.canShare && " To turn it on, sign in on the website with Google or your email."}
          </span>
        </span>
        <input type="checkbox" role="switch" className="mt-1 size-5 shrink-0 accent-current" checked={on} disabled={busy || (!on && !state.canShare)}
          onChange={(e) => void change(e.target.checked)} />
      </label>
      {msg && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{msg}</p>}
    </section>
  );
}

function Settings({ whatsapp }: { whatsapp: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function del() {
    setBusy(true);
    setFailed(false);
    // Only a confirmed delete leaves the page (QA2 S-3: a failed one looked like it worked).
    const res = await fetch("/api/me", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    // A full load of the landing page with its "account deleted" notice (QA2 N-L11), signed out of Google / email too.
    // The notice needs this tab's flag (QA3 N3-L2): the address alone shows nothing.
    markDeleted();
    await authClient.signOut().catch(() => {});
    router.replace("/?deleted=1");
    router.refresh();
  }
  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-line pt-6">
      <Link href="/edit" className="btn btn-ghost w-full">Edit profile</Link>
      <Link href="/agents" className="btn btn-ghost w-full">Let my own agent use Kismet</Link>
      {whatsapp && <LinkWhatsApp />}
      <DataSharing />
      {!confirm ? (
        <button type="button" className="min-h-11 text-sm font-semibold text-danger underline" onClick={() => setConfirm(true)}>Delete my account</button>
      ) : (
        <div className="rounded-3xl border-2 border-danger p-4 text-center">
          <p className="font-bold">Delete everything?</p>
          <p className="mt-1 text-sm text-muted">Your profile, all your agent chats, matches, messages and photos are permanently deleted. Reports others made about you are kept up to 12 months, for safety.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={del}>{busy ? "Deleting..." : "Delete"}</button>
          </div>
          {failed && <p role="alert" className="mt-3 text-sm font-semibold text-danger">That didn&apos;t work, so nothing was deleted. Try again, or email us from the Support page.</p>}
        </div>
      )}
    </section>
  );
}
