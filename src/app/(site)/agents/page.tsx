import type { Metadata } from "next";
import { SITE } from "@/lib/copy";
import { agentScript } from "@/lib/agent-script";
import { worldConfig } from "@/lib/world";

export const metadata: Metadata = { title: "For agents", alternates: { canonical: "/agents" } };
// The script states the real next drop (lib/drop.ts dropSchedule): rendered per request (every page is, for its CSP
// nonce: app/layout.tsx), never frozen at build time (a page built on Thursday must not promise Friday's drop on Saturday).

export default function Agents() {
  return (
    <div className="flex flex-col gap-5 pt-6">
      <section className="rise">
        <p className="k-kicker">For your agent</p>
        <h1 className="k-serif mt-1 text-[2.2rem] leading-tight">Sign up from chat</h1>
        <p className="mt-2 text-muted">
          Ask your own AI agent (ChatGPT, Claude or another): <b className="text-ink">&ldquo;Read {SITE}/llms.txt and sign me up for Kismet.&rdquo;</b>{" "}
          It asks you a few questions, one at a time, shows you your answers and signs you up through Kismet&apos;s API once you say yes.
          It acts only when you ask, and never fills in the web quiz for you (that one is yours, at <a href="/join" className="underline">/join</a>).
          In Agent Village, install the Kismet mini-app (Mini-apps, then Kismet, then Install) and ask your agent. This is the script your agent follows.
        </p>
      </section>
      <section className="rise rounded-3xl border border-line bg-card p-4 text-sm">
        <p className="font-bold">Building an app?</p>
        <p className="mt-1 text-muted">
          Use the same Bearer token as agents (no cookies, no CORS needed from native apps). Exact shapes are in{" "}
          <a href="/llms-full.txt" className="underline">/llms-full.txt</a>.
        </p>
        <ul className="mt-2 list-disc pl-5 font-mono text-xs leading-relaxed">
          <li>POST /api/signup · GET /api/me?full=1 · PATCH|DELETE /api/me</li>
          <li>POST /api/me/dates · GET /api/me/summary?since= · POST /api/me/decide</li>
          <li>GET|POST|DELETE /api/me/photo · GET /api/photos/:id (Bearer)</li>
          <li>GET /api/me/inbox · GET|POST /api/me/matches/:matchId/messages?after= · POST /api/me/matches/:matchId/unmatch</li>
          <li>POST /api/me/report · POST|DELETE /api/me/block · GET /api/me/blocks</li>
        </ul>
      </section>
      <pre className="rise whitespace-pre-wrap break-words rounded-2xl bg-ink p-4 text-xs leading-relaxed text-bg">
        {agentScript(SITE, { worldId: Boolean(worldConfig()) })}
      </pre>
    </div>
  );
}
