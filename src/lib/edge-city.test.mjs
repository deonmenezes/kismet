// Run: npm test. Edge City only (lib/edge-city.ts): reading "Are you at Edge City India?" answers, the weeks, the
// API body fields, and who is in the pool. The database side is in edge-pool.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_QUESTION, edgeOnlyText, edgePendingText, inPool, normalizeEdgeCity, normalizeWeeks, parseEdgeAnswer, parseWeeks, signupEdgeCity } from "./edge-city.ts";
import { parseProfile } from "./validate.ts";
import { HOW_IT_WORKS } from "./copy.ts";
import "./test-support/pg.mjs"; // module hooks: agent-script.ts imports without extensions

const { agentScript, agentScriptCore } = await import("./agent-script.ts");

test("edge city answers: yes, no or unclear, with the weeks a yes names", () => {
  const cases = [
    ["Yes", "yes", []], ["y", "yes", []], ["Yes, I'm here", "yes", []], ["yeah, weeks 2 and 3", "yes", ["week2", "week3"]],
    ["Yes, all 3 weeks", "yes", ["week1", "week2", "week3"]], ["I'm at Edge City for the last week", "yes", ["week3"]],
    ["week 1-2", "yes", ["week1", "week2"]], ["i am here week two", "yes", ["week2"]],
    ["No", "no", []], ["No, I'm not", "no", []], ["nope", "no", []], ["not this time", "no", []],
    ["not sure", null, []], ["what is edge city?", null, []], ["hello", null, []], ["now", null, []], ["", null, []],
    // Sentences that only start like an answer are unclear (asked again), never a yes or a no.
    ["I am in Bangalore", null, []], ["I am from Delhi, not Goa", null, []], ["Here's a question: what is it?", null, []],
    ["sure, what is it?", null, []], ["y is it only for edge city?", null, []], ["i'm at edge city? what's that", null, []],
    ["I was there last week but left", null, []], ["all good, see you next time", null, []], ["I'm not sure", null, []],
    ["i am not sure what that is", null, []], ["no idea", null, []], ["Not yet, arriving tomorrow", null, []], ["yes no", null, []],
    ["I'm here, not all weeks", null, []], ["here, not the first week", null, []], ["no, I'm here", null, []],
    ["yes please", "yes", []], ["Yep, week 3 only", "yes", ["week3"]], ["sure thing", "yes", []], ["YES 🙂", "yes", []],
    ["I'm not at Edge City", "no", []], ["no thanks", "no", []], ["the whole time", "yes", ["week1", "week2", "week3"]],
  ];
  for (const [text, answer, weeks] of cases) assert.deepEqual(parseEdgeAnswer(text), { answer, weeks }, text);
  assert.deepEqual(parseWeeks("the first and second week"), ["week1", "week2"]);
});

test("edge city answers: emoji, an emphatic no, and being in Mandrem without saying Edge City", () => {
  const cases = [
    ["👍", "yes"], ["👍🏽", "yes"], ["✅", "yes"], ["✔️", "yes"], ["👌", "yes"], ["yes 👍", "yes"], ["✅ week 2", "yes"],
    ["❌", "no"], ["👎", "no"], ["❎", "no"], ["no ❌", "no"],
    ["👍👎", null], ["✅❌", null], ["❌ week 2", null], ["🙂", null],
    ["definitely not", "no"], ["Absolutely not.", "no"], ["certainly not", "no"], ["definitely", "yes"], ["certainly", "yes"],
    ["i am in mandrem", null], ["I'm in Goa", null], ["in mandrem", null],
    ["I am in Mandrem for week 2", null], ["in goa weeks 1 and 2", null], ["week 2 and 3", "yes"],
    ["yes, I'm in Mandrem", "yes"], ["I'm here in Mandrem", "yes"], ["I am at Edge City", "yes"],
  ];
  for (const [text, answer] of cases) assert.equal(parseEdgeAnswer(text).answer, answer, text);
  assert.deepEqual(parseEdgeAnswer("✅ week 2").weeks, ["week2"]);
});

