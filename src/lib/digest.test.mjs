// Run: npm test. The web chat's daily digest numbers (lib/text/web-chat.ts digestCounts) on a real Postgres (PGlite, in
// memory): dates count whoever's agent started them, and a date held for a weekly drop counts only once it reached them.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

process.env.KISMET_WEEKLY_DROP = "on";
const pg = await freshDb();
const { insertUser } = await import("./actions.ts");
const { toUser } = await import("./db.ts");
const { holdingNow } = await import("./drop.ts");
const { parseProfile } = await import("./validate.ts");
const { digestCounts } = await import("./text/web-chat.ts");

async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], edgeCity: true });
  return (await insertUser(r.profile, { channel: "web", client: "" })).id;
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const v = JSON.stringify({ score: 8, meet: true, reason: "Good chat.", bestLine: "Chai?", suggestedMeetup: "Chai at Riva" });
async function date(a, b, { held = false, dropA = null, matched = false } = {}) {
  await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at, held, drop_a_at, matched_at, decision_a, decision_b)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now(), $5, $6, $7, $8, $8)`,
  [[a, b].sort().join(":"), a, b, v, held, dropA, matched ? new Date() : null, matched ? "meet" : null]);
}

const [me, x, y, z, w] = await Promise.all(["Mia", "Xan", "Yul", "Zed", "Wes"].map(person));
afterEach(() => pg.exec("delete from dates"));

test("dates on either side count; held ones only once released to them (while drops are held)", async () => {
  await date(me, x); // my agent started it
  await date(y, me); // their agent started it: it used to be left out
  await date(z, me, { held: true }); // held for a drop, not released to me
  await date(me, w, { held: true, dropA: new Date() }); // held, released to me
  const c = await digestCounts(await user(me));
  assert.equal(c.dates, holdingNow() ? 3 : 4);
  assert.equal(c.matches, 0);
});

test("new open matches count", async () => {
  await date(me, x, { matched: true });
  assert.equal((await digestCounts(await user(me))).matches, 1);
});
