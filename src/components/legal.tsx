// Shared layout for the static legal and support pages, and the pages themselves: the website's (app/(site)) and the
// neutral ones the store apps open (app/app), from one source (lib/pages-copy.ts).
import Link from "next/link";
import { pagePath, privacy, support, terms, type Doc } from "@/lib/pages-copy";
import { DocBody } from "@/components/rich";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="rise flex flex-col gap-4 pt-6 text-[15px] leading-relaxed [&_h2]:mt-4 [&_h2]:border-t [&_h2]:border-line [&_h2]:pt-6 [&_h2]:text-lg [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-muted [&_code]:rounded-md [&_code]:bg-bg-2 [&_code]:px-1.5 [&_code]:text-[0.9em] [&_a]:font-medium [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2">
      <h1 className="k-serif text-[2.2rem] leading-tight">{title}</h1>
      <p className="k-kicker -mt-1">Last updated {updated}</p>
      {children}
    </article>
  );
}

const DocPage = ({ doc, children }: { doc: Doc; children?: React.ReactNode }) => (
  <LegalPage title={doc.title} updated={doc.updated}>
    <DocBody doc={doc} />
    {children}
  </LegalPage>
);

export function SupportPage({ neutral = false }: { neutral?: boolean }) {
  const link = "inline-flex min-h-11 min-w-11 items-center justify-center";
  return (
    <DocPage doc={support(neutral)}>
      <p className="text-sm text-muted">
        <Link href={pagePath(neutral, "/terms")} className={link}>Terms</Link> · <Link href={pagePath(neutral, "/privacy")} className={link}>Privacy</Link>
      </p>
    </DocPage>
  );
}

export const PrivacyPage = ({ neutral = false }: { neutral?: boolean }) => <DocPage doc={privacy(neutral)} />;
export const TermsPage = ({ neutral = false }: { neutral?: boolean }) => <DocPage doc={terms(neutral)} />;
