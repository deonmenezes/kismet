"use client";

import { useState } from "react";
import Link from "next/link";
import type { Card, ChatView } from "@/lib/text/web-chat";
import { noDashes } from "@/lib/copy";
import { firstWord } from "@/lib/photo-nudge";
import { SAVED_TEXT, uploadPhoto } from "@/lib/photo-upload";
import { Avatar } from "./avatar";

// The cards inside Kismet's messages: a recommendation (Yes / No), a match, the private "did you meet?" check-in,
// the two account cards (Connect a private-link account; "already on Kismet?") and the one-time questions (a photo, sharing).

export function RecCard({ c, onAnswer, busy, noPhoto = false }: { c: Extract<Card, { kind: "rec" }>; onAnswer: (yes: boolean) => void; busy: boolean; noPhoto?: boolean }) {
  const extra = c.meetup || c.idea;
  const [broken, setBroken] = useState<string | null>(null); // a photo that stopped being shown (removed, blocked): the initial instead
  const photo = c.photoUrl && c.photoUrl !== broken ? c.photoUrl : null;
  return (
    <div className="k-card w-full max-w-sm overflow-hidden rounded-3xl md:max-w-md">
      {/* Their photo only when this viewer may see it (lib/secret.ts visiblePhoto); the box is sized before it loads. */}
      {photo && <img src={photo} alt={`${c.name}'s photo`} loading="lazy" decoding="async" onError={() => setBroken(photo)} className="aspect-[4/3] w-full bg-[var(--k-bubble)] object-cover" />/* eslint-disable-line @next/next/no-img-element */}
      <div className="p-5">
        {c.weeklyDrop && <p className="k-kicker mb-2">This week&apos;s Kismet</p>}
        <div className="flex items-center gap-3">
          {!photo && <Avatar name={c.name} className="size-11 text-lg" />}
          <p className="k-serif text-[1.7rem] leading-tight">{c.name}{c.worldVerified && <span className="ml-2 inline-block rounded-full bg-sea/10 px-2 py-0.5 align-middle font-sans text-xs font-semibold not-italic tracking-normal text-sea">✓ World ID</span>}</p>
        </div>
        <p className="mt-2 leading-relaxed">{c.why}</p>
        <About name={c.name} about={c.about} />
        {c.sharedInterests.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Shared interests">
            {c.sharedInterests.slice(0, 3).map((i) => <li key={i} className="k-tag rounded-full px-3 py-1 text-xs font-semibold">{i}</li>)}
          </ul>
        )}
        {c.plan && <PlanBox plan={c.plan} />}
        {c.plan && noPhoto && <SpotYou name={c.name} />}
        {extra && !c.plan && (
          <details className="k-more mt-3 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer select-none items-center font-medium text-link">Meetup idea</summary>
            {c.meetup && <p className="k-muted mt-1.5">Idea: {noDashes(c.meetup)}</p>}
            {c.idea && <p className="k-muted mt-1">In the village: {noDashes(c.idea)}</p>}
          </details>
        )}
        {c.open ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAnswer(false)}>No</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAnswer(true)}>Yes, meet</button>
            </div>
            <p className="k-muted mt-3 text-center text-xs">Private and final. They never learn a no.</p>
          </>
        ) : (
          <p className="k-muted mt-4 text-sm">Answer the open one first. This one comes back after.</p>
        )}
      </div>
    </div>
  );
}

/** Their own public answers (lib/views.ts publicAbout): what they said about themselves, in their words. */
function About({ name, about }: { name: string; about?: Extract<Card, { kind: "rec" }>["about"] }) {
  if (!about || (!about.bio && !about.lookingFor.length && !about.interests.length)) return null;
  const first = name.trim().split(/\s+/)[0];
  return (
    <div className="mt-3 text-sm">
      <p className="sr-only">About {first}</p>
      {about.bio && <p className="k-serif border-l-2 border-lavender pl-3 text-[1.05rem] leading-snug">&ldquo;{about.bio}&rdquo;</p>}
      {about.lookingFor.length > 0 && <p className="k-muted mt-1.5">Here for: {about.lookingFor.join(", ")}</p>}
      {about.interests.length > 0 && <p className="k-muted mt-0.5">Into: {about.interests.join(", ")}</p>}
    </div>
  );
}

