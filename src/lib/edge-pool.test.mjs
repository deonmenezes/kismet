// Run: npm test. Edge City only (lib/edge-city.ts), end to end on a real Postgres (PGlite, in memory) with
// db/schema.sql applied: who is in the pool, that non-members are never dated, recommended, dropped, matched or shown
// (the real queries in db.ts, engine.ts, views.ts, actions.ts and the photo route), the sign-up question on the API
// and Agent Village, and the migration of accounts from before.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrate, schemaStatements } from "./test-support/pg.mjs";

const pg = await freshDb();
process.env.VILLAGE_PARTNER_KEY = "test-partner-key-0123456789abcdef0123456789";
const { insertUser, decideDate, setEdgeCity, autoStartDates } = await import("./actions.ts");
const { poolOthers, visibleOthers, boardQuotes, stats, toUser } = await import("./db.ts");
const { reserveDates } = await import("./engine.ts");
const { meView, pendingRecommendations } = await import("./views.ts");
const { parseProfile } = await import("./validate.ts");
const { VILLAGE } = await import("./client.ts");
const { residentKey } = await import("./village.ts");

const WEB = { channel: "web", client: "" };
const INTERESTS = ["AI", "Surfing/beach", "Music", "Books"];

async function person(name, edgeCity, { village = null, quotes = true } = {}) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: INTERESTS, publicQuotes: quotes, ...(edgeCity === undefined ? {} : { edgeCity }) });
  assert.ok(r.profile, r.error);
  const made = await insertUser(r.profile, village ? VILLAGE : WEB, village);
  return { id: made.id, token: made.token };
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const verdict = (meet) => JSON.stringify({ score: 8, meet, reason: "You both surf at dawn.", bestLine: "Dawn patrol and then chai?", suggestedMeetup: "Chai at The Circle" });
/** A finished friendly date where both agents recommend meeting. */
async function finishedDate(a, b) {
  const key = [a, b].sort().join(":");
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now()) returning id`, [key, a, b, verdict(true)]);
  return rows[0].id;
}

// The village: Ana and Bo said yes, Cy said no, Di is an account from before (never asked), Vi came through Agent Village.
const ana = await person("Ana", true);
const bo = await person("Bo", true);
const cy = await person("Cy", true);
await setEdgeCity(cy.id, false, [], WEB); // said no later
const di = await person("Di", undefined);
const vi = await person("Vi", undefined, { village: residentKey("resident-vi") });

// Every test starts without dates or photos, also after a failed one.
afterEach(() => pg.exec("delete from dates; delete from photos; delete from drop_claims;"));

test("membership: an answer is stored as given, a left-out one is null (not asked), Agent Village sign-ups are members", async () => {
  assert.equal((await user(ana.id)).edgeCity, true);
  assert.equal((await user(cy.id)).edgeCity, false);
  assert.equal((await user(di.id)).edgeCity, null);
  assert.equal((await user(vi.id)).edgeCity, true);
  // The change is recorded like any profile edit, plus an activity row (no answer text beyond member true/false).
  const h = await pg.query("select field, old_value, new_value from profile_history where user_id = $1 and field = 'edgeCity'", [cy.id]);
  assert.deepEqual(h.rows.map((r) => [r.old_value, r.new_value]), [[true, false]]);
  const a = await pg.query("select meta from activity_log where user_id = $1 and action = 'edge_city'", [cy.id]);
  assert.deepEqual(a.rows.map((r) => r.meta), [{ member: false }]);
});

test("pool: only members can be dated; visibleOthers (matches) still sees everyone not blocked or banned", async () => {
  const pool = (await poolOthers(ana.id)).map((u) => u.name).sort();
  assert.deepEqual(pool, ["Bo", "Vi"]);
  assert.deepEqual((await visibleOthers(ana.id)).map((u) => u.name).sort(), ["Bo", "Cy", "Di", "Vi"]);
  assert.ok(!(await poolOthers(di.id)).some((u) => u.id === cy.id || u.id === di.id));
});

test("dates: non-members never start one and are never picked, even when asked for by id", async () => {
  const none = await reserveDates(await user(di.id), "cap-di");
  assert.deepEqual(none.ids, []);
  assert.match(none.reason, /Are you at Edge City India/);
  const no = await reserveDates(await user(cy.id), "cap-cy");
  assert.deepEqual(no.ids, []);
  assert.match(no.reason, /Edge City only for now[\s\S]*\/waitlist/);
  assert.equal(await autoStartDates(await user(di.id), "cap-di", WEB), 0);
  // A member asking for a non-member by id gets nothing (the same answer as for anyone who is not a fit).
  const targeted = await reserveDates(await user(ana.id), "cap-ana", cy.id);
  assert.deepEqual(targeted.ids, []);
  const r = await reserveDates(await user(ana.id), "cap-ana-2");
  const partners = (await pg.query("select a_id, b_id from dates where id = any($1::uuid[])", [r.ids])).rows.map((d) => (d.a_id === ana.id ? d.b_id : d.a_id));
  assert.ok(partners.length > 0, "members still date each other");
  for (const p of partners) assert.ok([bo.id, vi.id].includes(p), "only members");
});

test("recommendations, top pick and summary: never a non-member, and nothing at all for someone out of the pool", async () => {
  const withBo = await finishedDate(ana.id, bo.id);
  const withCy = await finishedDate(ana.id, cy.id);
  const withDi = await finishedDate(di.id, ana.id);
  const A = await user(ana.id);
  assert.deepEqual((await pendingRecommendations(A)).map((r) => r.dateId), [withBo]);
  const view = await meView(A);
  assert.deepEqual(view.recommendations.map((r) => r.dateId), [withBo]);
  assert.ok(!view.topPick || ![cy.id, di.id].includes(view.topPick.targetId), "the top pick is a member");
  assert.ok(view.edgeCity.member && view.edgeCity.question === null);
  // Out of the pool: no recommendations, no top pick, and the question to answer.
  const D = await user(di.id);
  assert.deepEqual(await pendingRecommendations(D), []);
  const dv = await meView(D);
  assert.deepEqual([dv.recommendations, dv.topPick], [[], null]);
  assert.match(dv.edgeCity.question, /Are you at Edge City India/);
  const C = await user(cy.id);
  assert.deepEqual(await pendingRecommendations(C), []);
  assert.match((await meView(C)).edgeCity.question, /waitlist/);
  void withCy; void withDi;
});

test("decide: no new answer and no new match with a non-member; a match made before stays", async () => {
  const withCy = await finishedDate(ana.id, cy.id);
  assert.equal(await decideDate(await user(ana.id), withCy, "meet", WEB), null);
  assert.equal(await decideDate(await user(cy.id), withCy, "meet", WEB), null);
  const d = (await pg.query("select decision_a, decision_b, matched_at from dates where id = $1", [withCy])).rows[0];
  assert.deepEqual([d.decision_a, d.decision_b, d.matched_at], [null, null, null]);
  // Two members: a mutual yes is a match as before.
  const withBo = await finishedDate(ana.id, bo.id);
  assert.equal((await decideDate(await user(ana.id), withBo, "meet", WEB)).match, false);
  assert.equal((await decideDate(await user(bo.id), withBo, "meet", WEB)).match, true);
  // A match Ana made with Di before Edge City only stays on both sides' lists (contacts were already swapped).
  const old = await finishedDate(ana.id, di.id);
  await pg.query("update dates set decision_a = 'meet', decision_b = 'meet', matched_at = now() where id = $1", [old]);
  assert.ok((await meView(await user(ana.id))).matches.some((m) => m.dateId === old));
  assert.ok((await meView(await user(di.id))).matches.some((m) => m.dateId === old));
  const again = await decideDate(await user(di.id), old, "meet", WEB); // repeating an answer on it still works
  assert.equal(again.match, true);
});

test("board and stats: only dates between two members, and only members are counted", async () => {
  await finishedDate(ana.id, bo.id);
  await finishedDate(ana.id, cy.id);
  await finishedDate(vi.id, di.id);
  const quotes = await boardQuotes(10);
  assert.equal(quotes.length, 1);
  // Counters: members only, and only dates and matches between two members (a match made before stays, uncounted).
  const old = await finishedDate(bo.id, di.id);
  await pg.query("update dates set decision_a = 'meet', decision_b = 'meet', matched_at = now() where id = $1", [old]);
  const withVi = await finishedDate(bo.id, vi.id);
  await pg.query("update dates set decision_a = 'meet', decision_b = 'meet', matched_at = now() where id = $1", [withVi]);
  const s = await stats();
  assert.deepEqual([s.agents, s.dates, s.matches], [3, 2, 1]); // Ana, Bo, Vi; Ana-Bo and Bo-Vi; Bo-Vi
});

test("setEdgeCity: the same answer again writes and logs nothing; a change (or new weeks) does", async () => {
  const p = await person("Pat", true);
  const rows = async () => (await pg.query(`select (select count(*)::int from profile_history where user_id = $1 and field like 'edge%') as h,
    (select count(*)::int from activity_log where user_id = $1 and action = 'edge_city') as a,
    (select edge_answered_at from users where id = $1) as at`, [p.id])).rows[0];
  const first = await rows();
  assert.ok(first.at);
  await setEdgeCity(p.id, true, undefined, WEB);
  await setEdgeCity(p.id, true, [], WEB);
  assert.deepEqual(await rows(), first);
  await setEdgeCity(p.id, true, ["week2"], WEB); // new weeks: recorded, but the answer (and its time) is the same
  const weeks = await rows();
  assert.deepEqual([weeks.h, weeks.at.getTime()], [first.h + 1, first.at.getTime()]);
  await setEdgeCity(p.id, true, ["week2"], WEB);
  assert.deepEqual(await rows(), weeks);
  await setEdgeCity(p.id, false, undefined, WEB);
  const no = await rows();
  assert.deepEqual([no.a, no.at > weeks.at], [weeks.a + 1, true]);
  // A member who never answered (a store-app sign-up, edge_answered_at null) saying yes: recorded as the answer.
  await pg.query("update users set edge_city = true, edge_answered_at = null where id = $1", [p.id]);
  await setEdgeCity(p.id, true, undefined, WEB);
  assert.ok((await rows()).at);
});

test("web chat: the \"did you meet?\" check-in still comes for an old match of someone out of the pool; the digest does not", async () => {
  const { syncChat } = await import("./text/web-chat.ts");
  const old = await finishedDate(ana.id, di.id);
  await pg.query("update dates set decision_a = 'meet', decision_b = 'meet', matched_at = now() - interval '2 days' where id = $1", [old]);
  await syncChat({ me: await user(di.id), identity: null, connect: null }, true);
  const asked = await pg.query("select meta from activity_log where user_id = $1 and action = 'checkin_asked'", [di.id]);
  assert.deepEqual(asked.rows.map((r) => r.meta.dateId), [old]);
  const said = (await pg.query(`select m.text from conversation_messages m join user_phones t on t.id = m.phone_id where t.user_id = $1 order by m.id`, [di.id])).rows.map((r) => r.text);
  assert.ok(said.some((b) => /Are you at Edge City India/.test(b)), "Di is asked the question once");
  assert.ok(said.includes(`[checkin date:${old}]`));
  assert.ok(!said.some((b) => /here's your day so far/.test(b)));
});

test("summaries: an agent polling with ?since= still gets the question while unanswered; a \"no\" is told without since only", async () => {
  const { summaryText } = await import("./chat.ts");
  assert.match(summaryText(await meView(await user(di.id), { since: new Date().toISOString() })), /Ask your human first: Are you at Edge City India/);
  assert.match(summaryText(await meView(await user(di.id))), /Ask your human first/);
  assert.doesNotMatch(summaryText(await meView(await user(cy.id), { since: new Date().toISOString() })), /waitlist/);
  assert.match(summaryText(await meView(await user(cy.id))), /waitlist/);
});

test("photos: a recommendation shows a photo only between members; a match always does", async () => {
  const { GET } = await import("../app/api/photos/[id]/route.ts");
  const photoOf = async (id) => (await pg.query(`insert into photos (user_id, pathname, source, width, height) values ($1, 'p.jpg', 'upload', 10, 10) returning id`, [id])).rows[0].id;
  const [boPhoto, cyPhoto] = [await photoOf(bo.id), await photoOf(cy.id)];
  // Photos go to accounts a day old (views.ts seesPhotos).
  await pg.query("update users set created_at = now() - interval '2 days' where id = any($1::uuid[])", [[ana.id, di.id]]);
  const fetchAs = async (token, photoId) => (await GET(new Request(`https://kismet.test/api/photos/${photoId}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: Promise.resolve({ id: photoId }) })).status;
  await finishedDate(ana.id, bo.id);
  const withCy = await finishedDate(ana.id, cy.id);
  assert.equal(await fetchAs(ana.token, boPhoto), 200);
  assert.equal(await fetchAs(ana.token, cyPhoto), 404); // recommended before Cy said no: hidden now
  await pg.query("update dates set decision_a = 'meet', decision_b = 'meet', matched_at = now() where id = $1", [withCy]);
  assert.equal(await fetchAs(ana.token, cyPhoto), 200); // their match from before
});

