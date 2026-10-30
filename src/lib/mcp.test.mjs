// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage, INSTRUCTIONS, MAX_RESPONSE_BYTES, ORIGIN, TOOLS } from "./mcp.ts";
import { PARTNER_MAX_RESPONSE_BYTES, PARTNER_TOOLS, partnerCaller, PUBLIC_CALLER } from "./mcp-partner.ts";

const data = { how_it_works: { name: "Kismet" }, village_stats: { agents: 0, dates: 0, matches: 0 } };
const calls = [];
const run = async (name, args) => {
  calls.push([name, args]);
  return name === "public_board" ? { quotes: [{ quote: "hi", day: "2026-10-18" }] } : data[name];
};
const call = (name, args, runner = run) =>
  handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } }, runner);

test("initialize, then notifications/initialized, as the Agent Village bridge does", async () => {
  const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, run);
  assert.equal(init.id, 1);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.serverInfo, { name: "kismet", title: "Kismet", version: "1.0.0" });
  assert.match(init.result.instructions, /read-only/);
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, run)).result.protocolVersion, "2025-06-18");
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, run), null);
});

test("tools/list serves plain JSON Schemas: additionalProperties false, no $schema", async () => {
  const { result } = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, run);
  assert.deepEqual(result.tools.map((t) => t.name), ["how_it_works", "village_stats", "public_board"]);
  for (const t of result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(!JSON.stringify(t.inputSchema).includes("$schema"));
    assert.deepEqual(t.annotations, { readOnlyHint: true, openWorldHint: false });
  }
  assert.deepEqual(result.tools.map((t) => t.inputSchema), TOOLS.map((t) => t.inputSchema));
  assert.deepEqual(result.tools[2].inputSchema, { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20, default: 10 } }, additionalProperties: false });
});

test("every result is the data as JSON with a source line last", async () => {
  for (const name of ["how_it_works", "village_stats", "public_board"]) {
    const r = await call(name, {});
    assert.equal(r.result.isError, undefined);
    const text = r.result.content[0].text;
    const lines = text.split("\n");
    assert.match(lines.at(-1), new RegExp(`^Source: Kismet.*\\(${ORIGIN.replace(/[./]/g, "\\$&")}`));
    JSON.parse(text.slice(0, text.lastIndexOf("\n\nSource:")));
  }
  // arguments omitted is the same as {}
  assert.equal((await call("village_stats")).result.isError, undefined);
});

test("exact arguments: unknown keys and out-of-range limits are refused before any data is read", async () => {
  calls.length = 0;
  for (const [name, args] of [["village_stats", { x: 1 }], ["how_it_works", { limit: 3 }], ["public_board", { limit: 0 }], ["public_board", { limit: 21 }],
    ["public_board", { limit: 2.5 }], ["public_board", { limit: "5" }], ["public_board", { limit: 5, room: "x" }], ["public_board", [1]]]) {
    const r = await call(name, args);
    assert.equal(r.result.isError, true, `${name} ${JSON.stringify(args)}`);
  }
  assert.equal(calls.length, 0);
  await call("public_board", { limit: 20 });
  assert.deepEqual(calls, [["public_board", { limit: 20 }]]);
});

test("unknown tools and methods are JSON-RPC errors; bad envelopes are refused", async () => {
  assert.equal((await call("signup", {})).error.code, -32602);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" }, run)).error.code, -32601);
  assert.deepEqual((await handleMessage({ jsonrpc: "2.0", id: 5, method: "ping" }, run)).result, {});
  for (const bad of [null, [], "x", { id: 1, method: "ping" }, { jsonrpc: "2.0", id: { a: 1 }, method: "ping" }]) {
    assert.equal((await handleMessage(bad, run)).error.code, -32600);
  }
});

test("oversized results and backend failures are explicit errors, never truncated data", async () => {
  const big = async () => ({ quotes: Array.from({ length: 20 }, () => ({ quote: "ä".repeat(2000) })) });
  const r = await call("public_board", { limit: 20 }, big);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /smaller limit/);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= MAX_RESPONSE_BYTES);
  const down = await call("village_stats", {}, async () => { throw new Error("db down"); });
  assert.equal(down.result.isError, true);
  assert.doesNotMatch(down.result.content[0].text, /db down/);
});