export function MatchCard({ c, noPhoto = false }: { c: Extract<Card, { kind: "match" }>; noPhoto?: boolean }) {
  const app = c.contact.link ? (c.contact.link.includes("wa.me") ? "WhatsApp" : "Telegram") : null;
  return (
    <div className="k-card w-full max-w-sm rounded-3xl p-5 md:max-w-md">
      <div className="flex items-center gap-3">
        <Avatar name={c.name} photo={c.photoUrl} className="size-12 text-lg" />
        <div className="min-w-0">
          <p className="k-kicker">You&apos;re connected</p>
          <p className="k-serif truncate text-[1.6rem] leading-tight">{c.name}</p>
        </div>
      </div>
      {c.plan && <PlanBox plan={c.plan} />}
      {noPhoto && <SpotYou name={c.name} />}
      <Link href={c.chatUrl} className="btn btn-primary mt-4 min-h-12 w-full">Message {c.name.trim().split(/\s+/)[0] || c.name}</Link>
      {app && (
        <p className="k-muted mt-3 text-center text-sm">
          or on <a href={c.contact.link!} target="_blank" rel="noreferrer" className="font-medium text-link underline underline-offset-2">{app}<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      )}
      {c.idea && (
        <details className="k-more mt-2 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer select-none items-center font-medium text-link">Village idea</summary>
          <p className="k-muted mt-1.5">{c.idea}</p>
        </details>
      )}
    </div>
  );
}

/** The weekly drop's meetup plan: proposed with the drop, confirmed once both said yes. */
function PlanBox({ plan }: { plan: NonNullable<Extract<Card, { kind: "rec" }>["plan"]> }) {
  return (
    <div className="k-tag mt-3 rounded-2xl p-3 text-sm">
      <p className="text-xs font-semibold">{plan.confirmed ? "Your plan" : "The plan, if you both say yes"}</p>
      <p className="mt-1">{plan.day}, {plan.time}: {noDashes(plan.activity)}</p>
      <p className="k-muted mt-1">{noDashes(plan.why)}</p>
    </div>
  );
}

export const CHECKIN_LABELS = { met: "We met", not_useful: "Not useful", missed: "Missed it" } as const;

/** "Did you meet?": private, three taps, answered once. */
export function CheckinCard({ c, onAnswer, busy }: { c: Extract<Card, { kind: "checkin" }>; onAnswer: (a: keyof typeof CHECKIN_LABELS) => void; busy: boolean }) {
  if (c.answered) return <p className="k-muted px-1 text-xs">You said: {CHECKIN_LABELS[c.answered]}. Only you can see this.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(CHECKIN_LABELS) as (keyof typeof CHECKIN_LABELS)[]).map((k) => (
        <button key={k} type="button" className="k-chip px-3.5 py-1.5 text-sm" disabled={busy} onClick={() => onAnswer(k)}>{CHECKIN_LABELS[k]}</button>
      ))}
      <p className="k-muted w-full px-1 text-xs">{c.name} never sees your answer.</p>
    </div>
  );
}


