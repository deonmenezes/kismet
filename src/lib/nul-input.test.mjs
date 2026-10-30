// Run: npm test. Control characters in free text (QA2 N-M1): a NUL (U+0000, which Postgres refuses in text) or any
// other control character in a name, bio, interest, note or report is stripped, never a 500, on every door: /api/signup,
// PATCH /api/me, POST /api/me/notes, /api/village/<op> and the kismet_* MCP tools (an input error there, never
// "temporarily unavailable"). Sign-up checks the report history before anything else, and a sign-up that fails half
// way leaves no account behind (a retry would otherwise be an update that skips the check). Real Postgres (PGlite).
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

process.env.SAFETY_HASH_KEY = "test-safety-hash-key-0123456789abcdef";
const KEY = (process.env.VILLAGE_PARTNER_KEY = "test-partner-key-0123456789abcdef0123456789");
const pg = await freshDb();
const signup = await import("../app/api/signup/route.ts");
const meRoute = await import("../app/api/me/route.ts");
const notesRoute = await import("../app/api/me/notes/route.ts");
const village = await import("../app/api/village/[op]/route.ts");
const mcp = await import("../app/mcp/route.ts");
const { insertUser, deleteUser } = await import("./actions.ts");
const { parseProfile } = await import("./validate.ts");
const { parseNotes } = await import("./client.ts");
const { parseReport } = await import("./safety.ts");
const { stripControls, stripControlsDeep, withoutNul } = await import("./controls.ts");
const { isInputError } = await import("./mcp-partner.ts");

