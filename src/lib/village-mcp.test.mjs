// Run: npm test. Agent Village end to end on a real Postgres (PGlite, in memory) with db/schema.sql applied:
// the partner HTTP API (/api/village/<op>) with X-Village-Subject or residentId, and the same ops as
// authenticated MCP tools on /mcp (app token + X-Village-Subject), through the real route handlers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
const KEY = (process.env.VILLAGE_PARTNER_KEY = "test-partner-key-0123456789abcdef0123456789");
const village = await import("../app/api/village/[op]/route.ts");
const mcp = await import("../app/mcp/route.ts");
const { residentKey } = await import("./village.ts");
const { notSignedUpText } = await import("./chat.ts");

const answers = (name, extra = {}) => ({
  name, status: "single", lookingFor: ["friends", "collaborators"], interests: ["AI", "Music", "Books"],
  about: `${name} builds small AI tools.`, telegram: `${name.toLowerCase()}_tg`, agreedToTerms: true, ageConfirmed: true, ...extra,
});
const headersFor = ({ subject, key = KEY } = {}) => ({
  "content-type": "application/json",
  ...(key === null ? {} : { authorization: `Bearer ${key}` }),
  ...(subject === undefined ? {} : { "x-village-subject": subject }),
});
async function http(op, body, opts) {
  const res = await village.POST(
    new Request(`https://kismet.test/api/village/${op}`, { method: "POST", headers: headersFor(opts), body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ op }) });
  return { status: res.status, body: await res.json() };
}
async function rpc(method, params, opts) {
  const res = await mcp.POST(new Request("https://kismet.test/mcp", { method: "POST", headers: headersFor(opts), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) }));
  return res.json();
}
const tool = async (name, args, opts) => (await rpc("tools/call", { name, ...(args === undefined ? {} : { arguments: args }) }, opts)).result;
const accounts = async (rid) => (await pg.query("select id from users where village_resident = $1", [residentKey(rid)])).rows;
const idOf = async (rid) => (await accounts(rid))[0].id;
const verdict = JSON.stringify({ score: 8, meet: true, reason: "You both build AI tools.", bestLine: "Chai and a demo?", suggestedMeetup: "Chai at The Circle" });
/** A finished date where both agents recommend meeting (replacing one sign-up may have started for the pair). */
async function finishedDate(a, b) {
  const pair = [a, b].sort().join(":");
  await pg.query("delete from dates where pair_key = $1", [pair]);
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now()) returning id`, [pair, a, b, verdict]);
  return rows[0].id;
}
const resident = (subject) => ({ subject });

test("HTTP: X-Village-Subject and body residentId are the same resident (same hash, one account)", async () => {
  const s = await http("signup", { answers: answers("Hana") }, resident("res-h"));
  assert.deepEqual([s.status, s.body.created], [201, true]);
  assert.equal((await accounts("res-h")).length, 1);
  const again = await http("signup", { residentId: "res-h", answers: answers("Hana", { about: "Changed via body." }) });
  assert.deepEqual([again.status, again.body.created], [200, false]);
  assert.equal((await accounts("res-h")).length, 1);
  const viaHeader = await http("summary", {}, resident("res-h"));
  const viaBody = await http("summary", { residentId: "res-h" });
  const both = await http("summary", { residentId: "res-h" }, resident("res-h"));
  const empty = await http("summary", "", resident("res-h")); // the header alone: an empty body is fine
  for (const r of [viaHeader, viaBody, both, empty]) assert.equal(r.status, 200);
  assert.equal(viaHeader.body.summary.profile.bio, "Changed via body.");
  assert.deepEqual(viaHeader.body, viaBody.body);
  assert.deepEqual(empty.body, viaBody.body);
  assert.equal((await http("summary", "")).body.error, "invalid_json"); // without the header the body is still required
});

test("HTTP: a header and body residentId that differ are refused; a bad subject is a 400; auth comes first", async () => {
  const before = (await pg.query("select count(*)::int as n from users")).rows[0].n;
  const m = await http("signup", { residentId: "res-other", answers: answers("Ivo") }, resident("res-i"));
  assert.deepEqual([m.status, m.body.ok, m.body.error], [400, false, "subject_mismatch"]);
  assert.equal((await http("delete", { residentId: "res-h" }, resident("res-i"))).body.error, "subject_mismatch");
  assert.equal((await accounts("res-h")).length, 1, "the mismatch deleted nothing");
  for (const bad of ["", "a b", "-x", "a".repeat(129)]) {
    const r = await http("summary", {}, resident(bad));
    assert.deepEqual([r.status, r.body.error], [400, "invalid_request"], JSON.stringify(bad));
  }
  assert.equal((await http("summary", {}, { subject: "res-h", key: "wrong" })).status, 401);
  assert.equal((await http("summary", {}, { subject: "res-h", key: null })).status, 401);
  assert.equal((await pg.query("select count(*)::int as n from users")).rows[0].n, before);
});

test("MCP tools/list: the 3 public tools without the app token and subject; the kismet_* tools with them", async () => {
  const names = async (opts) => (await rpc("tools/list", undefined, opts)).result.tools.map((t) => t.name);
  const pub = ["how_it_works", "village_stats", "public_board"];
  const pubJson = JSON.stringify(await rpc("tools/list", undefined, { key: null }));
  for (const opts of [{ key: null }, { key: null, subject: "res-h" }, { subject: "res-h", key: "wrong" }, { key: KEY }]) {
    assert.deepEqual(await names(opts), pub, JSON.stringify(opts));
    assert.equal(JSON.stringify(await rpc("tools/list", undefined, opts)), pubJson);
  }
  assert.deepEqual(await names(resident("res-h")), [...pub, "kismet_signup", "kismet_summary", "kismet_go", "kismet_decide", "kismet_notes", "kismet_delete"]);
  // Public tools answer byte-for-byte the same with or without a resident.
  for (const name of pub) assert.equal(JSON.stringify(await tool(name, {}, resident("res-h"))), JSON.stringify(await tool(name, {}, { key: null })));
});

test("MCP kismet_signup, kismet_summary: the HTTP body as structuredContent, its text as content", async () => {
  const s = await tool("kismet_signup", { answers: answers("Juno"), notes: ["Plays chess at sunrise"] }, resident("res-j"));
  assert.equal(s.isError, undefined);
  assert.deepEqual([s.structuredContent.ok, s.structuredContent.created], [true, true]);
  assert.equal(s.content[0].text, s.structuredContent.text);
  assert.deepEqual(JSON.parse(s.content[1].text), s.structuredContent);
  assert.equal((await accounts("res-j")).length, 1);
  // The pairing's Telegram username, as on the HTTP API, when the answers have none.
  const noTelegram = answers("Nia");
  delete noTelegram.telegram;
  const t = await tool("kismet_signup", { answers: noTelegram, telegram: "nia_pairing" }, resident("res-n"));
  assert.equal(t.structuredContent.created, true);
  assert.equal((await tool("kismet_summary", {}, resident("res-n"))).structuredContent.summary.profile.telegram, "nia_pairing");
  const again = await tool("kismet_signup", { answers: answers("Juno") }, resident("res-j"));
  assert.equal(again.structuredContent.created, false);
  // Same account through either door: the MCP summary is the HTTP summary.
  const sum = await tool("kismet_summary", undefined, resident("res-j"));
  assert.equal(sum.isError, undefined);
  assert.equal(sum.content[0].text, sum.structuredContent.text);
  assert.deepEqual(sum.structuredContent, (await http("summary", {}, resident("res-j"))).body);
  assert.equal(sum.structuredContent.summary.profile.name, "Juno");
  const bad = await tool("kismet_signup", { answers: answers("Juno", { ageConfirmed: false }) }, resident("res-j2"));
  assert.deepEqual([bad.isError, bad.structuredContent.error], [true, "invalid_answers"]);
  assert.equal((await accounts("res-j2")).length, 0);
});

test("MCP kismet_go and kismet_notes", async () => {
  const go = await tool("kismet_go", {}, resident("res-j"));
  assert.equal(go.isError, undefined);
  assert.equal(go.structuredContent.ok, true);
  assert.equal(typeof go.structuredContent.started, "number");
  assert.equal(go.content[0].text, go.structuredContent.text);
  const listed = await tool("kismet_notes", {}, resident("res-j"));
  assert.deepEqual(listed.structuredContent.notes.map((n) => n.text), ["Plays chess at sunrise"]);
  const added = await tool("kismet_notes", { add: ["Vegetarian"] }, resident("res-j"));
  assert.equal(added.structuredContent.notes.length, 2);
  assert.equal(added.content[0].text, added.structuredContent.text);
  const missing = await tool("kismet_notes", { deleteId: "00000000-0000-4000-8000-000000000000" }, resident("res-j"));
  assert.deepEqual([missing.isError, missing.structuredContent.error], [true, "note_not_found"]);
  const cleared = await tool("kismet_notes", { deleteAll: true }, resident("res-j"));
  assert.deepEqual(cleared.structuredContent.notes, []);
});

test("MCP kismet_decide: the resident's own answer; never for another resident's date", async () => {
  await tool("kismet_signup", { answers: answers("Kai") }, resident("res-k"));
  await tool("kismet_signup", { answers: answers("Lea") }, resident("res-l"));
  const [j, k, l] = [await idOf("res-j"), await idOf("res-k"), await idOf("res-l")];
  const jk = await finishedDate(j, k);
  const kl = await finishedDate(k, l);
  // Juno is not on Kai and Lea's date: one "not found" answer, nothing recorded (MCP and HTTP alike).
  for (const decision of ["meet", "pass"]) {
    const r = await tool("kismet_decide", { dateId: kl, decision }, resident("res-j"));
    assert.deepEqual([r.isError, r.structuredContent.error], [true, "date_not_found"]);
  }
  assert.equal((await http("decide", { dateId: kl, decision: "pass" }, resident("res-j"))).status, 404);
  const unknown = await tool("kismet_decide", { dateId: "00000000-0000-4000-8000-000000000000", decision: "meet" }, resident("res-j"));
  assert.deepEqual(unknown.structuredContent, (await tool("kismet_decide", { dateId: kl, decision: "meet" }, resident("res-j"))).structuredContent);
  const kl0 = (await pg.query("select decision_a, decision_b, matched_at from dates where id = $1", [kl])).rows[0];
  assert.deepEqual([kl0.decision_a, kl0.decision_b, kl0.matched_at], [null, null, null]);
  // Their own date: recorded; a mutual meet is a match.
  const first = await tool("kismet_decide", { dateId: jk, decision: "meet" }, resident("res-j"));
  assert.equal(first.isError, undefined);
  assert.deepEqual([first.structuredContent.ok, first.structuredContent.decision, first.structuredContent.match], [true, "meet", false]);
  assert.equal(first.content[0].text, first.structuredContent.text);
  const second = await tool("kismet_decide", { dateId: jk, decision: "meet" }, resident("res-k"));
  assert.equal(second.structuredContent.match, true);
});

test("MCP: not_signed_up for every op but signup and delete; unauthorized never runs anything", async () => {
  const dateId = "00000000-0000-4000-8000-000000000000";
  for (const [name, args] of [["kismet_summary", {}], ["kismet_go", {}], ["kismet_decide", { dateId, decision: "meet" }], ["kismet_notes", {}]]) {
    const r = await tool(name, args, resident("res-ghost"));
    assert.deepEqual([r.isError, r.structuredContent.ok, r.structuredContent.error], [true, false, "not_signed_up"], name);
    assert.equal(r.content[0].text, notSignedUpText);
    assert.equal(typeof r.structuredContent.message, "string");
  }
  const gone = await tool("kismet_delete", {}, resident("res-ghost"));
  assert.deepEqual([gone.isError, gone.structuredContent.deleted], [undefined, false]);
  // No token, a wrong token, or no subject: an isError result and no account touched or created.
  const before = (await pg.query("select count(*)::int as n from users")).rows[0].n;
  for (const opts of [{ key: null, subject: "res-j" }, { key: "wrong-key", subject: "res-j" }, { key: KEY }]) {
    for (const [name, args] of [["kismet_signup", { answers: answers("Mia") }], ["kismet_summary", {}], ["kismet_go", {}],
      ["kismet_decide", { dateId, decision: "pass" }], ["kismet_notes", { deleteAll: true }], ["kismet_delete", {}]]) {
      const r = await tool(name, args, opts);
      assert.equal(r.isError, true, `${name} ${JSON.stringify(opts)}`);
      assert.deepEqual(Object.keys(r.structuredContent), ["ok", "error", "message"]);
      assert.equal(r.structuredContent.error, opts.key === KEY ? "missing_subject" : "unauthorized");
      assert.doesNotMatch(JSON.stringify(r), /Juno|juno_tg/);
    }
  }
  assert.equal((await pg.query("select count(*)::int as n from users")).rows[0].n, before);
  assert.equal((await accounts("res-j")).length, 1);
});

test("MCP and HTTP share the rate limits", async () => {
  await pg.query("insert into rate_limits (key, count, expires_at) values ($1, 120, now() + interval '1 hour')", [`village-summary:${residentKey("res-l")}`]);
  const r = await tool("kismet_summary", {}, resident("res-l"));
  assert.deepEqual([r.isError, r.structuredContent.error], [true, "rate_limited"]);
  assert.equal((await http("summary", {}, resident("res-l"))).status, 429);
});

test("MCP kismet_delete: deletes this resident only", async () => {
  const r = await tool("kismet_delete", {}, resident("res-j"));
  assert.deepEqual([r.isError, r.structuredContent.deleted], [undefined, true]);
  assert.equal(r.content[0].text, r.structuredContent.text);
  assert.equal((await accounts("res-j")).length, 0);
  assert.equal((await accounts("res-k")).length, 1);
  assert.equal((await tool("kismet_summary", {}, resident("res-j"))).structuredContent.error, "not_signed_up");
  assert.equal((await http("summary", { residentId: "res-j" })).status, 404);
});
