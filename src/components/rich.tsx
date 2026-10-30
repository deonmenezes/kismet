import { Fragment } from "react";
import Link from "next/link";
import { parseRich, type Doc } from "@/lib/pages-copy";

/** The inline markup of lib/pages-copy.ts: [label](href) and `code`. */
export function Rich({ text }: { text: string }) {
  return parseRich(text).map((x, n) =>
    typeof x === "string" ? x
      : "code" in x ? <code key={n}>{x.code}</code>
      : /^(mailto:|https?:)/.test(x.href) ? <a key={n} href={x.href}>{x.label}</a>
      : <Link key={n} href={x.href}>{x.label}</Link>);
}

/** The blocks of a page (inside components/legal.tsx LegalPage). */
export function DocBody({ doc }: { doc: Doc }) {
  return doc.blocks.map((b, n) => (
    <Fragment key={n}>
      {"p" in b && <p><Rich text={b.p} /></p>}
      {"h2" in b && <h2>{b.h2}</h2>}
      {"ul" in b && <ul>{b.ul.map((li, k) => <li key={k}><Rich text={li} /></li>)}</ul>}
      {"faq" in b && b.faq.map(([q, a]) => (
        <div key={q}>
          <p className="font-bold">{q}</p>
          <p><Rich text={a} /></p>
        </div>
      ))}
    </Fragment>
  ));
}
