import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "@/lib/db";
import { clientConfig, parseCode, signalFor, worldConfig } from "@/lib/world";
import { WorldVerify } from "@/components/world-verify";

// One-time World ID verify link (/verify/<code>): tied to one account, expires within 15 minutes, single use.
// The code is in the URL, so no referrer leaves this page.
export const metadata: Metadata = { title: "Verify with World ID", referrer: "no-referrer", robots: { index: false, follow: false } };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rise flex flex-col gap-4 pt-10 text-center">
      <h1 className="k-serif text-[2.2rem] leading-tight">{title}</h1>
      <p className="text-muted">{body}</p>
      <Link href="/home" className="btn btn-ghost w-full">Go to my intros</Link>
    </div>
  );
}

const NEW_LINK = "Ask your agent for a new verify link, or open your Kismet home and tap \"Get verified\".";

export default async function VerifyPage({ params }: PageProps<"/verify/[code]">) {
  const { code } = await params;
  const c = worldConfig();
  if (!c) return <Notice title="Not available" body="World ID verification isn't available right now." />;
  const parsed = parseCode(c, code);
  if ("error" in parsed) {
    return <Notice title={parsed.error === "expired" ? "This link expired" : "This link doesn't work"} body={NEW_LINK} />;
  }
  const [[u], [used]] = await Promise.all([
    sql`select name, world_verified_at from users where id = ${parsed.userId}`,
    sql`select 1 as used from world_codes_used where code_hash = ${parsed.codeHash}`,
  ]);
  if (!u) return <Notice title="This link doesn't work" body={NEW_LINK} />;
  if (u.world_verified_at) return <Notice title="You're already verified ✓" body="Your matches see your World ID verified badge." />;
  if (used) return <Notice title="This link was already used" body={NEW_LINK} />;
  return <WorldVerify code={code} name={u.name as string} signal={signalFor(parsed.userId)} config={clientConfig(c)} />;
}
