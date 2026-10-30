// Run: npm test. The public read-only endpoints (/mcp, /api/public/stats, /api/public/board) on a real Postgres (PGlite,
// in memory): each call runs database queries, so each network gets PUBLIC_PER_MINUTE calls a minute, then 429.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

await freshDb();
const { PUBLIC_PER_MINUTE } = await import("./auth.ts");
const stats = await import("../app/api/public/stats/route.ts");
const board = await import("../app/api/public/board/route.ts");
const mcp = await import("../app/mcp/route.ts");

const from = (ip, url = "https://kismet.test/api/public/stats", init = {}) => new Request(url, { ...init, headers: { "x-real-ip": ip, ...init.headers } });
const rpc = (ip) => from(ip, "https://kismet.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });

test("each public endpoint: PUBLIC_PER_MINUTE calls a minute per network, then 429; other networks unaffected", async () => {
  for (const [name, call] of [["stats", (ip) => stats.GET(from(ip))], ["board", (ip) => board.GET(from(ip, "https://kismet.test/api/public/board"))], ["mcp", (ip) => mcp.POST(rpc(ip))]]) {
    for (let i = 0; i < PUBLIC_PER_MINUTE; i++) assert.equal((await call("203.0.113.7")).status, 200, `${name} #${i + 1}`);
    const over = await call("203.0.113.7");
    assert.equal(over.status, 429, name);
    if (name === "mcp") assert.equal((await over.json()).error.code, -32000);
    assert.equal((await call("198.51.100.9")).status, 200, `${name}: another network`);
  }
});

test("/mcp: Agent Village's calls (a valid partner bearer) are never limited per network; anyone else's are", async () => {
  const key = (process.env.VILLAGE_PARTNER_KEY = "test-partner-key-0123456789abcdef0123456789");
  const call = (ip, headers = {}, method = "tools/list") => mcp.POST(from(ip, "https://kismet.test/mcp", { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) }));
  const ip = "192.0.2.44"; // Agent Village's one app server, also used by an anonymous caller
  const partner = { authorization: `Bearer ${key}` };
  const resident = { ...partner, "x-village-subject": "res-limit" };
  for (let i = 0; i < PUBLIC_PER_MINUTE; i++) assert.equal((await call(ip)).status, 200, `anonymous #${i + 1}`);
  assert.equal((await call(ip)).status, 429, "anonymous callers: the per-network limit");
  for (const headers of [{ authorization: "Bearer wrong-key" }, { authorization: "Bearer" }]) assert.equal((await call(ip, headers)).status, 429, "an invalid bearer is anonymous");
  // Well over the network's limit, from the same network: the partner bearer, with or without a resident.
  for (let i = 0; i < PUBLIC_PER_MINUTE + 10; i++) {
    for (const headers of [partner, resident]) assert.equal((await call(ip, headers)).status, 200, `partner #${i + 1}`);
  }
  const r = await (await call(ip, resident, "tools/list")).json();
  assert.ok(r.result.tools.some((t) => t.name === "kismet_summary"));
  // Partner calls aren't counted against their network either: anonymous callers there still get their full minute.
  const shared = "192.0.2.45";
  for (let i = 0; i < PUBLIC_PER_MINUTE + 10; i++) assert.equal((await call(shared, partner)).status, 200);
  for (let i = 0; i < PUBLIC_PER_MINUTE; i++) assert.equal((await call(shared)).status, 200, `anonymous after partner #${i + 1}`);
  assert.equal((await call(shared)).status, 429);
  // The partner path keeps its per-resident limits (lib/village-ops.ts), from any network.
  const { residentKey } = await import("./village.ts");
  const { sql } = await import("./db.ts");
  await sql`insert into rate_limits (key, count, expires_at) values (${`village-summary:${residentKey("res-limit")}`}, 1000, now() + interval '1 hour')`;
  const signup = await (await mcp.POST(from(ip, "https://kismet.test/mcp", { method: "POST", headers: { "content-type": "application/json", ...resident },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "kismet_signup", arguments: { answers: {
      name: "Lim", lookingFor: ["friends"], interests: ["AI", "Music", "Books"], telegram: "lim_tg", agreedToTerms: true, ageConfirmed: true } } } }) }))).json();
  assert.equal(signup.result.structuredContent.ok, true);
  const summary = await (await mcp.POST(from(ip, "https://kismet.test/mcp", { method: "POST", headers: { "content-type": "application/json", ...resident },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "kismet_summary", arguments: {} } }) }))).json();
  assert.deepEqual([summary.result.isError, summary.result.structuredContent.error], [true, "rate_limited"]);
  // No key configured on our side: no bearer is valid, so everything is per network.
  delete process.env.VILLAGE_PARTNER_KEY;
  assert.equal((await call(ip, partner)).status, 429);
});
