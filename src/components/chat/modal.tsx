"use client";

import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "@/lib/sign-in-help";
import { CloseIcon } from "./icons";

/**
 * A native <dialog> popup (focus trap, Esc and backdrop close). `sheet`: the sign-in sheet (a bottom sheet
 * on phones, a card on wider screens) that animates out as well as in; its content brings its own heading.
 * `locked`: no way to close it for now (close button, Esc, backdrop, Android back), e.g. while a sign-in finishes.
 */
export function Modal({ open, onClose, title, children, variant = "card", locked = false }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; variant?: "card" | "sheet"; locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false); // a text selection dragged out onto the backdrop must not close it
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sheet = variant === "sheet";
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  // An entrance still running 2 s after the latest one started is finished, so the sheet and its contents land at
  // rest: an animation that stalls (iOS WebKit, Low Power Mode, a tab opened in the background) would otherwise hold
  // its first frame, the sheet below the screen and its contents invisible. At rest everything is in its own place
  // (entrances fill `backwards` only, globals.css); looping animations (the spinner) are left alone.
  const settleSoon = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const d = ref.current;
      if (!d?.open || !d.getAnimations) return;
      for (const a of d.getAnimations({ subtree: true })) {
        if (a.playState === "finished" || !Number.isFinite(Number(a.effect?.getComputedTiming().endTime))) continue;
        try { a.finish(); } catch { a.cancel(); } // cancel: no animation at all, the element's own style
      }
    }, 2000);
  };
  // Right after showModal (opening, or opening again while locked).
  const afterOpen = (d: HTMLDialogElement) => {
    if (!sheet) return;
    const body = d.querySelector<HTMLElement>(".k-sheet-body");
    // The sheet starts with focus on its content, not on the close button (Tab reaches every control in order).
    // No scroll: focusing it mid-slide must not scroll its contents (or the page) under the sheet's top edge.
    body?.focus({ preventScroll: true });
    if (body) body.scrollTop = 0;
    settleSoon();
  };
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      afterOpen(d);
    }
    if (!open && d.open) d.close();
  }, [open, sheet]); // eslint-disable-line react-hooks/exhaustive-deps -- afterOpen only reads refs and `sheet`
  // Armed again on every open, and cleared on close or unmount (StrictMode's second mount arms it again too).
  useEffect(() => {
    if (!open || !sheet) return;
    settleSoon();
    return () => clearTimeout(settleTimer.current);
  }, [open, sheet]);
  // The sheet slides away before it closes (about 200 ms); the card, and reduced motion, close at once.
  const requestClose = () => {
    if (locked) return;
    if (!sheet || reducedMotion()) return onClose();
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200);
  };
  return (
    <dialog ref={ref} className={sheet ? "k-dialog k-sheet" : "k-dialog"} aria-label={title} data-closing={closing || undefined}
      onClose={() => {
        // A close the page couldn't stop (a browser may force it on a repeated Android back): open it again while locked.
        const d = ref.current;
        if (locked && open && d) {
          d.showModal();
          afterOpen(d);
        } else onClose();
      }}
      onCancel={(e) => { if (sheet || locked) { e.preventDefault(); requestClose(); } }}
      onAnimationStart={sheet ? settleSoon : undefined}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === ref.current; }}
      onClick={(e) => { if (e.target === ref.current && downOnBackdrop.current) requestClose(); }}>
      {sheet ? (
        <>
          {/* Outside the scrolling body, pinned to the sheet: it stays on screen however far the contents scroll (QA2 N-M4). */}
          <button type="button" className="k-sheet-close" aria-label="Close" onClick={requestClose} disabled={locked}><CloseIcon /></button>
          <div className="k-sheet-body" tabIndex={-1}>
            <span aria-hidden className="k-grabber" />
            {children}
          </div>
        </>
      ) : (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="k-serif pt-1.5 text-2xl leading-tight">{title}</h2>
            <button type="button" className="-m-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-bg-2" aria-label="Close" onClick={onClose}><CloseIcon /></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