test("weekly drop: non-members get no drop and no claim (so they can still get this week's once they say yes)", async () => {
  const { releaseWeeklyDrops, dropFor } = await import("./drop-store.ts");
  const now = new Date("2026-10-28T13:45:00Z"); // Wednesday 19:15 India time: this week's drop is due
  const finished = "2026-10-27T10:00:00Z";
  const withBo = await finishedDate(ana.id, bo.id);
  const diBo = await finishedDate(di.id, bo.id);
  await pg.query("update dates set finished_at = $1 where id = any($2::uuid[])", [finished, [withBo, diBo]]);
  const r = await releaseWeeklyDrops(now, 15_000); // under the 20 s plan timeout: template plans, no model call
  assert.equal(r.drop, "2026-10-28T13:30:00.000Z");
  const claims = (await pg.query("select user_id, date_id from drop_claims")).rows;
  assert.deepEqual(claims.map((c) => c.user_id).sort(), [ana.id, bo.id].sort()); // Di: no claim row at all
  assert.ok(claims.every((c) => c.date_id === withBo)); // Bo's drop is Ana, never Di
  assert.deepEqual((await dropFor(await user(di.id), now)).drop, null);
  assert.equal((await dropFor(await user(ana.id), now)).drop.dateId, withBo);
  void diBo;
});

