// Run: npm test. Demo accounts (lib/demo.ts), end to end on a real Postgres (PGlite, in memory) with db/schema.sql
// applied: App Review's demo accounts only ever date, are recommended, dropped, matched and shown with each other, never
// with real residents (and the reverse), stay off the public board and counters, and can't be auto-hidden by reports
// from real residents. Also the migration that flags the demo accounts from before.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrate } from "./test-support/pg.mjs";

process.env.KISMET_WEEKLY_DROP = "on";
process.env.DEMO_SIGNUP_KEY = "test-demo-key-0123456789abcdef";
const pg = await freshDb();
const { insertUser, decideDate, reportDate } = await import("./actions.ts");
const { visibleOthers, boardQuotes, stats, toUser } = await import("./db.ts");
const { reserveDates, sideOf } = await import("./engine.ts");
const { meView, pendingRecommendations } = await import("./views.ts");
const { parseProfile } = await import("./validate.ts");
const { isDemoProfile, reservedForDemo, DEMO_HANDLES } = await import("./demo.ts");
const { releaseWeeklyDrops } = await import("./drop-store.ts");
const { neonDm } = await import("./dm-store.ts");
const signup = await import("../app/api/signup/route.ts");

const WEB = { channel: "web", client: "" };
const INTERESTS = ["AI", "Surfing/beach", "Music", "Books"];

