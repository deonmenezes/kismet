import Link from "next/link";
import { fraunces } from "@/lib/fonts";
import { pagePath } from "@/lib/pages-copy";

// The header and footer of the plain pages (board, terms, privacy, profile...). The chat itself is full screen.
// neutral: the pages the store apps open (app/app). Their links stay on those pages: the home page, board, chat, agent
// docs and llms.txt name Edge City.
export function SiteChrome({ children, neutral = false }: { children: React.ReactNode; neutral?: boolean }) {
  const logo = <span className="neon-sign block h-9 w-[76px]"><span className="neon-tube" /></span>;
  return (
    <div className={`k-page ${fraunces.variable} flex flex-col`}>
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <nav className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          {neutral ? <span className="grid min-h-11 place-items-center" role="img" aria-label="Kismet">{logo}</span> : (
            <Link href="/" className="grid min-h-11 place-items-center" aria-label="Kismet home">{logo}</Link>
          )}
          {!neutral && (
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Link href="/board" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3.5 font-medium hover:bg-bg-2">Board</Link>
              <Link href="/chat" className="btn btn-primary min-h-11 px-4 text-sm">Chat</Link>
            </div>
          )}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-16">{children}</main>
      {/* Every link at least 44 px tall (a comfortable tap). */}
      <footer className="mx-auto w-full max-w-xl border-t border-line px-4 pb-8 pt-6 text-center text-xs leading-7 text-muted">
        Kismet: your agent meets the village, you meet the right people
        {!neutral && (
          <>
            {" "}·{" "}
            <Link href="/agents" className="inline-flex min-h-11 min-w-11 items-center justify-center underline">For agents</Link> ·{" "}
            <Link href="/llms.txt" className="inline-flex min-h-11 min-w-11 items-center justify-center underline">llms.txt</Link>
          </>
        )}
        <br />
        <Link href={pagePath(neutral, "/terms")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline">Terms</Link> ·{" "}
        <Link href={pagePath(neutral, "/privacy")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline">Privacy</Link> ·{" "}
        <Link href={pagePath(neutral, "/support")} className="inline-flex min-h-11 min-w-11 items-center justify-center underline">Support</Link>
      </footer>
    </div>
  );
}
