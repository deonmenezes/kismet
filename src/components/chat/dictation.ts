"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// "Say it": the browser's own speech recognition (Chrome sends audio to Google's service, Safari to Apple's).
// Nothing is recorded by Kismet: only the transcribed text lands in the message box, and only while the mic is on.
// Stopping detaches the handlers first, so a late final result can't refill a box that was just sent.

/* eslint-disable @typescript-eslint/no-explicit-any */
const ctor = () => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);
const noop = () => () => {};

export function useDictation(onText: (text: string) => void) {
  const supported = useSyncExternalStore(noop, () => Boolean(ctor()), () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    setListening(false);
    if (!r) return;
    r.onresult = null;
    r.onend = null;
    r.onerror = null;
    try {
      r.abort();
    } catch {
      /* already stopped */
    }
  }, []);

  const start = useCallback(() => {
    const R = ctor();
    if (!R || rec.current) return;
    const r = new R();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e: any) => {
      if (rec.current !== r) return;
      onText(Array.from(e.results as ArrayLike<any>).map((x) => x[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim());
    };
    r.onend = () => {
      if (rec.current === r) {
        rec.current = null;
        setListening(false);
      }
    };
    r.onerror = () => r.onend?.();
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setListening(false);
    }
  }, [onText]);

  useEffect(() => stop, [stop]); // never leave the mic on after leaving the page

  return { supported, listening, start, stop };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
