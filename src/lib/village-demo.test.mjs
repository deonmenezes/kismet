// Run: npm test. Agent Village (the partner HTTP API and the kismet_* MCP tools, lib/village-ops.ts) and the fixes
// that live below the ops, end to end on a real Postgres (PGlite, in memory) through the real route handlers:
// demo isolation (lib/demo.ts) holds for partner sign-ups, and stale ids answer as on the other doors.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

process.env.DEMO_SIGNUP_KEY = "test-demo-key-0123456789abcdef";
const KEY = (process.env.VILLAGE_PARTNER_KEY = "test-partner-key-0123456789abcdef0123456789");
const pg = await freshDb();
const village = await import("../app/api/village/[op]/route.ts");
const mcp = await import("../app/mcp/route.ts");
const { residentKey } = await import("./village.ts");
const { insertUser, deleteUser } = await import("./actions.ts");
const { visibleOthers } = await import("./db.ts");
const { parseProfile } = await import("./validate.ts");

const WEB = { channel: "web", client: "" };
const INTERESTS = ["AI", "Music", "Books"];
const answers = (name, telegram, extra = {}) => ({
  name, telegram, status: "single", lookingFor: ["friends"], interests: INTERESTS, about: `${name} builds small AI tools.`,
  agreedToTerms: true, ageConfirmed: true, ...extra,
});
// The demo key header too: it means nothing on the partner doors (only /api/signup reads it).
const headersFor = (subject) => ({ "content-type": "application/json", authorization: `Bearer ${KEY}`, "x-village-subject": subject, "x-kismet-demo-key": process.env.DEMO_SIGNUP_KEY });
async function http(op, body, subject) {
  const res = await village.POST(new Request(`https://kismet.test/api/village/${op}`, { method: "POST", headers: headersFor(subject), body: JSON.stringify(body) }),
    { params: Promise.resolve({ op }) });
  return { status: res.status, body: await res.json() };
}
async function tool(name, args, subject) {
  const res = await mcp.POST(new Request("https://kismet.test/mcp", { method: "POST", headers: headersFor(subject),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  return (await res.json()).result;
}
async function person(name, telegram, demo = false) {
  const r = parseProfile({ name, telegram, lookingFor: ["friends"], interests: INTERESTS, edgeCity: true });
  assert.ok(r.profile, r.error);
  return (await insertUser(r.profile, WEB, null, [], null, { demo })).id;
}
const residentRow = async (rid) => (await pg.query("select id, is_demo from users where village_resident = $1", [residentKey(rid)])).rows[0];
const verdict = JSON.stringify({ score: 8, meet: true, reason: "You both build AI tools.", bestLine: "Chai and a demo?", suggestedMeetup: "Chai at The Circle" });
async function finishedDate(a, b) {
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now()) returning id`, [[a, b].sort().join(":"), a, b, verdict]);
  return rows[0].id;
}
/** Every date of `id` is with someone on the same side of the demo line. */
async function sameSideOnly(id) {
  const { rows } = await pg.query(`select ua.is_demo as a, ub.is_demo as b from dates d join users ua on ua.id = d.a_id join users ub on ub.id = d.b_id
    where $1 in (d.a_id, d.b_id)`, [id]);
  for (const r of rows) assert.equal(r.a, r.b, "never a demo account with a real resident");
  return rows.length;
}

// A real resident (John, on the web) and App Review's demo accounts Sam and Maya.
const john = await person("John", "john_real");
const sam = await person("Sam (demo)", "kismet_review_demo", true);
const maya = await person("Maya (demo)", "maya_demo_kismet", true);

afterEach(() => pg.exec("delete from dates; delete from rate_limits; delete from date_log; delete from users where village_resident is not null;"));

test("partner sign-ups (MCP and HTTP) refuse App Review's demo name and handle, even with the demo key; never demo accounts", async () => {
  // A demo name and handle: refused (400 invalid_answers, a friendly text), no account made.
  const viaMcp = await tool("kismet_signup", { answers: answers("Sam (demo)", "kismet_review_demo") }, "res-imp-1");
  assert.deepEqual([viaMcp.isError, viaMcp.structuredContent.error], [true, "invalid_answers"]);
  assert.match(viaMcp.structuredContent.message, /reserved for Kismet's demo accounts/);
  const viaHttp = await http("signup", { answers: answers("Maya (demo)", "maya_demo_kismet") }, "res-imp-2");
  assert.deepEqual([viaHttp.status, viaHttp.body.error], [400, "invalid_answers"]);
  assert.match(viaHttp.body.text, /Please use your own/);
  for (const rid of ["res-imp-1", "res-imp-2"]) assert.equal(await residentRow(rid), undefined, rid);
  // Either half alone is reserved too (QA2 N-L3), in any case or spacing: a "(demo)" name with a real handle, or a demo
  // handle with a real name.
  const half1 = await tool("kismet_signup", { answers: answers("Sam (Demo)", "sam_real_tg") }, "res-imp-1");
  assert.deepEqual([half1.isError, half1.structuredContent.error], [true, "invalid_answers"]);
  assert.equal((await http("signup", { answers: answers("Maya", "MAYA_DEMO_KISMET") }, "res-imp-2")).status, 400);
  assert.equal((await http("signup", { answers: answers("Sam\u00a0(demo)", "KISMET_REVIEW_DEMO") }, "res-imp-2")).status, 400);
  // Real names and handles sign up.
  assert.equal((await tool("kismet_signup", { answers: answers("Sam", "sam_real_tg") }, "res-imp-1")).structuredContent.created, true);
  assert.equal((await http("signup", { answers: answers("Maya", "maya_real_tg") }, "res-imp-2")).status, 201);
  for (const rid of ["res-imp-1", "res-imp-2"]) {
    const r = await residentRow(rid);
    assert.equal(r.is_demo, false, rid);
    // Its first dates (started at sign-up) and its pool are real residents only: never App Review's accounts.
    assert.ok((await sameSideOnly(r.id)) > 0, "it still dates real residents");
    const pool = (await visibleOthers(r.id)).map((u) => u.id);
    assert.ok(pool.includes(john) && !pool.includes(sam) && !pool.includes(maya));
  }
  // A repeat sign-up (an update) to a demo name and handle is refused too, and changes nothing.
  const up1 = await tool("kismet_signup", { answers: answers("Leo (demo)", "leo_demo_kismet") }, "res-imp-1");
  assert.deepEqual([up1.isError, up1.structuredContent.error], [true, "invalid_answers"]);
  assert.equal((await http("signup", { answers: answers("Zara (demo)", "zara_demo_kismet") }, "res-imp-2")).status, 400);
  const names = (await pg.query("select name, telegram, is_demo from users where village_resident is not null order by name")).rows;
  assert.deepEqual(names.map((r) => [r.name, r.telegram, r.is_demo]), [["Maya", "maya_real_tg", false], ["Sam", "sam_real_tg", false]]);
  // And the demo accounts still only ever see each other.
  assert.deepEqual((await visibleOthers(sam)).map((u) => u.id), [maya]);
});

test("a village resident never dates or is shown a demo account through kismet_go / go / summary", async () => {
  await tool("kismet_signup", { answers: answers("Hana", "hana_tg") }, "res-hana");
  const hana = (await residentRow("res-hana")).id;
  // Asked for by id: no date with a demo account, through either door.
  const g1 = await tool("kismet_go", { targetId: sam }, "res-hana");
  assert.deepEqual([g1.isError, g1.structuredContent.started], [undefined, 0]);
  const g2 = await http("go", { targetId: maya }, "res-hana");
  assert.deepEqual([g2.status, g2.body.started], [200, 0]);
  await tool("kismet_go", {}, "res-hana");
  await sameSideOnly(hana);
  const n = (await pg.query("select count(*)::int as n from dates where $1 in (a_id, b_id) and ($2 in (a_id, b_id) or $3 in (a_id, b_id))", [hana, sam, maya])).rows[0].n;
  assert.equal(n, 0);
  const sum = await tool("kismet_summary", {}, "res-hana");
  assert.doesNotMatch(JSON.stringify(sum), new RegExp(`\\(demo\\)|${sam}|${maya}`));
});

test("an old demo <-> village date is never shown or decided (MCP and HTTP); a real one is", async () => {
  await tool("kismet_signup", { answers: answers("Ivo", "ivo_tg") }, "res-ivo");
  const ivo = (await residentRow("res-ivo")).id;
  await pg.query("delete from dates");
  const cross = await finishedDate(sam, ivo);
  const real = await finishedDate(john, ivo);
  const sum = (await tool("kismet_summary", {}, "res-ivo")).structuredContent.summary;
  assert.deepEqual(sum.recommendations.map((r) => r.dateId), [real]);
  assert.doesNotMatch(JSON.stringify(sum), new RegExp(`\\(demo\\)|${cross}|${sam}`));
  const viaMcp = await tool("kismet_decide", { dateId: cross, decision: "meet" }, "res-ivo");
  assert.deepEqual([viaMcp.isError, viaMcp.structuredContent.error], [true, "date_not_found"]);
  assert.equal((await http("decide", { dateId: cross, decision: "meet" }, "res-ivo")).status, 404);
  const row = (await pg.query("select decision_a, decision_b, matched_at from dates where id = $1", [cross])).rows[0];
  assert.deepEqual([row.decision_a, row.decision_b, row.matched_at], [null, null, null]);
  const ok = await tool("kismet_decide", { dateId: real, decision: "meet" }, "res-ivo");
  assert.deepEqual([ok.isError, ok.structuredContent.decision], [undefined, "meet"]);
});

test("stale ids: a date whose other side left, or a target who left, answers like an unknown id", async () => {
  await tool("kismet_signup", { answers: answers("Juno", "juno_tg") }, "res-juno");
  const juno = (await residentRow("res-juno")).id;
  const leaver = await person("Kai", "kai_real");
  await pg.query("delete from dates");
  const dateId = await finishedDate(leaver, juno);
  await deleteUser(leaver, WEB);
  const unknown = await tool("kismet_decide", { dateId: "00000000-0000-4000-8000-000000000000", decision: "meet" }, "res-juno");
  const stale = await tool("kismet_decide", { dateId, decision: "meet" }, "res-juno");
  assert.deepEqual([stale.isError, stale.structuredContent], [true, unknown.structuredContent]);
  assert.equal((await http("decide", { dateId, decision: "pass" }, "res-juno")).status, 404);
  const go = await tool("kismet_go", { targetId: leaver }, "res-juno");
  assert.deepEqual([go.isError, go.structuredContent.started], [undefined, 0]);
  assert.equal((await pg.query("select count(*)::int as n from dates where $1 in (a_id, b_id)", [leaver])).rows[0].n, 0);
});