// Authenticated tools (Agent Village app token + X-Village-Subject), with a fake partner-op runner.
const KEY = "k".repeat(20) + "Z9-_".repeat(11);
const ops = [];
const runOp = async (req) => {
  ops.push(req);
  if (req.op === "summary") return { status: 200, body: { ok: true, text: "Your summary.", summary: { dates: [] } } };
  return { status: 404, body: { ok: false, error: "not_signed_up", message: "This resident has no Kismet account.", text: "Not signed up yet." } };
};
const resident = partnerCaller(`Bearer ${KEY}`, "resident-1", KEY, runOp);
const list = async (caller) => (await handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/list" }, run, caller)).result.tools;
const callAs = (caller, name, args) => handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } }, run, caller);

test("partner caller: no Authorization is the public server; a wrong key, missing or bad subject is refused", () => {
  assert.equal(partnerCaller(null, "resident-1", KEY, runOp), PUBLIC_CALLER);
  assert.equal(partnerCaller(null, null, undefined, runOp), PUBLIC_CALLER);
  assert.deepEqual([resident.kind, resident.subject], ["resident", "resident-1"]);
  const refused = (auth, subject, key = KEY) => { const c = partnerCaller(auth, subject, key, runOp); return c.kind === "refused" ? c.error : c.kind; };
  assert.equal(refused(`Bearer ${KEY}x`, "resident-1"), "unauthorized");
  assert.equal(refused("Basic abc", "resident-1"), "unauthorized");
  assert.equal(refused(`Bearer ${KEY}`, "resident-1", ""), "partner_api_disabled");
  assert.equal(refused(`Bearer ${KEY}`, null), "missing_subject");
  assert.equal(refused(`Bearer ${KEY}`, "a b"), "invalid_subject");
});

test("tools/list: public tools only without a resident, byte-identical; the kismet_* tools added with one", async () => {
  const pub = await list(PUBLIC_CALLER);
  assert.equal(JSON.stringify(await list()), JSON.stringify(pub));
  for (const c of [partnerCaller(`Bearer ${KEY}x`, "resident-1", KEY, runOp), partnerCaller(`Bearer ${KEY}`, null, KEY, runOp), partnerCaller(null, "resident-1", KEY, runOp)]) {
    assert.equal(JSON.stringify(await list(c)), JSON.stringify(pub));
  }
  const all = await list(resident);
  assert.equal(JSON.stringify(all.slice(0, 3)), JSON.stringify(pub));
  assert.deepEqual(all.slice(3).map((t) => t.name), ["kismet_signup", "kismet_summary", "kismet_go", "kismet_decide", "kismet_notes", "kismet_delete"]);
  for (const t of all.slice(3)) {
    assert.deepEqual(Object.keys(t), ["name", "title", "description", "inputSchema", "annotations"]);
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(t.annotations.readOnlyHint, false);
  }
  const by = Object.fromEntries(all.map((t) => [t.name, t.inputSchema]));
  assert.deepEqual(by.kismet_decide.required, ["dateId", "decision"]);
  assert.deepEqual(by.kismet_decide.properties.decision.enum, ["meet", "pass"]);
  assert.deepEqual(by.kismet_signup.required, ["answers"]);
  assert.deepEqual(Object.keys(by.kismet_signup.properties), ["answers", "telegram", "notes"]);
  assert.deepEqual(by.kismet_signup.properties.answers.required, ["name", "lookingFor", "interests", "agreedToTerms", "ageConfirmed"]);
  assert.deepEqual(Object.keys(by.kismet_go.properties), ["targetId"]);
  assert.deepEqual([by.kismet_summary.properties, by.kismet_delete.properties], [{}, {}]);
  // initialize: the public text, plus the resident lines only for a resident.
  const init = async (c) => (await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, run, c)).result.instructions;
  assert.equal(await init(PUBLIC_CALLER), INSTRUCTIONS);
  assert.match(await init(resident), /kismet_decide/);
});

test("public tools answer the same with or without a resident", async () => {
  for (const name of ["how_it_works", "village_stats", "public_board"]) {
    assert.equal(JSON.stringify(await callAs(resident, name, {})), JSON.stringify(await callAs(PUBLIC_CALLER, name, {})));
  }
});