const NUL = "\u0000";
const WEB = { channel: "web", client: "" };
const INTERESTS = ["AI", "Music", "Books"];
const body = (name, telegram, extra = {}) => ({
  edgeCity: true, name, telegram, status: "single", lookingFor: ["friends"], interests: INTERESTS, about: "Builds small AI tools.",
  agreedToTerms: true, ageConfirmed: true, ...extra,
});
const post = (url, b, headers = {}) => new Request(`https://kismet.test${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(b) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const partner = (subject) => ({ authorization: `Bearer ${KEY}`, "x-village-subject": subject });
const noNul = (rows) => assert.ok(!JSON.stringify(rows).includes("\\u0000"), "no NUL stored");

afterEach(() => pg.exec("delete from reports; delete from blocks; delete from dates; delete from agent_notes; delete from activity_log; delete from rate_limits; delete from users;"));

test("stripControls: C0 (not tab / newline / CR), DEL, C1, zero-width and bidi overrides go; text and emoji stay", () => {
  assert.equal(stripControls(`De${NUL}on\u0007\u001b\u007f\u0085\u200b\u202e`), "Deon");
  assert.equal(stripControls("line 1\nline\t2\r\n"), "line 1\nline\t2\r\n");
  assert.equal(stripControls("Chai ☕ at Riva, Mandrem 🌊"), "Chai ☕ at Riva, Mandrem 🌊");
  assert.deepEqual(stripControlsDeep({ a: [`x${NUL}`, 1, { b: `y${NUL}` }], [`k${NUL}`]: true, n: null }), { a: ["x", 1, { b: "y" }], k: true, n: null });
  assert.deepEqual(withoutNul({ t: [`a${NUL}b`], d: 3 }), { t: ["ab"], d: 3 });
  const d = new Date();
  assert.equal(withoutNul(d), d, "non-plain objects pass through untouched");
  assert.equal(isInputError({ code: "22P05" }), true);
  assert.equal(isInputError({ code: "57014" }), false);
  assert.equal(isInputError(new Error("x")), false);
});

test("parsers: NUL and other controls are stripped from every free-text field, before the length and empty checks", () => {
  const r = parseProfile(body(`Pri${NUL}ya`, "priya_tg", { about: `Surfs ${NUL}at dawn\u200b`, interests: [`AI${NUL}`, "Mu\u200bsic", "Books"], agentProfile: `I build${NUL}.` }));
  assert.ok(r.profile, r.error);
  assert.equal(r.profile.name, "Priya");
  assert.equal(r.profile.bio, "Surfs at dawn");
  assert.deepEqual(r.profile.interests, ["AI", "Music", "Books"]);
  assert.equal(r.profile.agentProfile, "I build.");
  assert.match(parseProfile(body(NUL.repeat(3), "priya_tg")).error, /^name:/, "a name of only controls is empty: a clean 400");
  assert.match(parseProfile(body("Priya", "priya_tg", { interests: [NUL, "AI", "Music"] })).error, /^interests\.0:/);
  assert.deepEqual(parseNotes({ notes: [`Loves ${NUL}chai`, `Surfs\u0007 daily`] }), ["Loves chai", "Surfs daily"]);
  assert.deepEqual(parseNotes({ notes: [NUL] }), { error: "A note is empty." });
  const rep = parseReport({ dateId: "aaaaaaaa-0000-4000-8000-000000000001", reason: "spam", note: `bad${NUL} ad` });
  assert.equal(rep.note, "bad ad");
});

test("the database layer drops a NUL that got past the checks: an insert with one never fails", async () => {
  const r = parseProfile(body("Asha", "asha_tg"));
  const { id } = await insertUser({ ...r.profile, bio: `raw${NUL}bio` }, WEB, null, [`raw ${NUL}note`]);
  const { rows } = await pg.query("select u.bio, n.text from users u join agent_notes n on n.user_id = u.id where u.id = $1", [id]);
  assert.deepEqual(rows, [{ bio: "rawbio", text: "raw note" }]);
});

test("/api/signup, PATCH /api/me and POST /api/me/notes: a NUL anywhere is a 2xx with it stripped, never a 500", async () => {
  const s = await json(await signup.POST(post("/api/signup", body(`Nu${NUL}la`, "nula_tg", { about: `hi${NUL}`, notes: [`fact${NUL}`] }))));
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const auth = { authorization: `Bearer ${s.body.token}` };
  const edit = await meRoute.PATCH(new Request("https://kismet.test/api/me", { method: "PATCH", headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ ...body(`Nula${NUL}2`, "nula_tg"), about: `edited${NUL}` }) }));
  assert.equal(edit.status, 200, await edit.clone().text());
  const n = await notesRoute.POST(post("/api/me/notes", { notes: [`Loves ${NUL}chai`] }, auth));
  assert.equal(n.status, 201, await n.clone().text());
  const { rows } = await pg.query("select u.name, u.bio, array_agg(n.text order by n.created_at) as notes from users u join agent_notes n on n.user_id = u.id group by u.id");
  assert.deepEqual(rows, [{ name: "Nula2", bio: "edited", notes: ["fact", "Loves chai"] }]);
});

test("Agent Village HTTP and MCP: NUL in a name or a note is stripped (201 / 200); a refused value is an input error, never 'unavailable'", async () => {
  const h = await json(await village.POST(post("/api/village/signup", { answers: body(`Vee${NUL}`, "vee_tg"), notes: [`n${NUL}1`] }, partner("av-nul-1")),
    { params: Promise.resolve({ op: "signup" }) }));
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const add = await json(await village.POST(post("/api/village/notes", { add: [`n${NUL}2`] }, partner("av-nul-1")), { params: Promise.resolve({ op: "notes" }) }));
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const call = async (name, args, subject) => (await (await mcp.POST(post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, partner(subject)))).json()).result;
  const m = await call("kismet_signup", { answers: body(`Em${NUL}`, "em_tg"), notes: [`m${NUL}1`] }, "av-nul-2");
  assert.ok(!m.isError, JSON.stringify(m));
  const mn = await call("kismet_notes", { add: [`m${NUL}2`] }, "av-nul-2");
  assert.ok(!mn.isError, JSON.stringify(mn));
  const { rows } = await pg.query("select u.name, n.text from users u join agent_notes n on n.user_id = u.id order by u.name, n.text");
  assert.deepEqual(rows.map((r) => `${r.name}:${r.text}`), ["Em:m1", "Em:m2", "Vee:n1", "Vee:n2"]);
  noNul(rows);
  // A value the database itself refuses (SQLSTATE 22...) answers as the caller's input error.
  const { callPartnerTool } = await import("./mcp-partner.ts");
  const refused = await callPartnerTool("kismet_summary", {}, { kind: "resident", subject: "av-nul-3", run: async () => { throw Object.assign(new Error("invalid byte sequence"), { code: "22021" }); } });
  assert.equal(refused.structuredContent.error, "invalid_request");
  assert.doesNotMatch(refused.content[0].text, /temporarily unavailable/);
});

test("sign-up: the report history check runs first, and a sign-up that fails after the insert leaves no account (the retry is checked)", async () => {
  // A banned Agent Village account, deleted: its ban is kept with the resident's hash.
  const r = parseProfile(body("Fake", "fake_tg"));
  const { id: banned } = await insertUser(r.profile, WEB, "av-half-1");
  await pg.query("update users set banned_at = now() where id = $1", [banned]);
  await deleteUser(banned, WEB);
  // The notes insert fails (table missing) after the user row went in.
  await pg.exec("alter table agent_notes rename to agent_notes_off");
  try {
    const p = parseProfile(body("Real", "real_tg"));
    await assert.rejects(insertUser(p.profile, WEB, "av-half-1", ["a fact"]));
  } finally {
    await pg.exec("alter table agent_notes_off rename to agent_notes");
  }
  const left = await pg.query("select id from users where village_resident is not null");
  assert.equal(left.rows.length, 0, "no half-made account");
  // The retry is a sign-up again: checked against the history, so hidden pending review.
  const p = parseProfile(body("Real", "real_tg"));
  const again = await insertUser(p.profile, WEB, "av-half-1", ["a fact"]);
  assert.ok(again?.id);
  const { rows } = await pg.query("select hidden_at from users where id = $1", [again.id]);
  assert.ok(rows[0].hidden_at, "hidden by the history check");
});
