// Run: npm test. The Village Board (db.ts boardQuotes) on a real Postgres (PGlite, in memory): a resident knows their own
// agent's score (myAgent.score), so the board must carry no score and must not pick its line by score, or the other
// agent's verdict could be worked out. Dates held for a weekly drop stay off it until then.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

process.env.KISMET_WEEKLY_DROP = "on";
const pg = await freshDb();
const { insertUser } = await import("./actions.ts");
const { boardQuotes } = await import("./db.ts");
const { holdingNow } = await import("./drop.ts");
const { parseProfile } = await import("./validate.ts");

async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], publicQuotes: true, edgeCity: true });
  return (await insertUser(r.profile, { channel: "web", client: "" })).id;
}
const v = (score, bestLine) => JSON.stringify({ score, meet: score > 5, reason: "Good chat.", bestLine, suggestedMeetup: "Chai at Riva" });
const ID = "11111111-2222-4333-8444-555555555555";
async function date(a, b, scoreA, scoreB, held = false) {
  await pg.query(`insert into dates (id, pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at, held)
    values ($1, $2, $3, $4, 'friendly', 'done', $5::jsonb, $6::jsonb, now(), $7)`,
  [ID, [a, b].sort().join(":"), a, b, v(scoreA, "Line picked by agent one about tide pools."), v(scoreB, "Line picked by agent two about night markets."), held]);
}

const ana = await person("Ana");
const bo = await person("Bo");
afterEach(() => pg.exec("delete from dates"));

test("no score of any kind on the board", async () => {
  await date(ana, bo, 9, 3);
  const [q] = await boardQuotes(10);
  assert.deepEqual(Object.keys(q).sort(), ["day", "quote"]);
  assert.ok(!JSON.stringify(q).match(/chemistry|score|\b[0-9]\/10\b/));
});

test("the line is picked without the scores: swapping them changes nothing", async () => {
  await date(ana, bo, 9, 2);
  const [first] = await boardQuotes(10);
  await pg.exec("delete from dates");
  await date(ana, bo, 2, 9);
  const [second] = await boardQuotes(10);
  assert.equal(first.quote, second.quote);
});

test("a date held for the weekly drop stays off the board while drops are held", async () => {
  await date(ana, bo, 8, 8, true);
  assert.equal((await boardQuotes(10)).length, holdingNow() ? 0 : 1);
  await pg.query("update dates set held = false");
  assert.equal((await boardQuotes(10)).length, 1);
});
