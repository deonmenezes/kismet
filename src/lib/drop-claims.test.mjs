// Run: npm test. Weekly drop claims (db/schema.sql drop_claims, lib/drop-store.ts) on a real Postgres (PGlite, in memory):
// a claim goes with its date, so someone whose claimed date was deleted before its release (the other side deleted their
// account) is picked again in that drop instead of getting "no match this time". Also the migration of the old key.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrate } from "./test-support/pg.mjs";

process.env.KISMET_WEEKLY_DROP = "on";
const pg = await freshDb();
const { insertUser, deleteUser } = await import("./actions.ts");
const { parseProfile } = await import("./validate.ts");
const { releaseWeeklyDrops } = await import("./drop-store.ts");

// Wed 28 Oct 19:30 India time: the 28 Oct drop is due; its pool ends at the cutoff (18:00).
const NOW = new Date("2026-10-28T14:00:00Z");
const KEY = "2026-10-28T13:30:00.000Z";

async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], edgeCity: true });
  return (await insertUser(r.profile, { channel: "web", client: "" })).id;
}
const v = JSON.stringify({ score: 8, meet: true, reason: "Good chat.", bestLine: "Chai?", suggestedMeetup: "Chai at Riva" });
async function date(a, b) {
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, '2026-10-27T10:00:00Z') returning id`, [[a, b].sort().join(":"), a, b, v]);
  return rows[0].id;
}
const claim = async (u) => (await pg.query("select date_id from drop_claims where user_id = $1 and drop_at = $2", [u, KEY])).rows[0];

afterEach(() => pg.exec("delete from dates; delete from drop_claims;"));

test("a claimed date deleted before its release: the claim goes with it and the next run picks again", async () => {
  const john = await person("John");
  const bo = await person("Bo");
  const ana = await person("Ana");
  const withBo = await date(john, bo);
  const withAna = await date(john, ana);
  // A run claimed Bo for John and stopped before releasing it (a killed function); then Bo deleted their account.
  await pg.query("insert into drop_claims (user_id, drop_at, date_id) values ($1, $2, $3)", [john, KEY, withBo]);
  await pg.query("delete from users where id = $1", [bo]);
  assert.equal(await claim(john), undefined, "the claim went with the date (it used to stay as 'no match')");
  await releaseWeeklyDrops(NOW, 15_000);
  assert.equal((await claim(john))?.date_id, withAna);
  const { rows } = await pg.query("select drop_a_at, drop_b_at, a_id from dates where id = $1", [withAna]);
  assert.ok(rows[0].a_id === john ? rows[0].drop_a_at : rows[0].drop_b_at, "released to John this drop");
  await pg.query("delete from users where id = any($1::uuid[])", [[john, ana]]);
});

test("a drop already released: the other side deleting their account never gives a second drop that week", async () => {
  const john = await person("John");
  const bo = await person("Bo");
  const ana = await person("Ana");
  const withBo = await date(john, bo);
  const withAna = await date(john, ana);
  // John's drop this week was Bo, released to him; then Bo deletes their account.
  await pg.query("insert into drop_claims (user_id, drop_at, date_id) values ($1, $2, $3)", [john, KEY, withBo]);
  await pg.query("update dates set drop_a_at = case when a_id = $2 then now() end, drop_b_at = case when b_id = $2 then now() end where id = $1", [withBo, john]);
  await deleteUser(bo, { channel: "web", client: "" });
  assert.deepEqual(await claim(john), { date_id: null }, "kept: John had his drop");
  await releaseWeeklyDrops(NOW, 15_000);
  // (Ana may still get John as her own drop: only John's side matters here.)
  const { rows } = await pg.query("select case when a_id = $2 then drop_a_at else drop_b_at end as to_john from dates where id = $1", [withAna, john]);
  assert.equal(rows[0].to_john, null, "Ana is not released to John as a second drop");
  await pg.query("delete from users where id = any($1::uuid[])", [[john, ana]]);
});

test("Saturday 31 Oct 10:00 drop: one person each from dates finished by 09:00, a new one only if not released before, never across the demo line", async () => {
  const SAT = new Date("2026-10-31T04:32:00Z"); // the call by hand at 10:02 India time
  const SAT_KEY = "2026-10-31T04:30:00.000Z";
  const at = async (a, b, finishedAt, extra = "") => (await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at, held${extra ? `, ${extra}` : ""})
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, $5, true${extra ? ", now()" : ""}) returning id`, [[a, b].sort().join(":"), a, b, v, finishedAt])).rows[0].id;
  const [lea, max, ned, zed, ron, kim, joy, rae, dee, dan] = await Promise.all(["Lea", "Max", "Ned", "Zed", "Ron", "Kim", "Joy", "Rae", "Dee", "Dan"].map(person));
  await pg.query("update users set is_demo = true where id = any($1::uuid[])", [[dee, dan]]);
  // Lea joined after Friday's cutoff: one date in Friday's drop hour (visible since 20:00, shown to her), one overnight.
  const leaMax = await at(lea, max, "2026-10-30T13:45:00Z", "shown_a_at");
  const leaNed = await at(lea, ned, "2026-10-30T22:00:00Z");
  const leaZed = await at(lea, zed, "2026-10-31T03:40:00Z"); // after Saturday's 09:00 cutoff: not in this drop
  // Ron got Kim at Friday's drop (released to both); he gets a new person only from a date not released to him yet.
  const ronKim = await at(ron, kim, "2026-10-29T10:00:00Z", "drop_a_at");
  await pg.query("update dates set drop_b_at = now() where id = $1", [ronKim]);
  const ronJoy = await at(ron, joy, "2026-10-30T19:00:00Z");
  // A demo account with a real one: never a drop. Two demo accounts: their own drop, among themselves.
  const raeDee = await at(rae, dee, "2026-10-30T19:30:00Z");
  const deeDan = await at(dee, dan, "2026-10-30T20:30:00Z");
  const r = await releaseWeeklyDrops(SAT, 15_000);
  assert.equal(r.drop, SAT_KEY);
  const claims = Object.fromEntries((await pg.query("select user_id, date_id from drop_claims where drop_at = $1", [SAT_KEY])).rows.map((x) => [x.user_id, x.date_id]));
  const released = async (id) => {
    const { rows: [d] } = await pg.query("select a_id, b_id, drop_a_at, drop_b_at, plan_a, plan_b from dates where id = $1", [id]);
    return { to: [d.drop_a_at && d.a_id, d.drop_b_at && d.b_id].filter(Boolean), plans: [d.plan_a, d.plan_b].filter(Boolean) };
  };
  // One person per resident per drop: Lea gets exactly one of her two (the pick is by her own agent's score).
  assert.ok([leaMax, leaNed].includes(claims[lea]));
  assert.deepEqual((await released(leaZed)).to, []);
  assert.equal([leaMax, leaNed].filter((id) => claims[lea] === id).length, 1);
  // Ron: Joy, not Kim again. Kim: no new date, so no claim at all.
  assert.equal(claims[ron], ronJoy);
  assert.equal(claims[kim], undefined);
  // The demo line: Rae (real) and Dee (demo) never get each other; the demo pair gets their own.
  assert.equal(claims[rae], null, "no match this time: nobody released to Rae");
  assert.notEqual(claims[dee], raeDee);
  assert.deepEqual((await released(raeDee)).to, []);
  assert.equal(claims[dee], deeDan);
  // Every released plan is for Sun 1 Nov 10 am, before the event ends.
  for (const id of new Set(Object.values(claims).filter(Boolean))) {
    for (const p of (await released(id)).plans) assert.deepEqual([p.day, p.time, p.dropKey], ["Sun 1 Nov", "10 am", SAT_KEY]);
  }
  assert.ok((await released(ronJoy)).to.includes(ron));
  // A second call (the backup cron at 10:30-11:29): nothing new.
  const again = await releaseWeeklyDrops(new Date("2026-10-31T05:10:00Z"), 15_000);
  assert.equal(again.released, 0);
  // The daily job's catch-up between the 09:00 cutoff and 10:00 never sends it early.
  await pg.exec("delete from drop_claims; update dates set drop_a_at = null, drop_b_at = null, plan_a = null, plan_b = null;");
  const early = await releaseWeeklyDrops(new Date("2026-10-31T03:45:00Z"), 15_000, { catchUp: true });
  assert.equal(early.skipped, "no drop is due");
  assert.equal((await pg.query("select count(*)::int as n from drop_claims")).rows[0].n, 0);
  await pg.query("delete from users where id = any($1::uuid[])", [[lea, max, ned, zed, ron, kim, joy, rae, dee, dan]]);
});