export function ConnectCard({ c, onDone }: { c: NonNullable<ChatView["connect"]>; onDone: (v: ChatView | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    setBusy(true);
    const res = await fetch("/api/chat/connect", { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(data?.error ?? "That didn't work. Try again.");
    onDone(data);
  }
  async function notMine() {
    setBusy(true);
    await fetch("/api/signout", { method: "POST" }).catch(() => null);
    onDone(null);
  }
  return (
    <div className="k-card rounded-3xl p-5 text-sm">
      <p className="text-base font-semibold">Connect {c.email || "this sign-in"} to {c.name}&apos;s Kismet account?</p>
      <p className="k-muted mt-1.5">This browser has {c.name}&apos;s private link open. Connect only if that account is yours: after that, signing in with {c.email ? "this email or Google account" : "it"} opens it on any device.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost min-h-11 text-sm" disabled={busy} onClick={notMine}>Not mine</button>
        <button type="button" className="btn btn-primary min-h-11 text-sm" disabled={busy} onClick={connect}>Connect</button>
      </div>
      {error && <p role="alert" className="mt-2 font-medium text-danger">{error}</p>}
    </div>
  );
}

/** Signed in but no Kismet account yet: offer the account they may already have before a second one is made. */
export function NewcomerCard() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  function go(e: React.FormEvent) {
    e.preventDefault();
    const m = /\/u\/([A-Za-z0-9_-]{20,100})/.exec(link.trim());
    if (!m) return setError("Paste the whole private link (…/u/abc123…).");
    location.href = `/u/${m[1]}?next=chat`; // eslint-disable-line @next/next/no-location-assign-relative-destination
  }
  return (
    <details className="k-more self-center text-sm">
      <summary className="flex min-h-11 cursor-pointer select-none items-center justify-center font-medium text-link">Already on Kismet? Use that account</summary>
      <form onSubmit={go} className="k-card mt-3 flex flex-col gap-2 rounded-3xl p-4">
        <p className="k-muted">From the quiz, the app or Agent Village: paste your private link to use that account instead of making a new one. On WhatsApp? Keep chatting with Kismet there.</p>
        <input className="field text-sm" aria-label="Your private link" placeholder="https://kismet-village.vercel.app/u/…" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn btn-ghost min-h-11 text-sm">Open my account</button>
        {error && <p role="alert" className="font-medium text-danger">{error}</p>}
      </form>
    </details>
  );
}

/**
 * The photo step: right after sign-up, and the one-time Google picture question (lib/photo-nudge.ts showPhotoCard).
 * Upload one here, or (Google sign-in with a picture) use that picture: nothing is added unless they pick a file or tap
 * "Use my Google photo", and either gets the same check as any upload. Skip is one tap and is never a "no": it waits a
 * few days (onSkip). onDone(note): the outcome to keep on screen (the next poll hides this card).
 */
export function PhotoCard({ google, onDone, onSkip }: { google: boolean; onDone: (note: string) => void; onSkip: () => void }) {
  const [busy, setBusy] = useState<null | "upload" | "google">(null);
  const [error, setError] = useState("");
  async function upload(file: File) {
    setBusy("upload");
    setError("");
    const r = await uploadPhoto(file);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onDone(SAVED_TEXT);
  }
  async function takeGoogle() {
    setBusy("google");
    setError("");
    const res = await fetch("/api/me/photo/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ use: true }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(null);
    // Refused (not a clear photo of you): final for the Google picture, so say why where it stays visible (the next poll
    // may hide this card). An upload still works, and is still asked for later.
    if (res?.status === 422 && data?.error && !/couldn't check/i.test(data.error)) return onDone(`Your Google picture wasn't used: ${data.error} You can upload a photo in Profile.`);
    if (!res?.ok) return setError(data?.error ?? "That didn't save. Try again.");
    // No longer offered (a photo added meanwhile, say): nothing changed, so nothing to announce; the refresh hides the card.
    onDone(data?.used ? "Done: your Google profile picture is now your photo. Remove it any time in Profile." : "");
  }
  const uploadButton = (primary: boolean) => (
    <label className={`btn ${primary ? "btn-primary" : "btn-ghost"} min-h-11 cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus)] ${busy ? "pointer-events-none opacity-50" : ""}`}>
      {busy === "upload" ? "Checking..." : "Upload a photo"}
      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="sr-only" disabled={busy !== null}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
    </label>
  );
  return (
    <div className="k-card w-full max-w-sm rounded-3xl p-5 md:max-w-md">
      <p className="font-semibold">Add a photo so your matches can recognise you</p>
      <p className="k-muted mt-1.5 text-sm leading-relaxed">
        Optional. Only people your agent recommends you to, and your matches, see it. Remove it any time in Profile.
      </p>
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}
      <div className="mt-4 grid gap-2">
        {google && (
          <button type="button" className="btn btn-primary min-h-11" disabled={busy !== null} onClick={() => void takeGoogle()}>
            {busy === "google" ? "Checking..." : "Use my Google photo"}
          </button>
        )}
        {uploadButton(!google)}
      </div>
      <button type="button" className="k-muted mt-2 min-h-11 w-full text-sm underline-offset-2 hover:underline" disabled={busy !== null} onClick={onSkip}>Skip for now</button>
    </div>
  );
}

/** "Add a photo so Priya can spot you": on a match or plan card while they have no photo (lib/photo-nudge.ts showCardLine). */
function SpotYou({ name }: { name: string }) {
  return (
    <p className="k-muted mt-3 text-sm">
      <Link href="/home#photos" className="font-medium text-link underline underline-offset-2">Add a photo</Link> so {firstWord(name)} can spot you.
    </p>
  );
}

/**
 * The one-time question after 90 minutes of use: share their data for feedback and training? Optional, off unless they
 * tap "Yes, share", changeable any time in Profile. The feedback box is optional and saved with either answer.
 */
export function TrainingCard({ onDone }: { onDone: (note: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  async function answer(share: boolean) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/me/training", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ share, feedback, from: "chat" }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(data?.error ?? "That didn't save. Try again.");
    const thanks = data?.feedbackSaved === true ? " Thanks for the feedback too." : data?.feedbackSaved === false ? " Your feedback didn't save, sorry." : "";
    onDone(share ? `Thank you! You can stop sharing any time in Profile.${thanks}` : `No problem, nothing is shared.${thanks}`);
  }
  return (
    <div className="k-card w-full max-w-sm rounded-3xl p-5">
      <p className="font-semibold">Help make Kismet better?</p>
      <p className="k-muted mt-1.5 text-sm leading-relaxed">
        Optional. If you say yes, we can use your chats with Kismet and your agent&apos;s chats with other agents to find what isn&apos;t working and to improve and
        train Kismet. Names, contact details and photos are taken out first, and an agent chat is only used if the other person said yes too. Saying
        no changes nothing, and you can change your answer any time in Profile.
      </p>
      <textarea className="field mt-3 min-h-20 w-full text-sm" maxLength={2000} aria-label="Feedback (optional)" placeholder="Anything you'd fix or add? (optional)"
        value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={busy} />
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void answer(false)}>No thanks</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void answer(true)}>Yes, share</button>
      </div>
    </div>
  );
}
