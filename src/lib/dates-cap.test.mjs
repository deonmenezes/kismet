// Run: npm test. The 3-dates-a-day cap (lib/engine.ts reserveDates) on a real Postgres (PGlite, in memory): the count and
// the insert run in one transaction behind per-person advisory locks, so requests at the same time never take someone
// past DATES_PER_DAY. (PGlite has one connection, so this checks the statements and the cap, not real parallelism.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
const { insertUser } = await import("./actions.ts");
const { reserveDates, DATES_PER_DAY } = await import("./engine.ts");
const { toUser } = await import("./db.ts");
const { parseProfile } = await import("./validate.ts");

async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books", "Music"], edgeCity: true });
  return (await insertUser(r.profile, { channel: "web", client: "" })).id;
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const today = async (id) => (await pg.query("select count(*)::int as n from dates where a_id = $1 or b_id = $1", [id])).rows[0].n;

test("two requests at once for someone with one date left: only one gets in", async () => {
  const [t, f1, f2, a, b] = await Promise.all(["Tara", "Finn", "Gus", "Ari", "Bea"].map(person));
  for (const other of [f1, f2].slice(0, DATES_PER_DAY - 1)) {
    await pg.query("insert into dates (pair_key, a_id, b_id, mode) values ($1, $2, $3, 'friendly')", [[t, other].sort().join(":"), t, other]);
  }
  assert.equal(await today(t), DATES_PER_DAY - 1);
  const [A, B] = await Promise.all([user(a), user(b)]);
  const out = await Promise.all([reserveDates(A, "cap-a", t), reserveDates(B, "cap-b", t)]);
  assert.equal(out.flatMap((o) => o.ids).length, 1);
  assert.equal(await today(t), DATES_PER_DAY);
});
