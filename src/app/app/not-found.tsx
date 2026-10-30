import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

// app/not-found.tsx inside the /app pages' own header and footer (layout.tsx), with a way back that stays on them.
export default function AppNotFound() {
  return (
    <section className="rise flex flex-col items-center gap-4 pt-16 text-center">
      <p className="k-kicker">404</p>
      <h1 className="k-serif text-[2.2rem] leading-tight">This page isn&apos;t here</h1>
      <p className="max-w-sm text-muted">The link may be old or mistyped.</p>
      <Link href="/app/support" className="btn btn-primary mt-2 w-full max-w-xs text-lg">Help and support</Link>
    </section>
  );
}
