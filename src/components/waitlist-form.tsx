"use client";

import { useState } from "react";
import Link from "next/link";
import { INTEREST_CHIPS } from "@/lib/options";
import { pagePath } from "@/lib/pages-copy";

const PLATFORM_OPTIONS = [["ios", "iPhone"], ["android", "Android"], ["web", "Web"]] as const;
type Done = { position: number; refCode: string | null; removalToken: string | null; existing: boolean };

/** neutral: the store apps' variant (/app/waitlist), whose links stay on the /app pages. */
export function WaitlistForm({ site, refCode, neutral = false }: { site: string; refCode: string | null; neutral?: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [handle, setHandle] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot: hidden from people
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, place, handle, interests, platforms, consent, website, ref: refCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setDone(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Joined site={site} done={done} neutral={neutral} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Email</span>
        <input type="email" required autoComplete="email" inputMode="email" className="field text-lg" maxLength={254} value={email}
          placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Name <span className="font-normal text-muted">(optional)</span></span>
        <input className="field" autoComplete="given-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Where are you? <span className="font-normal text-muted">(community or pop-up city, optional)</span></span>
        <input className="field" maxLength={80} value={place} placeholder="e.g. Zuzalu, Vitalia, Berlin" onChange={(e) => setPlace(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Instagram or X <span className="font-normal text-muted">(optional)</span></span>
        <input className="field" maxLength={60} value={handle} placeholder="@handle" autoCapitalize="none" autoCorrect="off" onChange={(e) => setHandle(e.target.value)} />
      </label>
      <div>
        <p className="mb-2 text-sm font-bold">Interests <span className="font-normal text-muted">(optional)</span></p>
        <div className="flex flex-wrap gap-2">
          {INTEREST_CHIPS.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={interests.includes(c)} onClick={() => setInterests(toggle(interests, c))}>{c}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-bold">Where would you use it?</p>
        <div className="flex flex-wrap gap-2">
          {PLATFORM_OPTIONS.map(([id, label]) => (
            <button key={id} type="button" className="chip text-base" aria-pressed={platforms.includes(id)} onClick={() => setPlatforms(toggle(platforms, id))}>{label}</button>
          ))}
        </div>
      </div>
      <label aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <label className="flex min-h-14 cursor-pointer items-start gap-1 rounded-3xl border border-line bg-card p-2">
        {/* A 44 px tap area around the box (the whole card toggles it too). */}
        <span className="grid size-11 shrink-0 place-items-center">
          <input type="checkbox" required className="size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        </span>
        <span className="py-2.5 pr-2 text-sm"><b>Email me when Kismet opens.</b> No spam; see the <Link href={pagePath(neutral, "/privacy")} className="underline">Privacy Policy</Link>.</span>
      </label>
      {error && <p role="alert" className="rounded-2xl bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
      <button className="btn btn-primary w-full text-lg" disabled={busy || !consent || !email}>{busy ? "Joining..." : "Join the waitlist"}</button>
    </form>
  );
}

function Joined({ site, done, neutral }: { site: string; done: Done; neutral: boolean }) {
  const [copied, setCopied] = useState(false);
  const link = done.refCode ? `${site}${pagePath(neutral, "/waitlist")}?ref=${done.refCode}` : null;
  return (
    <div className="rise flex flex-col items-center gap-4 text-center">
      <div className="grid size-20 place-items-center rounded-full border border-line bg-card text-4xl">🌅</div>
      <h2 className="k-serif text-[2rem] leading-tight">You&apos;re #{done.position} on the list</h2>
      <p className="text-muted">{done.existing ? "You were already on the list. Here is your place." : "We'll email you when Kismet opens near you and in the app."}</p>
      {link && (
        <div className="w-full rounded-3xl border border-line bg-card p-4 text-left">
          <p className="font-bold">Move up 3 places for every friend who joins with your link</p>
          <p className="mt-2 break-all rounded-xl bg-bg-2 p-3 font-mono text-xs">{link}</p>
          <button type="button" className="btn btn-ghost mt-3 min-h-11 w-full text-sm"
            onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>
            {copied ? "Copied!" : "Copy my link"}
          </button>
        </div>
      )}
      {done.removalToken && (
        <p className="text-xs text-muted">
          Changed your mind? <a className="underline" href={`${site}${pagePath(neutral, "/waitlist/remove")}?t=${done.removalToken}`}>Remove me from the waitlist</a>{" "}
          (one-time link, save it if you like; it is shown only once).
        </p>
      )}
    </div>
  );
}
