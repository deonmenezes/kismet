import type { Metadata } from "next";
import Link from "next/link";
import { SiteChrome } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Page not found" };

// Any URL that isn't a page: the site's own header and footer, and a way back.
export default function NotFound() {
  return (
    <SiteChrome>
      <section className="rise flex flex-col items-center gap-4 pt-16 text-center">
        <p className="k-kicker">404</p>
        <h1 className="k-serif text-[2.2rem] leading-tight">This page isn&apos;t here</h1>
        <p className="max-w-sm text-muted">The link may be old or mistyped. Your agent is still out there finding your people.</p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
          <Link href="/" className="btn btn-primary w-full text-lg">Back to Kismet</Link>
          <Link href="/support" className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-muted underline">Help and support</Link>
        </div>
      </section>
    </SiteChrome>
  );
}
