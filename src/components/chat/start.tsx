"use client";

import { useState } from "react";
import { SignIn } from "@/components/sign-in";
import { Modal } from "./modal";
import { useDictation } from "./dictation";
import { CheckIcon, CopyIcon, MicIcon, SparkIcon, WhatsAppIcon } from "./icons";

// The popups of the chat: how to start (say it, type it, hand a prompt to your own AI, WhatsApp) and sign-in.

export const agentPrompt = (origin: string) =>
  `Read ${origin}/llms.txt and sign me up for Kismet, the AI agent intros app. First ask me what I want and who I'm looking for, then show me my profile before you submit it.`;

/** Copies text, with a "Copied" tick for 2 seconds. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* clipboard blocked: the text is on screen to select */
    }
  }
  return (
    <button type="button" onClick={copy} className={className} aria-label={done ? "Copied" : label}>
      {done ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      <span>{done ? "Copied" : label}</span>
    </button>
  );
}

type Pane = "pick" | "say" | "prompt";

/** "How do you want to tell Kismet about you?" */
export function StartDialog({ open, onClose, onSend, onType, whatsappUrl }: {
  open: boolean; onClose: () => void; onSend: (text: string) => void; onType: () => void; whatsappUrl: string | null;
}) {
  const [pane, setPane] = useState<Pane>("pick");
  const [heard, setHeard] = useState("");
  const mic = useDictation(setHeard);
  const close = () => {
    mic.stop();
    setPane("pick");
    setHeard("");
    onClose();
  };
  const option = "flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left transition hover:border-select hover:bg-bg-2";

  return (
    <Modal open={open} onClose={close} title={pane === "say" ? "Say it" : pane === "prompt" ? "Hand it to your own AI" : "How do you want to start?"}>
      {pane === "pick" && (
        <div className="flex flex-col gap-2.5">
          <p className="mb-1 text-sm text-muted">Tell Kismet what you want and who you&apos;re looking for. Any way works.</p>
          {mic.supported && (
            <button type="button" className={option} onClick={() => setPane("say")}>
              <span className="grid size-10 place-items-center rounded-full bg-tag text-tag-ink"><MicIcon /></span>
              <span><b className="block">Say it out loud</b><span className="text-sm text-muted">Talk, and it&apos;s written down as you go.</span></span>
            </button>
          )}
          <button type="button" className={option} onClick={() => { close(); onType(); }}>
            <span className="grid size-10 place-items-center rounded-full bg-tag text-tag-ink"><SparkIcon /></span>
            <span><b className="block">Type it</b><span className="text-sm text-muted">A few lines about you. Kismet asks the rest.</span></span>
          </button>
          <button type="button" className={option} onClick={() => setPane("prompt")}>
            <span className="grid size-10 place-items-center rounded-full bg-tag text-tag-ink"><CopyIcon /></span>
            <span><b className="block">Copy a prompt for your AI</b><span className="text-sm text-muted">ChatGPT, Claude or another AI agent asks you, then signs you up.</span></span>
          </button>
          {whatsappUrl && (
            <a className={option} href={whatsappUrl} target="_blank" rel="noreferrer">
              <span className="grid size-10 place-items-center rounded-full bg-tag text-tag-ink"><WhatsAppIcon /></span>
              <span><b className="block">Text Kismet on WhatsApp</b><span className="text-sm text-muted">No app, no website: just text.</span></span>
            </a>
          )}
        </div>
      )}

      {pane === "say" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <button type="button" onClick={mic.listening ? mic.stop : mic.start} aria-pressed={mic.listening}
            className={`grid size-20 place-items-center rounded-full ${mic.listening ? "mic-live bg-accent text-on-accent" : "bg-tag text-tag-ink"}`}
            aria-label={mic.listening ? "Stop listening" : "Start listening"}>
            <MicIcon className="size-8" />
          </button>
          <p className="text-sm text-muted">{mic.listening ? "Listening… what do you want, and who are you looking for?" : "Tap the mic and talk. Your browser does the transcribing."}</p>
          <p className="min-h-20 w-full whitespace-pre-wrap rounded-2xl border border-line bg-bg-2 p-3 text-left">{heard || <span className="text-muted">Your words show up here.</span>}</p>
          <div className="grid w-full grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost min-h-11 text-sm" onClick={() => { mic.stop(); setPane("pick"); }}>Back</button>
            <button type="button" className="btn k-send min-h-11 text-sm" disabled={!heard.trim()} onClick={() => { const t = heard.trim(); close(); onSend(t); }}>Send to Kismet</button>
          </div>
        </div>
      )}

      {pane === "prompt" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Paste this into ChatGPT, Claude or another AI agent. It reads Kismet&apos;s instructions, asks you each question and signs you up through Kismet&apos;s API.</p>
          <p className="rounded-2xl border border-line bg-bg-2 p-3 font-mono text-sm leading-relaxed">{agentPrompt(location.origin)}</p>
          <CopyButton text={agentPrompt(location.origin)} label="Copy prompt" className="btn k-send min-h-11 gap-2 text-sm" />
          <button type="button" className="text-sm min-h-11 font-medium text-link underline underline-offset-2" onClick={() => setPane("pick")}>Other ways</button>
        </div>
      )}
    </Modal>
  );
}

/**
 * Signing in (or up) without leaving the chat, on a desktop-wide screen: whatever they typed waits and comes back once
 * they're in. Phones and iOS get the /sign-in page instead (components/sign-in-page.tsx).
 */
export function SignInDialog({ open, onClose, waiting, enabled = true }: {
  open: boolean; onClose: () => void; waiting: string | null; enabled?: boolean;
}) {
  const [locked, setLocked] = useState(false); // a code being checked, or "You're in": closing now would drop their words
  return (
    <Modal open={open} onClose={onClose} title="Sign in to continue" variant="sheet" locked={locked}>
      {enabled ? <SignIn waiting={waiting} onLock={setLocked} /> : (
        <div className="k-signin">
          <h2 className="k-display">Sign in to continue</h2>
          <p className="mt-3 text-sm text-muted">Sign-in is being set up. Meanwhile, <a href="/join" className="font-bold underline">sign up with the quiz</a>.</p>
        </div>
      )}
    </Modal>
  );
}
