// Run: npm test. Block, unblock and report routes (src/app/api/me/block, report) on a real Postgres (PGlite, in memory):
// on a recommendation or match that is no longer there they answer 410 with a plain "text" (the app shows it), never a
// 404 (the app reads 404 as "not available yet"), and the same for any id that isn't the caller's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
const { insertUser } = await import("./actions.ts");
const { parseProfile } = await import("./validate.ts");
const block = await import("../app/api/me/block/route.ts");
const report = await import("../app/api/me/report/route.ts");

async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], edgeCity: true });
  return insertUser(r.profile, { channel: "web", client: "" });
}
const call = (handler, token, method, body) =>
  handler(new Request("https://kismet.test/api/me/x", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

const ana = await person("Ana");
const bo = await person("Bo");
const v = JSON.stringify({ score: 8, meet: true, reason: "Good chat.", bestLine: "Chai?", suggestedMeetup: "Chai at Riva" });
const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
  values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now()) returning id`, [[ana.id, bo.id].sort().join(":"), ana.id, bo.id, v]);
const live = rows[0].id;

test("stale or unknown ids: 410 with a text to show, for block, unblock and report alike", async () => {
  const gone = "0b6f4a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
  for (const [handler, method, body] of [
    [block.POST, "POST", { dateId: gone }],
    [block.DELETE, "DELETE", { dateId: gone }],
    [report.POST, "POST", { dateId: gone, reason: "spam" }],
  ]) {
    const res = await call(handler, ana.token, method, body);
    assert.equal(res.status, 410);
    const out = await res.json();
    assert.equal(out.error, "gone");
    assert.match(out.text, /no longer there|no block/);
  }
});

test("a live recommendation still blocks (200), and blocking it again is fine", async () => {
  const res = await call(block.POST, ana.token, "POST", { dateId: live });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).blocked, true);
  assert.equal((await call(block.POST, ana.token, "POST", { dateId: live })).status, 200);
});