test("kismet_* without the app token and subject: an isError result, nothing runs", async () => {
  ops.length = 0;
  for (const name of PARTNER_TOOLS.map((t) => t.name)) {
    const r = (await callAs(PUBLIC_CALLER, name, {})).result;
    assert.equal(r.isError, true, name);
    assert.equal(r.structuredContent.error, "unauthorized");
    assert.deepEqual(Object.keys(r.structuredContent), ["ok", "error", "message"]);
    assert.equal(r.content[0].text, r.structuredContent.message);
    assert.deepEqual(JSON.parse(r.content[1].text), r.structuredContent);
  }
  for (const [c, error] of [[partnerCaller("Bearer wrong", "resident-1", KEY, runOp), "unauthorized"], [partnerCaller(`Bearer ${KEY}`, null, KEY, runOp), "missing_subject"]]) {
    const r = (await callAs(c, "kismet_summary")).result;
    assert.deepEqual([r.isError, r.structuredContent.ok, r.structuredContent.error], [true, false, error]);
  }
  assert.equal(ops.length, 0);
});

test("kismet_* arguments: exact keys, the HTTP checks, the subject is always the resident", async () => {
  ops.length = 0;
  const dateId = "5f0c7e2a-1b9e-4c55-9a8e-0d1f2a3b4c5d";
  for (const [name, args] of [["kismet_summary", { residentId: "someone-else" }], ["kismet_decide", { dateId, decision: "yes" }], ["kismet_decide", { dateId }],
    ["kismet_go", { targetId: "nope" }], ["kismet_signup", {}], ["kismet_signup", { answers: {}, residentId: "r" }], ["kismet_signup", { answers: {}, telegram: 5 }], ["kismet_delete", [1]], ["kismet_notes", { add: ["a"], deleteAll: true }]]) {
    const r = (await callAs(resident, name, args)).result;
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.equal(r.structuredContent.error, "invalid_request");
  }
  assert.equal(ops.length, 0);
  await callAs(resident, "kismet_decide", { dateId, decision: "meet" });
  await callAs(resident, "kismet_go");
  assert.deepEqual(ops, [{ op: "decide", residentId: "resident-1", dateId, decision: "meet" }, { op: "go", residentId: "resident-1" }]);
});

test("kismet_* results: content text is the body's text, structuredContent the HTTP body; HTTP errors are isError", async () => {
  const s = (await callAs(resident, "kismet_summary", {})).result;
  const body = { ok: true, text: "Your summary.", summary: { dates: [] } };
  assert.deepEqual(s, { content: [{ type: "text", text: "Your summary." }, { type: "text", text: JSON.stringify(body) }], structuredContent: body });
  const n = (await callAs(resident, "kismet_go", {})).result;
  assert.equal(n.isError, true);
  assert.equal(n.content[0].text, "Not signed up yet.");
  assert.equal(n.structuredContent.error, "not_signed_up");
  const down = (await callAs(partnerCaller(`Bearer ${KEY}`, "r", KEY, async () => { throw new Error("db down"); }), "kismet_summary")).result;
  assert.deepEqual([down.isError, down.structuredContent.error], [true, "unavailable"]);
  assert.doesNotMatch(JSON.stringify(down), /db down/);
  const huge = partnerCaller(`Bearer ${KEY}`, "r", KEY, async () => ({ status: 200, body: { ok: true, text: "x".repeat(PARTNER_MAX_RESPONSE_BYTES) } }));
  const big = await callAs(huge, "kismet_summary");
  assert.deepEqual([big.result.isError, big.result.structuredContent.error], [true, "too_large"]);
  // An unknown name is still a JSON-RPC error for everyone.
  assert.equal((await callAs(resident, "kismet_admin", {})).error.code, -32602);
});

test("one sign-up story everywhere (QA2 N-M5): residents themselves at /join, or their own agent via the API when asked; never the web quiz for them", async () => {
  const { HOW_IT_WORKS, SIGNUP_STORY, STEPS } = await import("./copy.ts");
  const { agentScript, agentScriptCore } = await import("./agent-script.ts");
  assert.ok(HOW_IT_WORKS.join.startsWith(SIGNUP_STORY));
  assert.match(SIGNUP_STORY, /\/join/);
  assert.match(SIGNUP_STORY, /llms\.txt/);
  assert.match(SIGNUP_STORY, /only when they ask/);
  assert.match(SIGNUP_STORY, /never fills in the web quiz/);
  assert.match(SIGNUP_STORY, /install the Kismet mini-app/);
  assert.ok(!STEPS.some((s) => /Agent Village/.test(s.body)), "no Agent Village sign-up promised yet");
  for (const s of [agentScriptCore("https://k.test"), agentScript("https://k.test")]) {
    assert.match(s, /never fill in the web quiz \(https:\/\/k\.test\/join\) for them/i);
    assert.match(s, /POST \/api\/signup/);
  }
  assert.match(INSTRUCTIONS, /Residents sign up themselves at \/join/);
  assert.match(INSTRUCTIONS, /never by filling in the web quiz/);
});

