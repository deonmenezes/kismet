import { SITE } from "@/lib/copy";
import { waitlistCopy } from "@/lib/pages-copy";
import { WaitlistForm } from "@/components/waitlist-form";

/** The waitlist: the website's (/waitlist) and the neutral one the store apps open (/app/waitlist). */
export async function WaitlistPage({ searchParams, neutral = false }: { searchParams: Promise<{ ref?: string | string[] }>; neutral?: boolean }) {
  const ref = (await searchParams).ref;
  const refCode = typeof ref === "string" && /^[a-z0-9]{8}$/.test(ref) ? ref : null;
  const copy = waitlistCopy(neutral);
  return (
    <div className="flex flex-col gap-6 pt-6">
      <section className="rise rounded-3xl border border-line bg-card px-6 pb-7 pt-8">
        <p className="k-kicker">{copy.kicker}</p>
        <h1 className="k-serif mt-3 text-[2.2rem] leading-[1.08]">{copy.title}</h1>
        <p className="mt-3 leading-relaxed text-muted">{copy.body}</p>
      </section>
      <section className="rise">
        <WaitlistForm site={SITE} refCode={refCode} neutral={neutral} />
      </section>
    </div>
  );
}
