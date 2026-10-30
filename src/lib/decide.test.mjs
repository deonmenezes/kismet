// Run: npm test. Answering a recommendation (lib/actions.ts decideDate) on a real Postgres (PGlite, in memory): the answer,
// matched_at and the confirmed weekly-drop plan are written by one statement, the match is announced exactly once, and a
// pass or a lone yes never makes a match.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
const { insertUser, decideDate } = await import("./actions.ts");
const { toUser } = await import("./db.ts");
const { parseProfile } = await import("./validate.ts");
const { rollForward, planText } = await import("./drop.ts");

const WEB = { channel: "web", client: "" };
async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], edgeCity: true });
  return (await insertUser(r.profile, WEB)).id;
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const v = JSON.stringify({ score: 8, meet: true, reason: "Good chat.", bestLine: "Chai?", suggestedMeetup: "Chai at Riva" });
// A weekly-drop proposal for A (its time well ahead, and before the event ends).
const PLAN = { at: "2026-10-31T12:00:00.000Z", day: "Sat 31 Oct", time: "5:30 pm", part: "sunset", venueId: "mandrem-sunset", place: "Mandrem Beach", activity: "a sunset walk on Mandrem Beach", why: "You both love books.", source: "template", dropKey: "2026-10-28T13:30:00.000Z" };

const ana = await person("Ana");
const bo = await person("Bo");
async function date(planA = null) {
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at, plan_a, drop_a_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now(), $5::jsonb, $6) returning id`,
  [[ana, bo].sort().join(":"), ana, bo, v, planA && JSON.stringify(planA), planA && "2026-10-28T13:30:00Z"]);
  return rows[0].id;
}
const row = async (id) => (await pg.query("select matched_at, plan, plan_confirmed_at, decision_a, decision_b from dates where id = $1", [id])).rows[0];
const matchLogs = async (id) => (await pg.query("select count(*)::int as n from activity_log where action = 'match' and meta->>'dateId' = $1", [id])).rows[0].n;
afterEach(() => pg.exec("delete from dates; delete from activity_log;"));

test("the second yes makes the match, its matched_at and the confirmed plan together, announced once", async () => {
  const id = await date(PLAN);
  const first = await decideDate(await user(ana), id, "meet", WEB);
  assert.equal(first.match, false);
  assert.equal((await row(id)).matched_at, null);
  const second = await decideDate(await user(bo), id, "meet", WEB);
  assert.equal(second.match, true);
  const r = await row(id);
  assert.ok(r.matched_at, "matched_at in the same statement as the answer");
  // The proposal as of now (no plan once the event is over: lib/drop.ts rollForward).
  const expected = rollForward(PLAN, new Date());
  assert.equal(Boolean(r.plan_confirmed_at), Boolean(expected));
  assert.equal(r.plan?.day ?? null, expected?.day ?? null);
  assert.equal(second.plan, expected ? planText(expected) : undefined);
  assert.equal(await matchLogs(id), 2, "one row for each person");
  // Answering again changes nothing and announces nothing.
  const again = await decideDate(await user(bo), id, "pass", WEB);
  assert.equal(again.decision, "meet");
  assert.equal(await matchLogs(id), 2);
  assert.equal(new Date((await row(id)).matched_at).getTime(), new Date(r.matched_at).getTime());
});

test("a pass or a lone yes: no match, no plan", async () => {
  const id = await date(PLAN);
  await decideDate(await user(ana), id, "meet", WEB);
  const no = await decideDate(await user(bo), id, "pass", WEB);
  assert.equal(no.match, false);
  const r = await row(id);
  assert.deepEqual([r.matched_at, r.plan, r.plan_confirmed_at], [null, null, null]);
  assert.equal(await matchLogs(id), 0);
});

test("a match without a weekly drop: matched_at set, no plan", async () => {
  const id = await date();
  await decideDate(await user(bo), id, "meet", WEB);
  assert.equal((await decideDate(await user(ana), id, "meet", WEB)).match, true);
  const r = await row(id);
  assert.ok(r.matched_at);
  assert.deepEqual([r.plan, r.plan_confirmed_at], [null, null]);
});