test("weekly drop: a crashed run's claim of someone who since said no is left for when they say yes; a drop that is a match stays", async () => {
  const { releaseWeeklyDrops, dropFor } = await import("./drop-store.ts");
  const now = new Date("2026-10-28T13:45:00Z");
  const key = "2026-10-28T13:30:00.000Z";
  // Cy was claimed for this drop (a run that died before the release), then said no.
  const cyBo = await finishedDate(cy.id, bo.id);
  await pg.query("update dates set finished_at = '2026-10-27T10:00:00Z' where id = $1", [cyBo]);
  await pg.query("insert into drop_claims (user_id, drop_at, date_id) values ($1, $2, $3)", [cy.id, key, cyBo]);
  await releaseWeeklyDrops(now, 15_000);
  const claim = (await pg.query("select date_id from drop_claims where user_id = $1 and drop_at = $2", [cy.id, key])).rows[0];
  assert.equal(claim.date_id, cyBo, "not turned into \"none\" while Cy is out of the pool");
  assert.equal((await pg.query("select drop_a_at, drop_b_at from dates where id = $1", [cyBo])).rows[0].drop_a_at, null);
  assert.equal((await dropFor(await user(cy.id), now)).drop, null);
  // Di's drop from before Edge City only, already a match: still shown with its plan, though Di is out of the pool.
  const old = await finishedDate(di.id, ana.id);
  await pg.query(`update dates set finished_at = '2026-10-27T10:00:00Z', drop_a_at = now(), decision_a = 'meet', decision_b = 'meet', matched_at = now() where id = $1`, [old]);
  await pg.query("insert into drop_claims (user_id, drop_at, date_id) values ($1, $2, $3)", [di.id, key, old]);
  assert.equal((await dropFor(await user(di.id), now)).drop.status, "matched");
});