// The 4.3(b) repositioning (2026-10-29): Kismet is community intros made by AI agents, romance opt-in. The public copy
// talks about agent chats and intros, never dating or "dates" (the API's own names, /api/me/dates and dateId, stay).
test("intros copy: the pitch, how_it_works, MCP instructions, public tools, llms.txt and Edge City texts never say dating or dates", async () => {
  const { FOR_WHOM, HOW_IT_WORKS, PITCH, STEPS, howItWorks, weeklyHow } = await import("./copy.ts");
  const { agentScript, agentScriptCore } = await import("./agent-script.ts");
  const { EDGE_QUESTION, EDGE_QUESTION_EXISTING, EDGE_QUESTION_PLAIN, edgeOnlyText, edgePendingText, edgeWelcomeText } = await import("./edge-city.ts");
  const DATING = /\bdat(e|es|ed|ing)\b|matchmak/i;
  const oldName = (s) => s.replace(/\(formerly Agent Dates\)/g, "");
  const { formerly, ...hiw } = HOW_IT_WORKS;
  assert.equal(formerly, "Agent Dates"); // the old name stays, so agents and residents who knew it still find Kismet
  const texts = [
    PITCH, FOR_WHOM, ...STEPS.flatMap((s) => [s.title, s.body]), weeklyHow("Friday 30 Oct at 7 pm India time"), ...Object.values(hiw),
    ...["upcoming", "now", "over"].map((state) => howItWorks({ state, text: "Next drop: Friday." }).weekly),
    oldName(INSTRUCTIONS), ...TOOLS.map((t) => t.description.replace("(the dates field)", "")),
    agentScriptCore("https://k.test").replace(/\/api\/me\/dates/g, ""), // the whole llms.txt, but for the API's own path
    EDGE_QUESTION, EDGE_QUESTION_EXISTING, EDGE_QUESTION_PLAIN, edgeOnlyText("https://k.test"), edgePendingText("https://k.test"), edgeWelcomeText,
  ];
  for (const t of texts) assert.doesNotMatch(t, DATING, t);
  assert.match(PITCH, /meets the village/);
  assert.match(FOR_WHOM, /friends, collaborators and co-founders/);
  assert.match(HOW_IT_WORKS.what, /romance only if both opted in/);
  for (const s of [agentScriptCore("https://k.test"), agentScript("https://k.test")]) {
    assert.doesNotMatch(s, /\bdating\b|go on dates|send them on dates|your agent dates/i);
    assert.match(s, /romance only if both opt in|Romance happens only\s+between two people who both chose Romance/);
  }
});

// Pinned by Edge City (Agent Village's manifest): the kismet_* tools keep their names, titles and descriptions as
// shipped, whatever the website calls things now.
test("kismet_* tools: titles and descriptions stay exactly as pinned", () => {
  const pinned = {
    kismet_signup: ["Sign up for Kismet", "Signs this resident up with their quiz answers (only after they said yes to signing up), or updates the answers of their existing account; their agent then goes on its first dates. Optional notes: short facts about them (no contact details)."],
    kismet_summary: ["Kismet summary", "This resident's Kismet summary: dates, recommendations (dateId, targetId) waiting for a meet/pass answer, matches and the weekly drop. Like any visit, it may send their agent on new dates. Relay the text."],
    kismet_go: ["Go on dates", "Sends this resident's agent on new dates (up to 3 new people a day). Optional targetId (from the summary) asks for a date with that person."],
    kismet_decide: ["Meet or pass", "Records this resident's own meet/pass answer for one of their finished dates. Final. A match only when both humans say meet; nobody learns the other's answer otherwise."],
    kismet_notes: ["What the agent knows", "Facts this resident's agent knows about them. No arguments lists them; or one of add (new facts), deleteId (one note) or deleteAll: true."],
    kismet_delete: ["Delete Kismet account", "Deletes this resident's Kismet account, dates and matches. Only when they ask."],
  };
  assert.deepEqual(Object.fromEntries(PARTNER_TOOLS.map((t) => [t.name, [t.title, t.description]])), pinned);
});