async function person(name, telegram, demo = false) {
  const r = parseProfile({ name, telegram, lookingFor: ["friends"], interests: INTERESTS, publicQuotes: true, edgeCity: true });
  assert.ok(r.profile, r.error);
  return (await insertUser(r.profile, WEB, null, [], null, { demo })).id;
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const verdict = (meet) => JSON.stringify({ score: 8, meet, reason: "You both surf at dawn.", bestLine: "Dawn patrol and then chai?", suggestedMeetup: "Chai at The Circle" });
/** A finished friendly date where both agents recommend meeting (finished in the pool of the 28 Oct drop). */
async function finishedDate(a, b) {
  const key = [a, b].sort().join(":");
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, '2026-10-27T10:00:00Z') returning id`, [key, a, b, verdict(true)]);
  return rows[0].id;
}

// Real residents John and Ana; App Review's Sam (demo) and Maya (demo).
const john = await person("John", "john_real");
const ana = await person("Ana", "ana_real");
const sam = await person("Sam (demo)", "kismet_review_demo", true);
const maya = await person("Maya (demo)", "maya_demo_kismet", true);

afterEach(() => pg.exec("delete from dates; delete from drop_claims; delete from reports; delete from blocks; delete from rate_limits; delete from date_log; update users set hidden_at = null;"));

test("isDemoProfile: only the demo handles with a (demo) name, compared folded", () => {
  assert.equal(DEMO_HANDLES.length, 6);
  assert.equal(isDemoProfile({ name: "Sam (demo)", telegram: "kismet_review_demo" }), true);
  assert.equal(isDemoProfile({ name: "Sam", telegram: "kismet_review_demo" }), false, "the name must say (demo)");
  assert.equal(isDemoProfile({ name: "Sam (demo)", telegram: "sam_real" }), false, "a real handle is never a demo");
  assert.equal(isDemoProfile({ name: "Sam (Demo)", telegram: "Kismet_Review_Demo" }), true, "case does not matter");
});

test("N-L3: the reserved demo name or handle is refused however it is cased, spaced or punctuated; real names are not", () => {
  const sam = (name, telegram = "sam_real_1") => reservedForDemo({ name, telegram });
  for (const name of ["Sam (demo)", "Sam (Demo)", "SAM (DEMO)", "Sam\u00a0(demo)", "Sam  (demo)", "Sam (demo).", "Sam （demo）", "Sam ( demo )", "Sam (dеmo)", "(demo) Sam"]) {
    assert.equal(sam(name), true, JSON.stringify(name));
  }
  for (const telegram of ["kismet_review_demo", "KISMET_REVIEW_DEMO", "@Maya_Demo_Kismet"]) assert.equal(sam("Sam", telegram), true, telegram);
  for (const name of ["Sam", "Demo Dan", "Samdemo", "Sam demo", "Sam (demolition crew)"]) assert.equal(sam(name), false, name);
  assert.equal(reservedForDemo({ name: "Sam (demo)", telegram: "kismet_review_demo" }, true), false, "a demo account keeps its own");
});

test("sign-up: a demo name and handle alone never make a demo account; only the server's demo key does", async () => {
  assert.deepEqual([(await user(sam)).isDemo, (await user(maya)).isDemo], [true, true]);
  assert.deepEqual([(await user(john)).isDemo, (await user(ana)).isDemo], [false, false]);
  const body = (name, telegram) => JSON.stringify({ name, telegram, lookingFor: ["friends"], interests: INTERESTS, ageConfirmed: true, agreedToTerms: true });
  const post = (b, headers = {}) => signup.POST(new Request("https://kismet.test/api/signup", { method: "POST", headers: { "x-real-ip": "203.0.113.50", "x-kismet-client": "ios/1.0", ...headers }, body: b }));
  // Eve types App Review's name pattern and handle: refused, so she can't reach Sam, and nothing is created.
  for (const headers of [{}, { "x-kismet-demo-key": "wrong-key-0123456789abcdefgh" }]) {
    const res = await post(body("Eve (demo)", "kismet_review_demo"), headers);
    assert.equal(res.status, 403);
  }
  assert.equal((await pg.query("select count(*)::int as n from users where name = 'Eve (demo)'")).rows[0].n, 0);
  // QA2 N-L3: the bypasses that got through live, and either half alone, are refused too.
  for (const [name, tg] of [["Sam (demo)", "KISMET_REVIEW_DEMO"], ["Sam\u00a0(demo)", "kismet_review_demo"], ["Sam (Demo)", "sam_real_9"], ["Sam (demo).", "sam_real_9"],
    ["Sam （demo）", "sam_real_9"], ["Sam", "kismet_review_demo"]]) {
    assert.equal((await post(body(name, tg))).status, 403, `${name} / ${tg}`);
  }
  assert.equal((await pg.query("select count(*)::int as n from users where (telegram ilike '%demo%' or name ilike '%demo%') and not is_demo")).rows[0].n, 0, "no real account with a demo name or handle");
  // demo_review.py with the key: a demo account.
  const ok = await post(body("Leo (demo)", "leo_demo_kismet"), { "x-kismet-demo-key": process.env.DEMO_SIGNUP_KEY });
  assert.equal(ok.status, 201);
  const leo = (await pg.query("select id, is_demo from users where name = 'Leo (demo)'")).rows[0];
  assert.equal(leo.is_demo, true);
  // An ordinary sign-up is never a demo, key or not.
  assert.equal((await post(body("Kai", "kai_real_1"), { "x-kismet-demo-key": process.env.DEMO_SIGNUP_KEY })).status, 201);
  assert.equal((await pg.query("select is_demo from users where name = 'Kai'")).rows[0].is_demo, false);
  await pg.query("delete from users where name in ('Leo (demo)', 'Kai')");
});

test("the demo name and handle are refused on profile edits (API and text) and text sign-ups; a demo account keeps its own", async (ctx) => {
  const me = await import("../app/api/me/route.ts");
  const { app } = await import("./text/runtime.ts");
  ctx.after(() => pg.query("delete from users where name in ('Kai', 'Kai (demo)', 'Priya (demo)')"));
  const kai = await insertUser(parseProfile({ name: "Kai", telegram: "kai_real_2", lookingFor: ["friends"], interests: INTERESTS, edgeCity: true }).profile, WEB);
  const patch = (token, b) => me.PATCH(new Request("https://kismet.test/api/me", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b) }));
  const profile = (name, telegram) => ({ name, telegram, lookingFor: ["friends"], interests: INTERESTS });
  const res = await patch(kai.token, profile("Sam (demo)", "kismet_review_demo"));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /reserved for Kismet's demo accounts/);
  assert.deepEqual([(await user(kai.id)).name, (await user(kai.id)).telegram], ["Kai", "kai_real_2"]);
  assert.equal((await patch(kai.token, profile("Kai (demo)", "kai_real_2"))).status, 403, "a (demo) name alone is reserved too");
  assert.equal((await patch(kai.token, profile("Kai", "KISMET_REVIEW_DEMO"))).status, 403, "and a demo handle alone, in any case");
  // Text chat (WhatsApp and the website): EDIT, one field at a time, into the pair is refused; the sign-up too.
  const thread = { id: "00000000-0000-4000-8000-000000000001", channel: "web", phone: `web:u:${kai.id}`, draft: {} };
  assert.match(await app.edit(thread, kai.id, "telegram", "kismet_review_demo"), /That didn't work: that name and Telegram username are reserved/);
  assert.equal((await user(kai.id)).telegram, "kai_real_2");
  const viaText = await app.signup(thread, "00000000-0000-4000-8000-0000000000aa", { ...profile("Maya (demo)", "maya_demo_kismet"), ageConfirmed: true, agreedToTerms: true }, [], "telegram");
  assert.match(viaText.error, /reserved for Kismet's demo accounts/);
  assert.equal((await pg.query("select count(*)::int as n from users where id = '00000000-0000-4000-8000-0000000000aa'")).rows[0].n, 0);
  // A demo account editing its own profile keeps the demo name and handle (API and text).
  const priya = await insertUser(parseProfile({ ...profile("Priya (demo)", "priya_demo_kismet"), edgeCity: true }).profile, WEB, null, [], null, { demo: true });
  assert.equal((await patch(priya.token, { ...profile("Priya (demo)", "priya_demo_kismet"), bio: "Demo bio" })).status, 200);
  assert.match(await app.edit(thread, priya.id, "bio", "A new demo bio"), /^Updated\./);
  assert.equal((await user(priya.id)).isDemo, true);
});

test("migration: flags the existing demo accounts once, by exact handle and (demo) name; later runs never flag anyone", async () => {
  // As on production: no is_demo column yet, Sam and Maya made before the migration.
  await pg.exec("alter table users drop column is_demo");
  await pg.query("update users set created_at = '2026-10-20T00:00:00Z' where id = any($1::uuid[])", [[sam, maya]]);
  // Look-alikes that must stay real: a demo handle without "(demo)", "(demo)" with a real handle, and a demo name and
  // handle on an account made after the cutoff.
  const { rows } = await pg.query(`insert into users (token_hash, name, telegram, looking_for, created_at) values
    ('t1', 'Leo', 'leo_demo_kismet', '{friends}', '2026-10-20'), ('t2', 'Kai (demo)', 'kai_real', '{friends}', '2026-10-20'),
    ('t3', 'Eve (demo)', 'zara_demo_kismet', '{friends}', '2026-11-03') returning id`);
  await migrate(pg);
  const flagged = async () => (await pg.query("select name from users where is_demo order by name")).rows.map((r) => r.name);
  assert.deepEqual(await flagged(), ["Maya (demo)", "Sam (demo)"]);
  // An old real account renamed to a demo name and handle afterwards: the next migrations leave it real.
  await pg.query("update users set name = 'Zed (demo)', telegram = 'arjun_demo_kismet', created_at = '2026-10-20' where id = $1", [rows[0].id]);
  await migrate(pg);
  await migrate(pg);
  assert.deepEqual(await flagged(), ["Maya (demo)", "Sam (demo)"]);
  await pg.query("delete from users where id = any($1::uuid[])", [rows.map((r) => r.id)]);
});

test("visibleOthers: demo accounts see only demo accounts, real residents never see them", async () => {
  assert.deepEqual((await visibleOthers(john)).map((u) => u.name).sort(), ["Ana"]);
  assert.deepEqual((await visibleOthers(sam)).map((u) => u.name).sort(), ["Maya (demo)"]);
});

test("dates: a demo account never dates a real resident, either way, even asked for by id", async () => {
  const S = await user(sam);
  const J = await user(john);
  assert.deepEqual((await reserveDates(S, "cap-sam-1", john)).ids, []);
  assert.deepEqual((await reserveDates(J, "cap-john-1", sam)).ids, []);
  const fromSam = await reserveDates(S, "cap-sam-2");
  const fromJohn = await reserveDates(J, "cap-john-2");
  const pairs = (await pg.query("select a_id, b_id from dates")).rows;
  assert.ok(fromSam.ids.length && fromJohn.ids.length, "both still date within their own pool");
  for (const d of pairs) {
    const demo = await Promise.all([user(d.a_id), user(d.b_id)]).then((us) => us.map((u) => u.isDemo));
    assert.equal(demo[0], demo[1], "never a demo account with a real resident");
  }
});

test("an existing demo <-> real date is never shown, decided, dropped, chatted on or put on the board", async () => {
  const cross = await finishedDate(sam, john);
  const demoPair = await finishedDate(sam, maya);
  const realPair = await finishedDate(john, ana);
  const S = await user(sam);
  const J = await user(john);
  assert.deepEqual((await pendingRecommendations(S)).map((r) => r.dateId), [demoPair]);
  assert.deepEqual((await pendingRecommendations(J)).map((r) => r.dateId), [realPair]);
  const sv = await meView(S);
  assert.deepEqual(sv.recommendations.map((r) => r.name), ["Maya (demo)"]);
  assert.notEqual(sv.topPick?.name, "John");
  assert.ok(!(await meView(J)).recommendations.some((r) => r.name === "Sam (demo)"));
  // Saying yes on both sides never makes a cross match.
  assert.equal(await decideDate(S, cross, "meet", WEB), null);
  assert.equal(await decideDate(J, cross, "meet", WEB), null);
  assert.equal((await pg.query("select matched_at from dates where id = $1", [cross])).rows[0].matched_at, null);
  // A chat between the two is treated as blocked.
  assert.equal(await neonDm.blocked(sam, john), true);
  assert.equal(await neonDm.blocked(sam, maya), false);
  // The weekly drop (Wed 28 Oct, 19:30 India time): each gets a date from their own side only.
  await releaseWeeklyDrops(new Date("2026-10-28T14:00:00Z"), 15_000);
  const claims = Object.fromEntries((await pg.query("select user_id, date_id from drop_claims")).rows.map((r) => [r.user_id, r.date_id]));
  assert.equal(claims[sam], demoPair);
  assert.equal(claims[john], realPair);
  assert.ok(!Object.values(claims).includes(cross));
});

test("N-L4: a leftover demo <-> real date (even a match) can't be blocked or reported across the line, either way", async () => {
  const { blockDate, reportDate } = await import("./actions.ts");
  const cross = await finishedDate(sam, john);
  await pg.query("update dates set decision_a = 'meet', decision_b = 'meet', matched_at = now() where id = $1", [cross]);
  const demoPair = await finishedDate(sam, maya);
  const S = await user(sam);
  const J = await user(john);
  assert.equal(await blockDate(S, cross, WEB), null, "demo blocks real");
  assert.equal(await blockDate(J, cross, WEB), null, "real blocks demo");
  assert.equal(await reportDate(J, cross, "spam", "x", WEB), null, "real reports demo");
  assert.equal(await reportDate(S, cross, "fake", "y", WEB), null, "demo reports real");
  assert.equal((await pg.query("select count(*)::int as n from reports")).rows[0].n, 0);
  assert.equal((await pg.query("select count(*)::int as n from blocks")).rows[0].n, 0);
  // On their own side it works as before.
  assert.equal((await blockDate(S, demoPair, WEB))?.blocked, true);
});

test("board and counters: real residents only", async () => {
  await finishedDate(sam, maya);
  await finishedDate(sam, john);
  const real = await finishedDate(john, ana);
  await pg.query("update dates set matched_at = now()");
  assert.deepEqual(await stats().then(({ agents, dates, matches }) => ({ agents, dates, matches })), { agents: 2, dates: 1, matches: 1 });
  const quotes = await boardQuotes(10);
  assert.equal(quotes.length, 1);
  assert.ok(real);
});

test("auto-hide: reports from real residents never hide a demo account; real reports still hide a real one", async () => {
  const reporters = [];
  for (const n of ["Rae", "Ola", "Ivo"]) reporters.push(await person(n, `${n.toLowerCase()}_real`));
  await pg.query("update users set created_at = now() - interval '3 days' where id = any($1::uuid[])", [reporters]);
  for (const r of reporters) {
    const toSam = await finishedDate(r, sam);
    const toAna = await finishedDate(r, ana);
    const R = await user(r);
    assert.equal(await reportDate(R, toSam, "spam", "", WEB), null, "refused across the demo line (N-L4)");
    // One filed before that check (a raw row) still never counts toward a hide.
    await pg.query("insert into reports (reporter_id, reported_id, date_id, reason) values ($1, $2, $3, 'spam')", [r, sam, toSam]);
    assert.ok(await reportDate(R, toAna, "spam", "", WEB));
  }
  const { hideOnHistory } = await import("./report-history.ts");
  await hideOnHistory(sam, []);
  assert.equal((await user(sam)).hiddenAt, null, "App Review's demo stays up");
  assert.notEqual((await user(ana)).hiddenAt, null, "three real reporters still hide a real resident");
  await pg.query("delete from users where id = any($1::uuid[])", [reporters]);
});

test("scripts/demo-cleanup.mjs: a dry run changes nothing; --apply deletes only demo <-> real dates, once", async () => {
  const { demoCleanup, DEMO_HANDLES: scriptHandles } = await import("../../scripts/demo-cleanup.mjs");
  assert.deepEqual(scriptHandles, [...DEMO_HANDLES], "the script and the app agree on who is a demo account");
  const query = async (text, params) => (await pg.query(text, params)).rows;
  const cross = await finishedDate(sam, john);
  const keepDemo = await finishedDate(sam, maya);
  const keepReal = await finishedDate(john, ana);
  await pg.query("insert into messages (date_id, sender_id, text) values ($1, $2, 'hi')", [cross, john]);
  // John's weekly drop was this cross date and went out to him; Sam's claim on it was never released.
  await pg.query("update dates set drop_a_at = case when a_id = $2 then now() end, drop_b_at = case when b_id = $2 then now() end where id = $1", [cross, john]);
  await pg.query("insert into drop_claims (user_id, drop_at, date_id) values ($1, '2026-10-28T13:30:00Z', $3), ($2, '2026-10-28T13:30:00Z', $3)", [john, sam, cross]);
  const lines = [];
  const dry = await demoCleanup(query, { log: (l) => lines.push(l) });
  assert.deepEqual(dry, { found: 1, removed: 0, ids: [cross] });
  assert.ok(!lines.join("\n").includes("John"), "real residents are never printed by name");
  assert.equal((await pg.query("select count(*)::int as n from dates")).rows[0].n, 3, "dry run deletes nothing");
  const done = await demoCleanup(query, { apply: true, log: () => {} });
  assert.deepEqual(done, { found: 1, removed: 1, ids: [cross] });
  assert.deepEqual((await pg.query("select id from dates order by id")).rows.map((r) => r.id).sort(), [keepDemo, keepReal].sort());
  assert.equal((await pg.query("select count(*)::int as n from messages")).rows[0].n, 0);
  const claims = Object.fromEntries((await pg.query("select user_id, date_id from drop_claims")).rows.map((r) => [r.user_id, r.date_id]));
  assert.deepEqual(claims, { [john]: null }, "John keeps his (released) claim, so no second drop this week; Sam is picked again");
  assert.deepEqual(await demoCleanup(query, { apply: true, log: () => {} }), { found: 0, removed: 0, ids: [] });
});

test("N-L7: a bio stored before stripContacts caught its form is scrubbed when a recommendation card shows it", async () => {
  const bob = await person("Bob", "bob_real_7");
  await pg.query("update users set bio = 'Surfer. tg deexy' where id = $1", [bob]); // stored by an older build, as written
  const d = await finishedDate(john, bob);
  const card = (await meView(await user(john))).recommendations.find((r) => r.dateId === d);
  assert.ok(card, "recommended");
  assert.equal(card.summary, "Surfer. [removed]", "the card's summary");
  const chat = (await pendingRecommendations(await user(john))).find((r) => r.dateId === d);
  assert.equal(chat.about.bio, "Surfer.", "the chat's about (lib/about.ts, as before)");
  await pg.query("delete from users where id = $1", [bob]);
});

test("QA3 S3-1: before the persona card exists, a stored bio reaches the other agent's date only without its contact", async () => {
  const bob = await person("Bob", "bob_real_8");
  // Stored by an older build, as written: a mid-sentence handle, an app-name chip next to a handle chip, no card yet.
  await pg.query("update users set bio = 'Hit me up deexy on insta', interests = $2, tags = '{}', persona_card = '' where id = $1",
    [bob, ["telegram", "deex_99", "surfing"]]);
  const side = sideOf(await user(bob), "friendly");
  assert.equal(side.card, "Hit me up [removed]");
  assert.deepEqual(side.tags, ["surfing"], "tags fall back to the interests, without the app name and its handle");
  await pg.query("update users set bio = '' where id = $1", [bob]);
  assert.equal(sideOf(await user(bob), "friendly").card, "Bob likes surfing.");
  const d = await finishedDate(john, bob);
  const card = (await meView(await user(john))).recommendations.find((r) => r.dateId === d);
  assert.deepEqual(card.interests, ["surfing"], "the recommendation card's chips");
  assert.equal(card.summary, "surfing");
  const chat = (await pendingRecommendations(await user(john))).find((r) => r.dateId === d);
  assert.deepEqual(chat.about.interests, ["surfing"], "the chat's about");
  await pg.query("delete from users where id = $1", [bob]);
});