test("sign-up API: the question is part of the body; a no makes no account and points to the waitlist", async () => {
  const { POST } = await import("../app/api/signup/route.ts");
  const body = (extra) => JSON.stringify({ name: "Eve", telegram: "eve_tg", lookingFor: ["friends"], interests: INTERESTS, agreedToTerms: true, ageConfirmed: true, ...extra });
  const post = async (extra, ip, client = "ios/1.0.0") => POST(new Request("https://kismet.test/api/signup", { method: "POST", body: body(extra),
    headers: { "x-forwarded-for": ip, ...(client ? { "x-kismet-client": client } : {}) } }));
  const before = (await pg.query("select count(*)::int as n from users")).rows[0].n;
  const no = await post({ edgeCity: false }, "203.0.113.1");
  assert.equal(no.status, 403);
  const nj = await no.json();
  assert.equal(nj.error, "edge_city_only");
  assert.match(nj.waitlist, /\/waitlist$/);
  assert.equal((await pg.query("select count(*)::int as n from users")).rows[0].n, before);
  const yes = await post({ edgeCity: "yes", edgeWeeks: ["Week 3"] }, "203.0.113.2");
  assert.equal(yes.status, 201);
  const yj = await yes.json();
  assert.equal(yj.edgeCity, undefined); // nothing to ask
  const made = (await pg.query("select edge_city, edge_weeks, edge_answered_at from users where name = 'Eve' order by created_at desc limit 1")).rows[0];
  assert.deepEqual([made.edge_city, made.edge_weeks, Boolean(made.edge_answered_at)], [true, ["week3"], true]);
  // An agent (no client, no field): the account is made out of the pool, and the reply carries the question.
  const old = await post({ name: "Agentic", telegram: "agentic_tg" }, "203.0.113.3", null);
  assert.equal(old.status, 201);
  const oj = await old.json();
  assert.equal(oj.edgeCity.member, false);
  assert.match(oj.edgeCity.question, /Are you at Edge City India/);
  // ...answered later with POST /api/me/edge-city (Bearer, as the apps and agents call it).
  const edge = await import("../app/api/me/edge-city/route.ts");
  const auth = { authorization: `Bearer ${oj.token}`, "content-type": "application/json" };
  assert.equal((await edge.POST(new Request("https://kismet.test/api/me/edge-city", { method: "POST", headers: auth, body: "{}" }))).status, 400);
  const r = await edge.POST(new Request("https://kismet.test/api/me/edge-city", { method: "POST", headers: auth, body: JSON.stringify({ edgeCity: true, weeks: ["week2", "week3"] }) }));
  const rj = await r.json();
  assert.deepEqual([r.status, rj.member, rj.weeks, rj.question], [200, true, ["week2", "week3"], null]);
  assert.deepEqual(await (await edge.GET(new Request("https://kismet.test/api/me/edge-city", { headers: auth }))).json(), { member: true, answered: true, weeks: ["week2", "week3"], question: null });
});

