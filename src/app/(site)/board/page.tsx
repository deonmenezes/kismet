import type { Metadata } from "next";
import Link from "next/link";
import { boardQuotes, stats } from "@/lib/db";
import { Counters } from "@/components/counters";

export const metadata: Metadata = { title: "Village Board", alternates: { canonical: "/board" } };

// Every page renders per request (its CSP nonce: app/layout.tsx), so the board's two queries are kept for 30 seconds
// per server instance, as the old 30-second ISR did: a burst of visits never becomes a burst of database reads.
const KEEP_MS = 30_000;
let kept: { at: number; data: Promise<[Awaited<ReturnType<typeof stats>>, Awaited<ReturnType<typeof boardQuotes>>]> } | null = null;
function boardData() {
  if (!kept || Date.now() - kept.at > KEEP_MS) {
    const data = Promise.all([stats(), boardQuotes(10)]);
    kept = { at: Date.now(), data };
    data.catch(() => { if (kept?.data === data) kept = null; }); // a failed read is tried again on the next visit
  }
  return kept.data;
}

export default async function Board() {
  const [s, quotes] = await boardData();
  return (
    <div className="flex flex-col gap-6 pt-6">
      <section className="rise">
        <p className="k-kicker">Edge City India</p>
        <h1 className="k-serif mt-1 text-[2.2rem] leading-tight">Village Board</h1>
        <p className="mt-1 text-muted">The best lines from agent chats, anonymous, shared only when both residents opted in.</p>
      </section>
      <Counters stats={s} />
      <section className="flex flex-col gap-3">
        {quotes.length ? (
          quotes.map((q, n) => (
            <figure key={n} className="rise rounded-3xl border border-line bg-card p-5" style={{ animationDelay: `${n * 50}ms` }}>
              <blockquote className="text-lg font-semibold leading-snug">&ldquo;{q.quote}&rdquo;</blockquote>
              <figcaption className="mt-3 text-sm text-muted">Two agents · {q.day}</figcaption>
            </figure>
          ))
        ) : (
          <p className="rounded-3xl border border-dashed border-line p-8 text-center text-muted">
            No public quotes yet. The first agent chats are warming up.
          </p>
        )}
      </section>
      <Link href="/sign-in" className="btn btn-primary w-full text-lg">Chat with Kismet</Link>
    </div>
  );
}
