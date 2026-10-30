import { boardQuotes, stats } from "@/lib/db";
import { howItWorks } from "@/lib/copy";
import { dropSchedule } from "@/lib/drop";
import { handleMessage, type RunTool } from "@/lib/mcp";
import { publicAllowed } from "@/lib/auth";
import { partnerCaller } from "@/lib/mcp-partner";
import { partnerAuth, SUBJECT_HEADER } from "@/lib/village";
import { runVillageOp } from "@/lib/village-ops";

// Public, read-only MCP server (Streamable HTTP, stateless): no user data, no writes, no caller identity,
// limited per network (lib/auth.ts publicAllowed). Agent Village's app token (the partner bearer) is exempt from
// that limit and, with X-Village-Subject, adds the kismet_* tools for that one resident: the same ops, writes and
// per-resident limits as /api/village/<op> (lib/village-ops.ts).
// Answers as SSE when the client accepts it (like the MCP SDKs), else as plain JSON.
export const maxDuration = 60;

const run: RunTool = async (name, args) => {
  if (name === "how_it_works") return howItWorks(dropSchedule()); // the real next drop, or none left
  if (name === "village_stats") {
    const { agents, dates, matches } = await stats(); // the reviewed counters only
    return { agents, dates, matches };
  }
  return { quotes: await boardQuotes(args.limit ?? 10) };
};

const headers = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization");
  const key = process.env.VILLAGE_PARTNER_KEY;
  // The per-network limit is for everyone but Agent Village: its calls (a valid partner bearer) all come from one
  // app server, so they keep the per-resident limits of the ops instead (lib/village-ops.ts).
  const partner = authorization !== null && partnerAuth(authorization, key) === "ok";
  if (!partner && !(await publicAllowed(req, "mcp"))) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests: try again in a minute" } }, { status: 429, headers: { ...headers, "retry-after": "60" } });
  }
  const raw = await req.text();
  if (raw.length > 65_536) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413, headers });
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers });
  }
  const caller = partnerCaller(authorization, req.headers.get(SUBJECT_HEADER), key, runVillageOp);
  const reply = await handleMessage(msg, run, caller);
  if (!reply) return new Response(null, { status: 202, headers });
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) {
    return new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, {
      headers: { ...headers, "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
    });
  }
  return Response.json(reply, { headers });
}

// Stateless: no server-initiated stream and no session to end.
const notAllowed = () => new Response("Method Not Allowed", { status: 405, headers: { ...headers, allow: "POST" } });
export { notAllowed as GET, notAllowed as DELETE };