test("Agent Village: residents are members by definition, also an account that said no or was never asked", async () => {
  const { POST } = await import("../app/api/village/[op]/route.ts");
  const call = (op, body) => POST(new Request(`https://kismet.test/api/village/${op}`, { method: "POST", headers: { authorization: `Bearer ${process.env.VILLAGE_PARTNER_KEY}` }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ op }) });
  const s = await call("signup", { residentId: "resident-new", telegram: "newbie_tg", answers: { name: "Nu", lookingFor: ["friends"], interests: INTERESTS, agreedToTerms: true, ageConfirmed: true } });
  assert.equal(s.status, 201);
  assert.equal((await pg.query("select edge_city from users where village_resident = $1", [residentKey("resident-new")])).rows[0].edge_city, true);
  await pg.query("update users set edge_city = null where id = $1", [vi.id]);
  assert.equal((await call("summary", { residentId: "resident-vi" })).status, 200);
  assert.equal((await user(vi.id)).edgeCity, true);
});

test("migration: idempotent; village and App Review demo accounts become members, everyone else is asked; answers are kept", async () => {
  // Accounts as they were before this column existed (null), on top of everyone above.
  const legacy = async (name, telegram, extra = "") => (await pg.query(`insert into users (token_hash, name, telegram, looking_for, signup_channel ${extra ? ", village_resident" : ""})
    values (md5(random()::text), $1, $2, '{friends}', $3 ${extra ? ", $4" : ""}) returning id`, extra ? [name, telegram, "village", extra] : [name, telegram, "web"])).rows[0].id;
  const oldVillage = await legacy("Old Village", "old_village", "hash-old-village");
  const demo = await legacy("Sam (demo)", "kismet_review_demo");
  // The App Review accounts are users.is_demo (flagged once by the demo migration, lib/demo.ts); a look-alike is not.
  await pg.query("update users set is_demo = true where id = $1", [demo]);
  const fakeDemo = await legacy("Sam (demo)", "someone_else"); // only the real demo accounts
  const web = await legacy("Old Web", "old_web");
  // A sign-up from App Store build 2 (no question in the app): a member, like its new sign-ups (lib/edge-city.ts).
  const ios = await legacy("Old iOS", "old_ios");
  await pg.query("update users set signup_channel = 'ios' where id = $1", [ios]);
  const n = schemaStatements().length;
  await migrate(pg);
  await migrate(pg); // run twice: nothing changes the second time, nothing fails
  const edge = async (id) => (await pg.query("select edge_city from users where id = $1", [id])).rows[0].edge_city;
  assert.deepEqual([await edge(oldVillage), await edge(demo), await edge(fakeDemo), await edge(web), await edge(ios)], [true, true, null, null, true]);
  assert.deepEqual([await edge(ana.id), await edge(cy.id), await edge(di.id)], [true, false, null]); // answers are never overwritten
  assert.equal(schemaStatements().length, n);
});