test("migration: an old ON DELETE SET NULL key becomes a cascade, idempotently", async () => {
  await pg.exec(`alter table drop_claims drop constraint drop_claims_date_id_fkey;
    alter table drop_claims add constraint drop_claims_date_fk_old foreign key (date_id) references dates(id) on delete set null;`);
  await migrate(pg);
  await migrate(pg);
  const { rows } = await pg.query(`select conname, confdeltype from pg_constraint
    where conrelid = 'drop_claims'::regclass and contype = 'f' and confrelid = 'dates'::regclass`);
  assert.deepEqual(rows, [{ conname: "drop_claims_date_id_fkey", confdeltype: "c" }]);
});

test("a newer \"none\" claim never hides an earlier drop still waiting for the answer; once answered, the newest shows", async () => {
  const { dropFor } = await import("./drop-store.ts");
  const { toUser } = await import("./db.ts");
  const john = await person("John");
  const bo = await person("Bo");
  const withBo = await date(john, bo);
  // Wednesday's drop: Bo, released to John, not answered yet. Friday's: no match ("none").
  await pg.query("insert into drop_claims (user_id, drop_at, date_id) values ($1, $2, $3), ($1, '2026-10-30T13:30:00.000Z', null)", [john, KEY, withBo]);
  await pg.query("update dates set drop_a_at = case when a_id = $2 then now() end, drop_b_at = case when b_id = $2 then now() end where id = $1", [withBo, john]);
  const me = async () => toUser((await pg.query("select * from users where id = $1", [john])).rows[0]);
  const d = (await dropFor(await me(), NOW)).drop;
  assert.deepEqual([d?.status, d?.dateId, d?.dropAt], ["open", withBo, KEY], "Wednesday's open drop, not Friday's none");
  // John answers: Friday's (the newest) shows again.
  await pg.query("update dates set decision_a = case when a_id = $2 then 'pass' end, decision_b = case when b_id = $2 then 'pass' end where id = $1", [withBo, john]);
  const after = (await dropFor(await me(), NOW)).drop;
  assert.deepEqual([after?.status, after?.dropAt], ["none", "2026-10-30T13:30:00.000Z"]);
  await pg.query("delete from users where id = any($1::uuid[])", [[john, bo]]);
});
