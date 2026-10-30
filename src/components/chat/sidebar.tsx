"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SideView } from "@/lib/text/web-chat";
import { Avatar, letter } from "./avatar";
import { AppsIcon, BoardIcon, CalendarIcon, ChevronIcon, CloseIcon, ExternalIcon, LogOutIcon, ShieldIcon, SparkIcon, UserIcon } from "./icons";

// The chats sidebar, the same on the Kismet chat and in every match chat: Kismet first, then each match as a
// conversation, "More" and the account row. Docked beside the chat on a desktop-wide screen, a drawer on a phone.

export function NeonLogo({ className = "" }: { className?: string }) {
  return <span role="img" aria-label="Kismet" className={`neon-sign ${className}`}><span className="neon-tube" /></span>;
}

/** Desktop width: the sidebar stays open beside the chat. */
export function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

/** One conversation in the menu: avatar, name, a one-line preview, and a dot for unread messages. */
function ChatRow({ title, subtitle, avatar, href, onClick, unread = false, current = false }: {
  title: string; subtitle: string; avatar: React.ReactNode; href?: string; onClick?: () => void; unread?: boolean; current?: boolean;
}) {
  const body = (
    <>
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className={`block truncate text-xs ${unread ? "font-medium" : "k-muted"}`}>{subtitle}</span>
      </span>
      {unread && <><span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[var(--k-accent-text)]" /><span className="sr-only"> (new messages)</span></>}
    </>
  );
  const cls = "k-item flex min-h-14 w-full items-center gap-3 px-2.5 py-2 text-left";
  return href && !current
    ? <Link href={href} className={cls}>{body}</Link>
    : <button type="button" className={cls} aria-current={current ? "page" : undefined} onClick={onClick}>{body}</button>;
}

function MenuItem({ icon, children, onClick, href, external }: {
  icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; href?: string; external?: boolean;
}) {
  const cls = "k-item flex min-h-11 w-full items-center gap-3 px-3 text-left";
  const body = <>{icon}<span className="min-w-0 flex-1 truncate">{children}</span></>;
  if (href && external) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{body}<ExternalIcon className="size-3.5 opacity-50" /><span className="sr-only"> (opens in a new tab)</span></a>;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/**
 * current: "kismet" or the open match's date id. onKismet: tapping the Kismet row while on it (back to the message
 * box); elsewhere it links to /chat. onAsk: menu items that ask Kismet something (on a match chat they open a page
 * instead). onSignal: pause / resume / drop one of their signals.
 */
export function ChatsSidebar({ side, signedIn, current, docked, onClose, onKismet, onAsk, onSignal, onSignIn, onSignOut }: {
  side: SideView | null; signedIn: boolean; current: "kismet" | string; docked: boolean;
  onClose: () => void; onKismet?: () => void; onAsk?: (text: string) => void;
  onSignal: (id: string, action: "pause" | "resume" | "drop") => void; onSignIn?: () => void; onSignOut: () => void;
}) {
  const [more, setMore] = useState(false);
  const matches = side?.matches ?? [];
  const account = signedIn && Boolean(side?.name);
  return (
    <aside id="kismet-menu" role={docked ? undefined : "dialog"} aria-modal={docked ? undefined : true} aria-label="Menu"
      className={`k-side flex flex-col ${docked ? "k-docked w-[280px] shrink-0" : "fixed inset-y-0 left-0 z-40 w-[min(300px,85vw)]"}`}>
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Link href={signedIn ? "/chat" : "/"} aria-label="Kismet home" className="grid min-h-11 place-items-center rounded-lg px-1" onClick={onClose}><NeonLogo className="block h-9 w-16" /></Link>
        {!docked && <button type="button" className="k-icon grid size-11 place-items-center rounded-full" aria-label="Close menu" onClick={onClose}><CloseIcon /></button>}
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3" aria-label="Chats">
        {/* A messaging app's list: your agent first, then each match as a conversation. */}
        <ChatRow current={current === "kismet"} href="/chat" title="Kismet" subtitle={(side?.running ?? 0) > 0 ? "Chatting with an agent now" : "Your agent"} onClick={onKismet ?? onClose}
          avatar={<span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent"><SparkIcon className="size-5" /></span>} />
        {matches.length > 0 && <h2 className="k-muted px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider">Matches</h2>}
        {matches.map((m) => (
          <ChatRow key={m.dateId} href={`/chat/${m.dateId}`} current={current === m.dateId} onClick={onClose} title={m.name} subtitle={m.last ?? "Say hi"} unread={m.unread && current !== m.dateId}
            avatar={<Avatar name={m.name} photo={m.photoUrl} />} />
        ))}
        {signedIn && side && matches.length === 0 && <p className="k-muted mx-1 mt-4 rounded-xl border border-dashed border-line-strong/50 px-3 py-3 text-sm">Your matches show up here once you both say yes.</p>}

        <div className="mt-auto pt-5">
          <button type="button" className="k-item k-muted flex min-h-11 w-full items-center px-3 text-left text-sm" aria-expanded={more} aria-controls="kismet-more" onClick={() => setMore((v) => !v)}>
            <span className="flex-1">More</span><ChevronIcon className={`size-4 transition ${more ? "rotate-180" : ""}`} />
          </button>
          <div id="kismet-more" hidden={!more} className="flex flex-col gap-0.5 text-[0.95rem]">
            {account && side!.signals.length > 0 && (
              <>
                <h2 className="k-muted px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider">Signals</h2>
                {side!.signals.map((sg) => (
                  <div key={sg.id} className="k-item flex items-start gap-2 px-3 py-2 text-sm">
                    <SparkIcon className={`mt-0.5 size-4 shrink-0 ${sg.status === "active" ? "text-[var(--k-accent-text)]" : "opacity-40"}`} />
                    <span className={`min-w-0 flex-1 break-words ${sg.status === "paused" ? "opacity-60" : ""}`}>{sg.text}</span>
                    <span className="flex shrink-0 gap-2">
                      <button type="button" className="min-h-11 rounded-lg px-2 text-xs font-medium text-link underline-offset-2 hover:underline" onClick={() => onSignal(sg.id, sg.status === "paused" ? "resume" : "pause")}
                        aria-label={`${sg.status === "paused" ? "Resume" : "Pause"} signal: ${sg.text}`}>{sg.status === "paused" ? "Resume" : "Pause"}</button>
                      <button type="button" className="min-h-11 rounded-lg px-2 text-xs font-medium text-link underline-offset-2 hover:underline" onClick={() => onSignal(sg.id, "drop")} aria-label={`Drop signal: ${sg.text}`}>Drop</button>
                    </span>
                  </div>
                ))}
              </>
            )}
            {signedIn && (onAsk
              ? <MenuItem icon={<ShieldIcon />} onClick={() => onAsk("Who sees what?")}>Who sees what</MenuItem>
              : <MenuItem icon={<ShieldIcon />} href="/privacy">Who sees what</MenuItem>)}
            {onAsk && <MenuItem icon={<AppsIcon />} onClick={() => onAsk("What's on today?")}>What&apos;s on at Edge City</MenuItem>}
            <MenuItem icon={<BoardIcon />} href="/board">Village Board</MenuItem>
            <MenuItem icon={<CalendarIcon />} href="https://agents.edgecity.live" external>Agent Village</MenuItem>
            <p className="k-muted px-3 pt-3 text-xs">
              <Link href="/terms" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:underline">Terms</Link> · <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:underline">Privacy</Link> · <Link href="/agents" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:underline">For agents</Link> · <Link href="/support" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:underline">Support</Link>
            </p>
          </div>
        </div>
      </nav>
      <div className="k-line flex items-center gap-3 border-t px-3 py-3">
        {signedIn ? (
          <>
            <span aria-hidden className="k-tag grid size-9 shrink-0 place-items-center rounded-full font-semibold">{letter(side?.name ?? side?.email ?? "?")}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{side?.name ?? "New here"}</p>
              <p className="k-muted truncate text-xs">{side?.email ?? "Private link"}</p>
            </div>
            {account && <Link href="/home" className="k-icon grid size-11 place-items-center rounded-full" aria-label="Profile" title="Profile"><UserIcon /></Link>}
            <button type="button" className="k-icon grid size-11 place-items-center rounded-full" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOutIcon /></button>
          </>
        ) : (
          <button type="button" className="btn btn-primary min-h-11 w-full text-sm" onClick={onSignIn}>Sign in</button>
        )}
      </div>
    </aside>
  );
}
