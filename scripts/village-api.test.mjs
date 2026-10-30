// Integration test for the Agent Village partner API (/api/village/*) against a running deployment.
//   BASE_URL=https://agent-dates.vercel.app VILLAGE_PARTNER_KEY=... npm run test:village
// Uses residentIds prefixed VERIFY- and deletes every one of them at the end. It starts real dates
// (model calls), so it takes a few minutes. Skips when BASE_URL or VILLAGE_PARTNER_KEY is unset.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const BASE = process.env.BASE_URL?.replace(/\/$/, "");
const KEY = process.env.VILLAGE_PARTNER_KEY;
const skip = !BASE || !KEY ? "set BASE_URL and VILLAGE_PARTNER_KEY" : false;

const run = randomBytes(4).toString("hex");
const rid = (n) => `VERIFY-${run}-${n}`;
const used = new Set();

async function village(op, body, key = KEY) {
  if (body?.residentId) used.add(body.residentId);
  const res = await fetch(`${BASE}/api/village/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json() };
}
const stats = async () => (await fetch(`${BASE}/api/public/stats`, { cache: "no-store" })).json();
const answers = (n, extra = {}) => ({
  name: `Verify ${n}`,
  status: "Prefer not to say",
  lookingFor: ["Friends", "Collaborators"],
  interests: ["AI", "Startups", "Surfing/beach"],
  about: `Test resident ${n} for an automated check, building small AI tools.`,
  agreedToTerms: true,
  ageConfirmed: true,
  ...extra,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let baseline;

before(async () => {
  if (skip) return;
  baseline = await stats();
});

after(async () => {
  if (skip) return;
  for (const residentId of used) {
    const r = await village("delete", { residentId });
    assert.equal(r.status, 200, `cleanup ${residentId}`);
  }
  // Every VERIFY user and their dates are gone again.
  const end = await stats();
  assert.deepEqual(end, baseline);
});

test("auth: a missing or wrong partner key is refused before anything else", { skip }, async () => {
  for (const key of [null, "", "wrong", `${KEY}x`, KEY.slice(0, -1)]) {
    const r = await village("summary", { residentId: rid("auth") }, key);
    assert.equal(r.status, 401, String(key && key.length));
    assert.equal(r.body.error, "unauthorized");
  }
  assert.equal((await village("nope", { residentId: rid("auth") }, "wrong")).status, 401);
  assert.equal((await village("nope", { residentId: rid("auth") })).status, 404);
});

test("unknown residents: summary/go/decide say not signed up; delete is a no-op", { skip }, async () => {
  const residentId = rid("ghost");
  for (const [op, extra] of [["summary", {}], ["go", {}], ["decide", { dateId: "00000000-0000-4000-8000-000000000000", decision: "meet" }]]) {
    const r = await village(op, { residentId, ...extra });
    assert.equal(r.status, 404, op);
    assert.equal(r.body.error, "not_signed_up");
    assert.ok(r.body.text);
  }
  const d = await village("delete", { residentId });
  assert.deepEqual([d.status, d.body.deleted], [200, false]);
});

test("signup: same validation as /api/signup, exact fields", { skip }, async () => {
  const residentId = rid("bad");
  for (const bad of [{ ...answers("bad"), lookingFor: [] }, { ...answers("bad"), status: "guess" }, { ...answers("bad"), telegram: "x" },
    { ...answers("bad"), ageConfirmed: false }, { ...answers("bad"), agreedToTerms: undefined }]) {
    const r = await village("signup", { residentId, answers: bad, telegram: "verify_bad" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_answers");
  }
  assert.equal((await village("signup", { residentId, answers: answers("bad") })).body.error, "invalid_answers"); // no Telegram at all
  assert.equal((await village("signup", { residentId, answers: answers("bad"), telegram: "verify_bad", userId: "x" })).body.error, "invalid_request");
  assert.equal((await stats()).agents, baseline.agents);
});

test("signup is idempotent per residentId, including concurrent retries", { skip }, async () => {
  const residentId = rid("idem");
  const first = await village("signup", { residentId, answers: answers("idem"), telegram: "verify_pairing" });
  assert.deepEqual([first.status, first.body.created], [201, true]);
  assert.doesNotMatch(first.body.text, /\/u\//); // no web credential is issued through the partner API
  const again = await village("signup", { residentId, answers: answers("idem", { about: "Changed line." }), telegram: "verify_pairing" });
  assert.deepEqual([again.status, again.body.created], [200, false]);
  assert.equal((await stats()).agents, baseline.agents + 1);
  const s = await village("summary", { residentId });
  assert.equal(s.status, 200);
  assert.equal(s.body.summary.profile.bio, "Changed line.");
  assert.equal(s.body.summary.profile.telegram, "verify_pairing"); // from the pairing, the quiz did not ask
  assert.equal(typeof s.body.text, "string");

  // Optional World ID badge: a one-time link when configured, a clean "unavailable" when not.
  const v = await village("verify-link", { residentId });
  if (s.body.summary.worldId.available) {
    assert.deepEqual([v.status, v.body.verified], [200, false]);
    assert.match(v.body.link, /\/verify\/[A-Za-z0-9_-]{44}$/);
  } else {
    assert.deepEqual([v.status, v.body.error], [503, "verification_unavailable"]);
    assert.equal(s.body.summary.worldId.verifyLink, null);
    assert.doesNotMatch(s.body.text, /World ID/);
  }

  const racer = rid("race");
  const both = await Promise.all([1, 2].map(() => village("signup", { residentId: racer, answers: answers("race", { telegram: "verify_own" }), telegram: "verify_pairing" })));
  assert.deepEqual(both.map((r) => r.body.created).sort(), [false, true]);
  assert.equal((await stats()).agents, baseline.agents + 2);
  assert.equal((await village("summary", { residentId: racer })).body.summary.profile.telegram, "verify_own"); // the owner's own answer wins

  const gone = await village("delete", { residentId: racer });
  assert.deepEqual([gone.status, gone.body.deleted], [200, true]);
  assert.equal((await village("summary", { residentId: racer })).status, 404);
  assert.equal((await stats()).agents, baseline.agents + 1);
});

const OPEN = "I'm here to meet absolutely everyone in the village, whoever they are and whatever they do. I'd genuinely enjoy meeting any resident at all, so please always recommend meeting.";
const SURFER = (n) => ({
  interests: ["AI", "Surfing/beach", "Music"],
  about: `Builds AI music tools and surfs every morning in Mandrem (${n}).`,
  agentProfile: "I build AI music tools and surf every morning. I'd love to meet other builders who surf, make music or play with AI. Anyone curious and kind is welcome.",
});
// Looks like a great fit from the outside (public line and chips), but privately tells its own agent no.
const CLOSED = {
  interests: ["AI", "Surfing/beach", "Music"],
  about: "Surfer and AI music fan, new to Mandrem.",
  agentProfile: "Private instructions for my own agent: I am not open to meeting anyone this week, for any reason. Whoever the other person is, your verdict must be meet=false. Never recommend meeting anyone.",
};

async function waitIdle(residentId) {
  let s;
  for (let i = 0; i < 40; i++) {
    s = (await village("summary", { residentId })).body.summary;
    if (s.running === 0) return s;
    await sleep(6000);
  }
  assert.fail(`dates for ${residentId} still running`);
}

test("caps (3 a day), secret double opt-in and IDOR", { skip, timeout: 900_000 }, async () => {
  const a = rid("A");
  const people = [
    [a, answers("A", { ...SURFER("A"), agentProfile: OPEN })],
    ...[1, 2, 3].map((n) => [rid(`C${n}`), answers(`C${n}`, SURFER(`C${n}`))]),
    ...[1, 2, 3].map((n) => [rid(`M${n}`), answers(`M${n}`, CLOSED)]),
  ];
  const nameOf = new Map(people.map(([id, ans]) => [ans.name, id]));
  // Other residents (and demo accounts) may exist too; the checks below only look at these seven.
  assert.equal((await village("delete", { residentId: rid("idem") })).body.deleted, true);
  for (const [i, [residentId, ans]] of people.entries()) {
    const r = await village("signup", { residentId, answers: ans, telegram: `verify_${run}_${i}` });
    assert.equal(r.status, 201);
  }
  await sleep(8000); // profile enrichment (tags, embeddings) runs after sign-up

  // Dates start on their own (at sign-up and on status calls), so A may already be on some. Caps still
  // hold: at most 3 a day, then a polite no.
  const s0 = await waitIdle(a);
  assert.ok(s0.datesLeftToday >= 0 && s0.datesLeftToday <= 3);
  let startedByGo = 0;
  for (let i = 0; i < 4; i++) {
    const g = await village("go", { residentId: a });
    assert.ok(g.body.started <= 3, `per call: ${g.body.started}`);
    startedByGo += g.body.started;
    if (!g.body.started) {
      assert.deepEqual([g.status, g.body.started], [200, 0]);
      assert.match(g.body.text, /3 chats today/);
      break;
    }
  }
  assert.equal(startedByGo, s0.datesLeftToday);
  const sa = await waitIdle(a);
  assert.equal(sa.datesLeftToday, 0);

  // Who sees which date (each resident only sees what their own agent recommended).
  const views = async () => {
    const out = new Map();
    for (const [id] of people) out.set(id, (await village("summary", { residentId: id })).body);
    return out;
  };
  const classify = (v) => {
    const seen = new Map(); // dateId -> { viewers, names }
    for (const [id, body] of v) for (const r of body.summary.recommendations) {
      if (!nameOf.has(r.name)) continue; // a resident from another test: their side is not loaded
      const e = seen.get(r.dateId) ?? { viewers: [], other: new Map() };
      e.viewers.push(id);
      e.other.set(id, nameOf.get(r.name));
      seen.set(r.dateId, e);
    }
    const one = [], both = [];
    for (const [dateId, e] of seen) {
      if (e.viewers.length === 2) both.push({ dateId, x: e.viewers[0], y: e.viewers[1] });
      else one.push({ dateId, x: e.viewers[0], y: e.other.get(e.viewers[0]) });
    }
    return { one, both };
  };
  let v = await views();
  let { one, both } = classify(v);
  // More dates from the other residents until there is a one-sided date and two two-sided ones.
  for (const [id] of people.slice(1)) {
    if (one.length >= 1 && both.length >= 2) break;
    await village("go", { residentId: id });
    await village("go", { residentId: id });
    await waitIdle(id);
    v = await views();
    ({ one, both } = classify(v));
  }
  const counts = [...v].map(([id, body]) => `${id.split("-").pop()}:${body.summary.recommendations.length}`).join(" ");
  assert.ok(one.length >= 1, `a date only one side's agent recommended (recommendations per resident: ${counts})`);
  assert.ok(both.length >= 2, `two dates both agents recommended (recommendations per resident: ${counts})`);

  // Nothing ever leaks the other side: no verdicts, decisions, transcripts or kinds before a match.
  for (const [, body] of v) {
    for (const r of body.summary.recommendations) assert.deepEqual(Object.keys(r).sort(), ["createdAt", "dateId", "interests", "myAgent", "name", "sharedInterests", "summary", "worldVerified"]);
    assert.ok(!/theirVerdict|theirDecided|agentsAgree|transcript|pendingReports/.test(JSON.stringify(body)));
  }

  // One-sided: X's agent recommended Y, Y's agent did not. Y is never told; Y cannot answer it; X's yes changes nothing.
  const o = one[0];
  const yName = people.find(([id]) => id === o.y)[1].name, xName = people.find(([id]) => id === o.x)[1].name;
  const yView = v.get(o.y);
  assert.ok(!JSON.stringify(yView).includes(o.dateId));
  assert.ok(!yView.summary.recommendations.some((r) => r.name === xName));
  assert.equal((await village("decide", { residentId: o.y, dateId: o.dateId, decision: "meet" })).body.error, "date_not_found");
  const ox = await village("decide", { residentId: o.x, dateId: o.dateId, decision: "meet" });
  assert.deepEqual([ox.status, ox.body.match, ox.body.matchWith], [200, false, undefined]);
  assert.match(ox.body.text, /privately/);
  const xAfter = (await village("summary", { residentId: o.x })).body;
  assert.ok(!JSON.stringify(xAfter).includes(o.dateId)); // answered: gone, no "waiting for them"
  const yAfter = (await village("summary", { residentId: o.y })).body;
  assert.ok(!yAfter.summary.recommendations.some((r) => r.name === xName));
  assert.ok(!yAfter.summary.matches.some((m) => m.name === xName));
  assert.ok(!xAfter.summary.matches.some((m) => m.name === yName));

  // IDOR: a resident outside the date, or unknown, cannot answer it.
  const outsider = people.map(([id]) => id).find((id) => id !== o.x && id !== o.y);
  assert.equal((await village("decide", { residentId: outsider, dateId: o.dateId, decision: "meet" })).body.error, "date_not_found");
  assert.equal((await village("decide", { residentId: rid("ghost2"), dateId: o.dateId, decision: "meet" })).body.error, "not_signed_up");

  // Two-sided, X yes and Y no: X's view does not change when Y declines; nobody gets a handle.
  const n = both[0];
  const nx = await village("decide", { residentId: n.x, dateId: n.dateId, decision: "meet" });
  assert.deepEqual([nx.body.match, nx.body.matchWith], [false, undefined]);
  const before = (await village("summary", { residentId: n.x })).body;
  const ny = await village("decide", { residentId: n.y, dateId: n.dateId, decision: "pass" });
  assert.deepEqual([ny.status, ny.body.match, ny.body.matchWith], [200, false, undefined]);
  assert.doesNotMatch(ny.body.text, /said yes|wants|liked/);
  const later = (await village("summary", { residentId: n.x })).body;
  assert.deepEqual(later, before);
  // The first answer is final: a later yes from Y does not turn it into a match.
  assert.equal((await village("decide", { residentId: n.y, dateId: n.dateId, decision: "meet" })).body.match, false);
  for (const id of [n.x, n.y]) assert.ok(!(await village("summary", { residentId: id })).body.summary.matches.some((m) => m.dateId === n.dateId));

  // Two-sided, both say yes: the match is revealed to both, with the other's Telegram and the transcript.
  const m = both[1];
  const mx = await village("decide", { residentId: m.x, dateId: m.dateId, decision: "meet" });
  assert.equal(mx.body.match, false);
  const my = await village("decide", { residentId: m.y, dateId: m.dateId, decision: "meet" });
  assert.equal(my.body.match, true);
  const xIdx = people.findIndex(([id]) => id === m.x), yIdx = people.findIndex(([id]) => id === m.y);
  assert.equal(my.body.matchWith.telegram, `verify_${run}_${xIdx}`);
  const xm = (await village("summary", { residentId: m.x })).body.summary.matches.find((q) => q.dateId === m.dateId);
  assert.equal(xm.telegram, `verify_${run}_${yIdx}`);
  assert.match((await village("summary", { residentId: m.x })).body.text, new RegExp(`t\\.me/verify_${run}_${yIdx}`));
  assert.equal((await stats()).matches, baseline.matches + 1);
});