test("sign-up API: a store app that leaves the question out (App Store build 2, App Review) signs up a member, not stranded", async () => {
  const { POST } = await import("../app/api/signup/route.ts");
  const post = async (name, client, ip, extra = {}, headers = {}) => POST(new Request("https://kismet.test/api/signup", {
    method: "POST", headers: { "x-forwarded-for": ip, ...(client ? { "x-kismet-client": client } : {}), ...headers },
    body: JSON.stringify({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: INTERESTS, agreedToTerms: true, ageConfirmed: true, ...extra }),
  }));
  const row = async (name) => (await pg.query("select id, edge_city, edge_answered_at, signup_channel from users where name = $1", [name])).rows[0];
  for (const [name, client] of [["Ios", "ios/1.0.0"], ["Imsg", "imessage/1.0.0"], ["Droid", "android/1.2"], ["Bare", "iOS"]]) {
    const res = await post(name, client, `198.51.100.${name.length}`);
    assert.equal(res.status, 201, name);
    assert.equal((await res.json()).edgeCity, undefined, `${name}: nothing to ask`);
    const r = await row(name);
    // A member, but not an answer: edge_answered_at stays null (lib/edge-city.ts signupEdgeCity).
    assert.deepEqual([r.edge_city, r.edge_answered_at], [true, null], name);
    assert.ok((await poolOthers(ana.id)).some((u) => u.id === r.id), `${name} is in the pool`);
  }
  // The body's client counts too ("client": "ios/1.0.0"), and an explicit no from an app is still a no.
  assert.equal((await post("Bodyc", null, "198.51.100.20", { client: "ios/1.0.0" })).status, 201);
  assert.equal((await row("Bodyc")).edge_city, true);
  assert.equal((await post("Nope", "ios/1.0.0", "198.51.100.21", { edgeCity: false })).status, 403);
  // An answer that can't be read ("not sure") is refused, never taken as left out (which an app would turn into a yes).
  for (const [name, v] of [["Unsure", "not sure"], ["Maybe", "maybe"]]) {
    const res = await post(name, "ios/1.0.0", `198.51.100.2${name.length}`, { edgeCity: v });
    assert.equal(res.status, 400, name);
    assert.match((await res.json()).error, /edgeCity: answer true/);
    assert.equal(await row(name), undefined);
  }
  assert.equal(await row("Nope"), undefined);
  // The website and agents are still asked.
  const web = await post("Webby", "web", "198.51.100.22");
  assert.equal((await web.json()).edgeCity.member, false);
  assert.equal((await row("Webby")).edge_city, null);
  // Their "why no dates" names where to answer.
  const { reserveDates: reserve } = await import("./engine.ts");
  assert.match((await reserve(await user((await row("Webby")).id), "cap-webby")).reason, /Are you at Edge City India\?" first \(at https?:\/\/\S+\/home\)/);
});

test("sign-up API: a real demo sign-up (the server's demo key) is a member without the question", async () => {
  process.env.DEMO_SIGNUP_KEY = "test-demo-key-0123456789abcdef";
  const { POST } = await import("../app/api/signup/route.ts");
  const res = await POST(new Request("https://kismet.test/api/signup", {
    method: "POST", headers: { "x-forwarded-for": "198.51.100.30", "x-kismet-demo-key": process.env.DEMO_SIGNUP_KEY },
    body: JSON.stringify({ name: "Leo (demo)", telegram: "leo_demo_kismet", lookingFor: ["friends"], interests: INTERESTS, agreedToTerms: true, ageConfirmed: true }),
  }));
  assert.equal(res.status, 201);
  const r = (await pg.query("select edge_city, is_demo from users where telegram = 'leo_demo_kismet'")).rows[0];
  assert.deepEqual([r.edge_city, r.is_demo], [true, true]);
});

test("PATCH /api/me with edgeCity answers it like POST /api/me/edge-city: logged once, and a yes starts dates", async () => {
  const { PATCH } = await import("../app/api/me/route.ts");
  const pia = await person("Pia", undefined);
  const patch = (b) => PATCH(new Request("https://kismet.test/api/me", { method: "PATCH", headers: { authorization: `Bearer ${pia.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Pia", telegram: "pia_tg", lookingFor: ["friends"], interests: INTERESTS, ...b }) }));
  assert.equal((await patch({ edgeCity: true, edgeWeeks: ["week3"] })).status, 200);
  const u = await user(pia.id);
  assert.deepEqual([u.edgeCity, u.edgeWeeks], [true, ["week3"]]);
  const logged = async () => (await pg.query("select meta from activity_log where user_id = $1 and action = 'edge_city'", [pia.id])).rows.map((r) => r.meta);
  assert.deepEqual(await logged(), [{ member: true }]);
  assert.ok((await pg.query("select count(*)::int as n from dates where $1 in (a_id, b_id)", [pia.id])).rows[0].n > 0, "dates started");
  assert.equal((await patch({ edgeCity: true, bio: "Surfs." })).status, 200); // the same answer again: nothing logged
  assert.deepEqual(await logged(), [{ member: true }]);
  assert.equal((await user(pia.id)).bio, "Surfs.");
  // Weeks alone change only the weeks; an empty list with the answer clears them; a no is logged and stops nothing else.
  assert.equal((await patch({ edgeWeeks: ["week1"] })).status, 200);
  assert.deepEqual([(await user(pia.id)).edgeCity, (await user(pia.id)).edgeWeeks], [true, ["week1"]]);
  assert.equal((await patch({ edgeCity: true, edgeWeeks: [] })).status, 200);
  assert.deepEqual((await user(pia.id)).edgeWeeks, []);
  assert.equal((await patch({ edgeCity: false })).status, 200);
  assert.equal((await user(pia.id)).edgeCity, false);
  assert.deepEqual(await logged(), [{ member: true }, { member: false }]);
});

test("QA6 Q6-L2: outside the pool, no drop and no agent chats are promised; the next step is to answer the question", async () => {
  const { summaryText } = await import("./chat.ts");
  const { dropFor } = await import("./drop-store.ts");
  const { dropAsk } = await import("./copy.ts");
  const { dropsLeft } = await import("./drop.ts");
  for (const id of [di.id, cy.id]) {
    const v = await meView(await user(id));
    assert.equal(v.weekly, null, "no next-drop label for home or the apps");
    assert.doesNotMatch(summaryText(v), /agent chats left|Weekly drop|arrives/);
  }
  assert.equal((await meView(await user(ana.id))).dropAsk, null);
  // /home, just under the question (not asked yet) or the "Yes, I'm here" button (said no); the summary only after the question.
  const left = dropsLeft();
  const diView = await meView(await user(di.id));
  assert.equal(diView.dropAsk, dropAsk({ answered: false, dropsLeft: left, where: "above" }));
  const di1 = summaryText(diView);
  assert.ok(di1.indexOf(diView.dropAsk) > di1.indexOf("Ask your human first"), di1);
  const cyView = await meView(await user(cy.id));
  assert.match(cyView.dropAsk, /^If you are at Edge City India after all, tap "Yes, I'm here" above/);
  assert.doesNotMatch(summaryText(cyView), /above/, "a \"no\" is told about the waitlist, with no question above");
  // A member still gets the count.
  assert.match(summaryText(await meView(await user(ana.id))), /\/3 agent chats left today\./);
  // The wording: the next drop only while one is still to come.
  assert.equal(dropAsk({ answered: false, dropsLeft: true, where: "above" }), "Answer the question above to be in the next drop.");
  assert.equal(dropAsk({ answered: false, dropsLeft: false, where: "above" }), "Answer the question above and your agent gets back to meeting people.");
  // GET /api/me/drop: Thursday evening (a drop to come) and Saturday (the last one went out on Friday).
  const thu = new Date("2026-10-29T14:00:00Z"), sat = new Date("2026-10-31T06:00:00Z");
  assert.equal(dropsLeft(thu), true);
  assert.equal(dropsLeft(sat), false);
  const member = await dropFor(await user(ana.id), thu);
  assert.ok(member.schedule && member.nextDropAt);
  assert.equal(member.weeklyDrop, true);
  assert.equal(typeof member.lastDrop, "boolean");
  assert.match(member.scheduleText, /^The next drop is /);
  for (const [now, next] of [[thu, true], [sat, false]]) {
    const d = await dropFor(await user(di.id), now);
    assert.deepEqual([d.drop, d.schedule, d.nextDropAt], [null, null, null]);
    // QA7: and nothing else says a drop is coming: nothing held for them, no "last drop" (agent docs, section 3).
    assert.deepEqual([d.weeklyDrop, d.lastDrop], [false, null]);
    assert.equal(d.scheduleText, `Answer "Are you at Edge City India?" first (POST /api/me/edge-city) ${next ? "to be in the next drop" : "and your agent gets back to meeting people"}.`);
    const c = await dropFor(await user(cy.id), now);
    assert.deepEqual([c.drop, c.schedule, c.nextDropAt, c.weeklyDrop, c.lastDrop], [null, null, null, false, null]);
    assert.doesNotMatch(c.scheduleText, /drop|above/);
  }
});

test("QA7: /home shows no \"Send my agent\" button or chat count outside the pool, the question takes their place", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/home.tsx", import.meta.url), "utf8");
  // The button and the count sit inside the one member-only block, and the question follows it.
  const gate = /\{me\.edgeCity\.member && \(\s*<>[\s\S]*?"Send my agent to meet people"[\s\S]*?agent chats left today[\s\S]*?<\/>\s*\)\}/.exec(src);
  assert.ok(gate, "both inside {me.edgeCity.member && (<>...</>)}");
  assert.equal(src.split('"Send my agent to meet people"').length, 2, "one such button");
  assert.ok(src.indexOf("<EdgeCityAsk") > gate.index + gate[0].length);
  // Non-members get no top pick to chat with either (views.ts), so no other button starts agent chats for them.
  for (const id of [di.id, cy.id]) assert.equal((await meView(await user(id))).topPick, null);
});
