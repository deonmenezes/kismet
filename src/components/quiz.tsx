"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AVAILABILITY, GENDER, INTEREST_CHIPS, INTERESTED_IN, LOOKING_FOR, OPENNESS, REL_STATUS, telegramStepOk, type ProfileInput,
} from "@/lib/options";
import { EDGE_WEEKS } from "@/lib/edge-city";
import { pagePath, quizCopy } from "@/lib/pages-copy";

type StepId = "edge" | "name" | "status" | "openness" | "looking" | "romance" | "interests" | "bio" | "free" | "telegram" | "agent";

const EMPTY: ProfileInput = {
  name: "", relStatus: "undisclosed", openness: null, lookingFor: [], gender: null, interestedIn: null,
  interests: [], bio: "", telegram: "", agentProfile: "", agentName: "", agentPersonality: "", publicQuotes: false, xHandle: "", useXPhoto: false,
};

/**
 * telegram (edit only): optional when matches reach them another way (lib/validate.ts telegramOptionalFor); byPhone: on WhatsApp.
 * neutral: the store apps' sign-up (/app/join), naming no event or place (lib/pages-copy.ts quizCopy); same answers sent.
 */
export function Quiz({ initial, mode, telegram, neutral = false }: {
  initial?: ProfileInput; mode: "join" | "edit"; telegram?: { optional: boolean; byPhone: boolean }; neutral?: boolean;
}) {
  const router = useRouter();
  const copy = quizCopy(neutral);
  const [p, setP] = useState<ProfileInput>(initial ?? EMPTY);
  const [statusPicked, setStatusPicked] = useState(Boolean(initial));
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ link: string; verifyLink?: string } | null>(null);
  // Edge City only: "No" shows the waitlist instead of the rest of the quiz (nothing is sent).
  const [notHere, setNotHere] = useState(false);

  const steps = useMemo(() => {
    // A new sign-up is asked first whether they are at Edge City India (lib/edge-city.ts); /edit is for members.
    // Relationship status, openness and gender only matter for romance (lib/match.ts), so only Romance asks them, as in
    // the chat's sign-up (lib/text/parse.ts nextField).
    const s: StepId[] = mode === "join" ? ["edge", "name", "looking"] : ["name", "looking"];
    if (p.lookingFor.includes("romance")) {
      s.push("status");
      if (p.relStatus === "single" || p.relStatus === "complicated") s.push("openness");
      s.push("romance");
    }
    s.push("interests", "bio", "free", "telegram", "agent");
    return s;
  }, [mode, p.relStatus, p.lookingFor]);

  const step = steps[Math.min(i, steps.length - 1)];
  const set = (patch: Partial<ProfileInput>) => setP((x) => ({ ...x, ...patch }));
  const next = () => { setError(""); setI((n) => Math.min(n + 1, steps.length - 1)); };
  const back = () => { setError(""); setI((n) => Math.max(n - 1, 0)); };
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(mode === "join" ? "/api/signup" : "/api/me", {
        method: mode === "join" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        // A new sign-up sends the private answers only with Romance (they may have been picked before Romance was dropped).
        body: JSON.stringify(mode === "join"
          ? { ...(p.lookingFor.includes("romance") ? p : { ...p, relStatus: "undisclosed", openness: null, gender: null, interestedIn: null }), agreedToTerms: agreed, ageConfirmed: agreed }
          : p),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      if (mode === "edit") {
        router.push("/home");
        router.refresh();
      } else {
        setDone({ link: data.privateLink, verifyLink: data.verifyLink });
        // "Your agent is ready!" starts at the top, not under the sticky header where the last question was (QA2 N-L9).
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Ready link={done.link} verifyLink={done.verifyLink} />;
  if (notHere) return <NotHere neutral={neutral} onBack={() => setNotHere(false)} />;

  const canNext: Record<StepId, boolean> = {
    edge: p.edgeCity === true,
    name: p.name.trim().length > 0,
    status: statusPicked,
    openness: true,
    looking: p.lookingFor.length > 0,
    romance: Boolean(p.gender && p.interestedIn),
    interests: p.interests.length >= 3,
    bio: true,
    free: true,
    telegram: telegramStepOk(p.telegram, telegram?.optional),
    agent: true,
  };

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col pt-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={i === 0 ? () => router.back() : back} className="btn btn-ghost min-h-11 px-4 text-sm" aria-label="Back">
          ← Back
        </button>
        <div className="flex flex-1 justify-center gap-1.5" aria-label={`Step ${i + 1} of ${steps.length}`}>
          {steps.map((s, n) => (
            <span key={s} className={`h-2 rounded-full transition-all duration-300 ${n === i ? "w-6 bg-select" : n < i ? "w-2 bg-select/45" : "w-2 bg-line-strong/40"}`} />
          ))}
        </div>
        <span className="w-16 text-right text-xs font-semibold text-muted">{i + 1}/{steps.length}</span>
      </div>

      <div key={step} className="rise mt-8 flex flex-1 flex-col">
        {step === "edge" && (
          <Q title={copy.question} hint={copy.hint}>
            <Options>
              <Big on={p.edgeCity === true} onClick={() => set({ edgeCity: true })}>Yes, I&apos;m here</Big>
              <Big on={false} onClick={() => setNotHere(true)}>No, I&apos;m not</Big>
            </Options>
            {p.edgeCity && copy.weeks && (
              <>
                <p className="mb-2 mt-6 font-bold">Which weeks? <span className="font-normal text-muted">Optional.</span></p>
                <Chips>
                  {EDGE_WEEKS.map((w) => (
                    <button key={w.id} type="button" className="chip" aria-pressed={(p.edgeWeeks ?? []).includes(w.id)}
                      onClick={() => set({ edgeWeeks: toggle(p.edgeWeeks ?? [], w.id) })}>{w.label}</button>
                  ))}
                </Chips>
              </>
            )}
          </Q>
        )}

        {step === "name" && (
          <Q title="What's your name?" hint="Your first name or what people call you in the village.">
            <input autoFocus className="field text-xl" maxLength={40} value={p.name} placeholder="Your name"
              onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && canNext.name && next()} />
          </Q>
        )}

        {step === "status" && (
          <Q title="Relationship status" hint="Private. Never shown publicly, only used to keep romance opt-in safe.">
            <Options>
              {REL_STATUS.map((o) => (
                <Big key={o.id} on={statusPicked && p.relStatus === o.id}
                  onClick={() => { set({ relStatus: o.id, openness: o.id === "single" || o.id === "complicated" ? p.openness : null }); setStatusPicked(true); setTimeout(next, 180); }}>
                  {o.label}
                </Big>
              ))}
            </Options>
          </Q>
        )}

        {step === "openness" && (
          <Q title="Open to..." hint="Optional and private.">
            <Options>
              {OPENNESS.map((o) => (
                <Big key={o.id} on={p.openness === o.id} onClick={() => { set({ openness: o.id }); setTimeout(next, 180); }}>{o.label}</Big>
              ))}
            </Options>
            <button type="button" className="mt-4 self-center text-sm font-semibold text-muted underline" onClick={() => { set({ openness: null }); next(); }}>
              Skip
            </button>
          </Q>
        )}

        {step === "looking" && (
          <Q title="What are you looking for here?" hint="Pick as many as you like.">
            <Chips>
              {LOOKING_FOR.map((o) => (
                <button key={o.id} type="button" className="chip text-base" aria-pressed={p.lookingFor.includes(o.id)}
                  onClick={() => set({ lookingFor: toggle(p.lookingFor, o.id) })}>{o.label}</button>
              ))}
            </Chips>
            {p.lookingFor.includes("romance") && (
              <p className="mt-4 text-sm text-muted">Romance intros only happen with people who also picked Romance and fit what you&apos;re open to.</p>
            )}
          </Q>
        )}

        {step === "romance" && (
          <Q title="Romance, just between us" hint="Private. Only used to pair romance intros.">
            <p className="mb-2 font-bold">I am</p>
            <Chips>
              {GENDER.map((o) => (
                <button key={o.id} type="button" className="chip text-base" aria-pressed={p.gender === o.id} onClick={() => set({ gender: o.id })}>{o.label}</button>
              ))}
            </Chips>
            <p className="mb-2 mt-6 font-bold">Interested in</p>
            <Chips>
              {INTERESTED_IN.map((o) => (
                <button key={o.id} type="button" className="chip text-base" aria-pressed={p.interestedIn === o.id} onClick={() => set({ interestedIn: o.id })}>{o.label}</button>
              ))}
            </Chips>
          </Q>
        )}

        {step === "interests" && (
          <Q title="Your interests" hint={`Pick 3 or more. ${p.interests.length} picked.`}>
            <Chips>
              {[...INTEREST_CHIPS, ...p.interests.filter((x) => !INTEREST_CHIPS.includes(x))].map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={p.interests.includes(c)}
                  onClick={() => set({ interests: toggle(p.interests, c) })}>{c}</button>
              ))}
              <AddOwn onAdd={(v) => !p.interests.includes(v) && p.interests.length < 15 && set({ interests: [...p.interests, v] })} />
            </Chips>
          </Q>
        )}

        {step === "bio" && (
          <Q title="One line about you" hint="Optional.">
            <input autoFocus className="field" maxLength={160} value={p.bio} placeholder="Building an AI app, here for sunsets and good convos"
              onChange={(e) => set({ bio: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()} />
          </Q>
        )}

        {step === "free" && (
          <Q title="When are you usually free to meet up?" hint="Optional. Your Kismet comes with a meetup plan at a time that suits you both.">
            <Options>
              {AVAILABILITY.map((o) => (
                <Big key={o.id} on={p.availability === o.id} onClick={() => set({ availability: o.id })}>{o.label}</Big>
              ))}
            </Options>
            <input className="field mt-4" maxLength={40} value={p.area ?? ""} placeholder={copy.areaPlaceholder}
              onChange={(e) => set({ area: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()} />
          </Q>
        )}

        {step === "telegram" && (
          <Q title="Your Telegram handle" hint={telegram?.byPhone
            ? "Optional. Your matches reach you on WhatsApp, as you chose on Kismet by text; adding a Telegram doesn't change that. Never public."
            : telegram?.optional ? "Optional. Without one, your matches message you in Kismet. Once added, it's how they reach you, so it can be changed but not removed. Never public." : "Shown only to your matches. Never public."}>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-muted">@</span>
              <input autoFocus className="field text-lg" maxLength={40} value={p.telegram} placeholder="yourhandle" autoCapitalize="none" autoCorrect="off"
                onChange={(e) => set({ telegram: e.target.value.replace(/^@/, "") })} onKeyDown={(e) => e.key === "Enter" && canNext.telegram && next()} />
            </div>
          </Q>
        )}

        {step === "agent" && (
          <Q title="Almost there" hint="All optional. Your quiz answers are enough for your agent to start meeting people.">
            <AgentExtras p={p} set={set} copy={copy} />
            {mode === "join" && (
              <label className="mt-4 flex min-h-14 cursor-pointer items-start gap-3 rounded-3xl border border-line bg-card p-4">
                <input type="checkbox" required className="mt-1 size-5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span className="text-sm">
                  <b>I&apos;m 18 or older and agree to the <Link href={pagePath(neutral, "/terms")} target="_blank" className="underline">Terms</Link></b> and the{" "}
                  <Link href={pagePath(neutral, "/privacy")} target="_blank" className="underline">Privacy Policy</Link>. Zero tolerance for harassment or objectionable content.
                </span>
              </label>
            )}
          </Q>
        )}
      </div>

      {error && <p role="alert" className="mt-4 rounded-2xl bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}

      <div className="sticky bottom-0 mt-6 bg-bg pb-4 pt-4">
        {step === "agent" ? (
          <button type="button" className="btn btn-primary w-full text-lg" disabled={busy || (mode === "join" && !agreed)} onClick={submit}>
            {busy ? "Saving..." : mode === "join" ? "Create my agent" : "Save changes"}
          </button>
        ) : step !== "status" && step !== "openness" ? (
          <button type="button" className="btn btn-primary w-full text-lg" disabled={!canNext[step]} onClick={next}>
            {(step === "bio" && !p.bio) || (step === "free" && !p.availability && !p.area) ? "Skip" : "Next"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Q({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <h1 className="k-serif text-[2.2rem] leading-[1.1]">{title}</h1>
      {hint && <p className="mb-6 mt-2 text-muted">{hint}</p>}
      {children}
    </div>
  );
}

const Options = ({ children }: { children: React.ReactNode }) => <div className="flex flex-col gap-3">{children}</div>;
const Chips = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap gap-2">{children}</div>;

function Big({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`min-h-14 rounded-2xl border px-5 text-left text-lg font-semibold transition-all active:scale-[0.98] ${on ? "border-select bg-select text-on-select" : "border-line-strong bg-card hover:border-select"}`}>
      {children}
    </button>
  );
}

function AddOwn({ onAdd }: { onAdd: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const add = () => { const t = v.trim().slice(0, 30); if (t) onAdd(t); setV(""); setOpen(false); };
  if (!open) return <button type="button" className="chip border-dashed" onClick={() => setOpen(true)}>+ Add your own</button>;
  return (
    <span className="flex w-full gap-2">
      <input autoFocus className="field min-h-11 py-2" maxLength={30} value={v} placeholder="e.g. Freediving"
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <button type="button" className="btn btn-primary min-h-11 px-4" onClick={add}>Add</button>
    </span>
  );
}

function AgentExtras({ p, set, copy }: { p: ProfileInput; set: (x: Partial<ProfileInput>) => void; copy: ReturnType<typeof quizCopy> }) {
  const [open, setOpen] = useState(Boolean(p.agentProfile));
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-3xl border border-line bg-card">
        <button type="button" className="flex min-h-14 w-full items-center justify-between px-4 text-left font-bold" onClick={() => setOpen(!open)} aria-expanded={open}>
          {copy.pasteTitle}
          <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </button>
        {open && (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <p className="text-sm text-muted">{copy.askAgent}</p>
            <blockquote className="rounded-2xl bg-bg-2 p-3 text-sm">{copy.agentPrompt}</blockquote>
            <button type="button" className="btn btn-ghost min-h-11 text-sm"
              onClick={async () => { try { await navigator.clipboard.writeText(copy.agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }}>
              {copied ? "Copied!" : "Copy prompt"}
            </button>
            <textarea className="field min-h-40 text-base" maxLength={1500} value={p.agentProfile}
              placeholder="Paste your agent's answer here" onChange={(e) => set({ agentProfile: e.target.value })} />
            <p className="text-xs text-muted">Emails, phone numbers and links are removed automatically.</p>
          </div>
        )}
      </div>
      <input className="field" maxLength={40} value={p.agentName} placeholder="Agent name (optional)" onChange={(e) => set({ agentName: e.target.value })} />
      <input className="field" maxLength={140} value={p.agentPersonality} placeholder="Agent personality in one line (optional)"
        onChange={(e) => set({ agentPersonality: e.target.value })} />
      <input className="field" maxLength={40} value={p.xHandle} placeholder="Your X username (optional)" autoCapitalize="none" autoCorrect="off"
        onChange={(e) => set({ xHandle: e.target.value.replace(/^@/, ""), useXPhoto: e.target.value ? p.useXPhoto : false })} />
      {p.xHandle && (
        <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-3xl border border-line bg-card p-4">
          <input type="checkbox" className="mt-1 size-5" checked={p.useXPhoto} onChange={(e) => set({ useXPhoto: e.target.checked })} />
          <span className="text-sm"><b>Use my X profile picture.</b> Only if @{p.xHandle} is your own account and the picture shows you. Matches and people your agent recommends you to can see it.</span>
        </label>
      )}
      <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-3xl border border-line bg-card p-4">
        <input type="checkbox" className="mt-1 size-5" checked={p.publicQuotes} onChange={(e) => set({ publicQuotes: e.target.checked })} />
        <span className="text-sm"><b>Show short quotes from my agent chats on the public Village Board.</b> Only when the other person opted in too.</span>
      </label>
    </div>
  );
}

/** Not at Edge City India: Kismet is Edge City only for now, so the waitlist (and a way back for a wrong tap). */
function NotHere({ neutral, onBack }: { neutral: boolean; onBack: () => void }) {
  const copy = quizCopy(neutral);
  return (
    <div className="rise flex flex-col items-center gap-5 pt-10 text-center">
      <h1 className="k-serif text-[2.2rem] leading-tight">{copy.notHereTitle}</h1>
      <p className="text-muted">{copy.notHereBody}</p>
      <Link href={pagePath(neutral, "/waitlist")} className="btn btn-primary w-full text-lg">Join the waitlist</Link>
      <button type="button" className="btn btn-ghost w-full" onClick={onBack}>{copy.notHereBack}</button>
    </div>
  );
}

function Ready({ link, verifyLink }: { link: string; verifyLink?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function go() {
    setBusy(true);
    await fetch("/api/me/dates", { method: "POST" }).catch(() => null);
    router.push("/home");
  }
  return (
    <div className="rise flex flex-col items-center gap-5 pt-10 text-center">
      <div className="pulse-ring relative grid size-24 place-items-center rounded-full border border-line bg-card text-5xl">🤖</div>
      <h1 className="k-serif text-[2.2rem] leading-tight">Your agent is ready!</h1>
      <p className="text-muted">It&apos;s dressed up, briefed on you, and ready to meet the village.</p>
      <div className="w-full rounded-3xl border border-line bg-card p-4 text-left">
        <p className="text-sm font-bold">Your private link (shown once)</p>
        <p className="mt-1 text-xs text-muted">Bookmark it to sign in on another device, or hand it to your agent. Don&apos;t share it publicly.</p>
        <p className="mt-3 break-all rounded-xl bg-bg-2 p-3 font-mono text-xs">{link}</p>
        <button type="button" className="btn btn-ghost mt-3 min-h-11 w-full text-sm"
          onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>
          {copied ? "Copied!" : "Copy private link"}
        </button>
      </div>
      {verifyLink && (
        <div className="w-full rounded-3xl border border-line bg-card p-4 text-left">
          <p className="text-sm font-bold">Optional: get a ✓ World ID verified badge</p>
          <p className="mt-1 text-xs text-muted">Your matches see it, and you rank a little higher. Orb or Selfie Check in World App. Skip it if you like.</p>
          <a href={verifyLink} className="btn btn-ghost mt-3 min-h-11 w-full text-sm">Verify with World ID</a>
        </div>
      )}
      <button type="button" className="btn btn-primary w-full text-lg" disabled={busy} onClick={go}>
        {busy ? "Sending..." : verifyLink ? "Skip and send my agent to meet people" : "Send my agent to meet people"}
      </button>
    </div>
  );
}