test("edge city at sign-up: an answer wins; left out, a store app or a real demo account is a member, anyone else is asked", () => {
  assert.deepEqual([signupEdgeCity(true, "web"), signupEdgeCity(false, "ios"), signupEdgeCity(true, "ios", true)], [true, false, true]);
  assert.deepEqual(["ios", "imessage", "android"].map((c) => signupEdgeCity(undefined, c)), [true, true, true]);
  assert.deepEqual(["web", "api", "mcp", "whatsapp"].map((c) => signupEdgeCity(undefined, c)), [null, null, null, null]);
  assert.equal(signupEdgeCity(undefined, "api", true), true);
  assert.match(edgePendingText("https://k.test"), /Are you at Edge City India\?" first \(at https:\/\/k\.test\/home\)/);
});

test("edge city in API bodies: booleans or yes/no words; weeks as ids or labels; left out stays undefined (unchanged)", () => {
  assert.deepEqual([normalizeEdgeCity(true), normalizeEdgeCity("no"), normalizeEdgeCity("TRUE"), normalizeEdgeCity("maybe"), normalizeEdgeCity(undefined)],
    [true, false, true, undefined, undefined]);
  assert.deepEqual(normalizeWeeks(["Week 3", 1, "w2", "week9", "x"]), ["week1", "week2", "week3"]);
  // Anchored: "14", "week12" or "2nd" are not a week (only 1-3, alone or after week / wk / w).
  assert.deepEqual(normalizeWeeks(["14", "week12", "31", "2nd", "w", "wk 2"]), ["week2"]);
  // The quiz's own labels count by their week (the dates in brackets are not read as weeks).
  assert.deepEqual(normalizeWeeks(["Week 1 (Oct 11-17)", "Week 3 (Oct 25 - Nov 1)"]), ["week1", "week3"]);
  assert.deepEqual(normalizeWeeks(["(week 2)", "Week (3)"]), ["week2", "week3"]);
  assert.equal(normalizeWeeks(undefined), undefined);
  const base = { name: "Asha", telegram: "asha_k", lookingFor: ["friends"], interests: ["AI"] };
  // A present but unreadable answer is refused; an empty one is left out.
  assert.match(parseProfile({ ...base, edgeCity: "not sure" }).error, /^edgeCity: answer true/);
  assert.equal(parseProfile({ ...base, edgeCity: "" }).profile.edgeCity, undefined);
  assert.equal(parseProfile({ ...base, edgeCity: "  " }).profile.edgeCity, undefined);
  assert.equal(parseProfile(base).profile.edgeCity, undefined);
  assert.deepEqual([parseProfile({ ...base, edgeCity: "yes", weeks: "week2,week3" }).profile.edgeCity, parseProfile({ ...base, edgeCity: "yes", weeks: "week2,week3" }).profile.edgeWeeks], [true, ["week2", "week3"]]);
  assert.equal(parseProfile({ ...base, atEdgeCity: false }).profile.edgeCity, false);
  assert.ok(!("atEdgeCity" in parseProfile({ ...base, atEdgeCity: true }).profile));
});

test("the pool: members only; not asked yet and no are both out", () => {
  assert.deepEqual([inPool({ edgeCity: true }), inPool({ edgeCity: false }), inPool({ edgeCity: null }), inPool({})], [true, false, false, false]);
});

test("copy: Edge City residents, private agents, and never an official Edge City product", () => {
  assert.match(EDGE_QUESTION, /Edge City India \(Mandrem, Goa/);
  assert.match(edgeOnlyText("https://k.test"), /Edge City only for now[\s\S]*https:\/\/k\.test\/waitlist/);
  assert.match(HOW_IT_WORKS.who, /Edge City India residents only[\s\S]*not an official Edge City product/);
  assert.match(HOW_IT_WORKS.what, /private AI agent that talks only to them/);
  for (const s of [agentScriptCore("https://k.test"), agentScript("https://k.test")]) {
    assert.match(s, /Edge City India/);
    assert.match(s, /PRIVATE agent/);
    assert.match(s, /"edgeCity": ?true/);
    assert.match(s, /\/api\/me\/edge-city/);
    assert.doesNotMatch(s, /\bby Edge City\b/);
  }
});

test("QA2 N-L6: \"no\" next to being here is unclear; first two weeks; digits after a yes; a bare \"last week\" names no week", () => {
  const cases = [
    ["no, at edge city", null, []], ["not only here", null, []],
    ["No, not at Edge City", "no", []], ["No, I am not here", "no", []], ["I am not at edge city", "no", []],
    ["here for the first two weeks", "yes", ["week1", "week2"]], ["here for the last 2 weeks", "yes", ["week2", "week3"]],
    ["yes 2 and 3", "yes", ["week2", "week3"]], ["yep, 1 & 2", "yes", ["week1", "week2"]],
    ["last week", null, []], ["yes last week", "yes", []], ["the last week", "yes", ["week3"]], ["yes for the last week only", "yes", ["week3"]],
  ];
  for (const [text, answer, weeks] of cases) assert.deepEqual(parseEdgeAnswer(text), { answer, weeks }, text);
});

test("review: \"no, I'm not in Edge City\" is still a no", () => {
  assert.deepEqual(parseEdgeAnswer("no i'm not in edge city"), { answer: "no", weeks: [] });
  assert.deepEqual(parseEdgeAnswer("No, I am not in Edge City"), { answer: "no", weeks: [] });
});
