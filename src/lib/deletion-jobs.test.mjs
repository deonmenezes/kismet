// Run: npm test. Deletions outside the database (Vercel Blob photo files, Neon Auth sign-ins, Daytona agent boxes) that
// fail when an account or photo is deleted are queued and retried by the daily job until they are gone (lib/deletion-jobs.ts),
// and an account's waitlist entry with one of its sign-in emails goes with it. Real modules on PGlite (db/schema.sql).
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrate } from "./test-support/pg.mjs";

const pg = await freshDb();
const { insertUser, deleteUser } = await import("./actions.ts");
const { parseProfile } = await import("./validate.ts");
const { deletePhotos } = await import("./photos.ts");
const { queueDeletions, drainDeletionJobs, backoffMs, MAX_ATTEMPTS } = await import("./deletion-jobs.ts");
const { dailyJob } = await import("./daily.ts");
const { afterQueue } = await import("next/server");

const WEB = { channel: "web", client: "" };
async function person(name, telegram) {
  const r = parseProfile({ name, telegram, lookingFor: ["friends"], interests: ["AI", "Music"], edgeCity: true });
  assert.ok(r.profile, r.error);
  return (await insertUser(r.profile, WEB, null, [], null)).id;
}
const jobs = async () => (await pg.query("select kind, target, attempts, next_at, last_error from deletion_jobs order by kind, target")).rows;
const ok = { blob: async () => {}, neon_auth: async () => {}, agent_box: async () => {} };
const fail = (bad) => async (targets) => { if (targets.some((t) => bad.includes(t))) throw new Error(`cannot delete ${bad.join(",")}`); };

afterEach(async () => {
  globalThis.__kismetBlobDel = undefined;
  afterQueue.length = 0;
  await pg.exec("delete from deletion_jobs; delete from photos; delete from auth_identities; delete from waitlist; delete from activity_log; delete from users;");
});

test("the migration is idempotent and the table refuses unknown kinds", async () => {
  await migrate(pg);
  await migrate(pg);
  await assert.rejects(pg.query("insert into deletion_jobs (kind, target) values ('email', 'x')"));
});

test("a photo file that fails to delete is queued (photo delete and account delete), then retried until it is gone", async () => {
  const me = await person("Ana", "ana_real_1");
  await pg.query("insert into photos (user_id, pathname, source, width, height) values ($1, 'p/a/1.jpg', 'upload', 1, 1), ($1, 'p/a/2.jpg', 'upload', 1, 1)", [me]);
  globalThis.__kismetBlobDel = async () => { throw new Error("blob store down"); };
  assert.equal(await deletePhotos(me, "all"), 2, "the rows go at once");
  assert.deepEqual((await jobs()).map((j) => [j.kind, j.target, j.attempts]), [["blob", "p/a/1.jpg", 0], ["blob", "p/a/2.jpg", 0]]);
  assert.match((await jobs())[0].last_error, /blob store down/);
  // The daily job: still down, so both wait (1 h, then longer); not due again in the same run.
  assert.deepEqual(await drainDeletionJobs({ ...ok, blob: fail(["p/a/1.jpg", "p/a/2.jpg"]) }), { done: 0, failed: 2 });
  const after1 = await jobs();
  assert.deepEqual(after1.map((j) => j.attempts), [1, 1]);
  assert.ok(after1.every((j) => j.next_at > new Date(Date.now() + backoffMs(1) - 60_000)));
  assert.deepEqual(await drainDeletionJobs(ok), { done: 0, failed: 0 }, "not due yet");
  // Due again; one file still fails: the other is not held back by it.
  await pg.query("update deletion_jobs set next_at = now() - interval '1 second'");
  assert.deepEqual(await drainDeletionJobs({ ...ok, blob: fail(["p/a/2.jpg"]) }), { done: 1, failed: 1 });
  assert.deepEqual((await jobs()).map((j) => [j.target, j.attempts]), [["p/a/2.jpg", 2]]);
  await pg.query("update deletion_jobs set next_at = now() - interval '1 second'");
  assert.deepEqual(await drainDeletionJobs(ok), { done: 1, failed: 0 });
  assert.deepEqual(await jobs(), []);
});

test("account delete: the sign-in (Neon Auth) and the photo files that fail are queued; the box failure too", async () => {
  const me = await person("Ben", "ben_real_1");
  await pg.query("insert into photos (user_id, pathname, source, width, height) values ($1, 'p/b/1.jpg', 'upload', 1, 1)", [me]);
  await pg.query("insert into auth_identities (auth_user_id, user_id, email) values ('auth-ben', $1, 'ben@example.com')", [me]);
  globalThis.__kismetBlobDel = async () => { throw new Error("blob store down"); };
  // No neon_auth schema here: the sign-in delete fails, as when Neon Auth's tables can't be reached.
  await deleteUser(me, WEB);
  assert.equal((await pg.query("select count(*)::int as n from users where id = $1", [me])).rows[0].n, 0, "the account is gone at once");
  assert.deepEqual((await jobs()).map((j) => [j.kind, j.target]), [["blob", "p/b/1.jpg"], ["neon_auth", "auth-ben"]]);
  // The agent box delete runs after the response (collected here, not run); a Daytona failure there queues it.
  assert.ok(afterQueue.length >= 1, "the box delete is scheduled");
  await queueDeletions("agent_box", [me], new Error("daytona 503"));
  await queueDeletions("agent_box", [me], new Error("daytona 503 again")); // queued twice: still one job
  assert.deepEqual((await jobs()).map((j) => j.kind), ["agent_box", "blob", "neon_auth"]);
  // The next daily run, with the real deleters: the blob store is back, Neon Auth's table is there. Daytona is not
  // configured here, so the box job waits (neither done nor a failure). Only Ben's sign-in goes.
  globalThis.__kismetBlobDel = undefined;
  await pg.exec(`create schema if not exists neon_auth; create table if not exists neon_auth."user" (id text primary key, email text);`);
  await pg.query(`insert into neon_auth."user" (id, email) values ('auth-ben', 'ben@example.com'), ('auth-other', 'o@example.com')`);
  const r = await dailyJob({
    dropAbandoned: async () => 0, pushAll: async () => 0, people: async () => [], reserve: async () => [], runDates: async () => {},
    deletionJobs: async () => (await drainDeletionJobs()).done,
  });
  assert.equal(r.deletions, 2);
  assert.deepEqual((await jobs()).map((j) => [j.kind, j.attempts]), [["agent_box", 0]]);
  assert.deepEqual((await pg.query(`select id from neon_auth."user"`)).rows.map((x) => x.id), ["auth-other"]);
});

// Code review of the deletion retries.
test("review: a queued sign-in that was linked to an account again is kept, and its job is done", async () => {
  const me = await person("Eve", "eve_real_1");
  await pg.exec(`create schema if not exists neon_auth; create table if not exists neon_auth."user" (id text primary key, email text);`);
  await pg.query(`insert into neon_auth."user" (id, email) values ('auth-eve', 'eve@example.com') on conflict do nothing`);
  await queueDeletions("neon_auth", ["auth-eve"], new Error("neon auth down"));
  // Eve signed up again with Google before the retry; Neon Auth kept the same user, now linked to the new account.
  await pg.query("insert into auth_identities (auth_user_id, user_id, email) values ('auth-eve', $1, 'eve@example.com')", [me]);
  assert.deepEqual(await drainDeletionJobs(), { done: 1, failed: 0 });
  assert.equal((await pg.query(`select count(*)::int as n from neon_auth."user" where id = 'auth-eve'`)).rows[0].n, 1);
});

test("review: each try is counted before it runs (a killed run still backs off), and a hung call is given up", async () => {
  await queueDeletions("blob", ["p/hang.jpg"], new Error("down"));
  let seen = null;
  const hang = async () => {
    seen = (await pg.query("select attempts, next_at > now() as later from deletion_jobs")).rows[0];
    return new Promise(() => {}); // never answers
  };
  const t = performance.now();
  assert.deepEqual(await drainDeletionJobs({ ...ok, blob: hang }, 100, 5_000, 200), { done: 0, failed: 1 });
  assert.ok(performance.now() - t < 3_000, "gave up on the hung call");
  assert.deepEqual([seen.attempts, seen.later], [1, true], "attempts and next_at were written before the call");
  const [j] = await jobs();
  assert.equal(j.attempts, 1);
  assert.match(j.last_error, /no answer/);
});

test("review: no try starts after the time budget, and at most BOX_LIMIT boxes a run", async () => {
  const { BOX_LIMIT } = await import("./deletion-jobs.ts");
  await queueDeletions("blob", ["p/1.jpg"], new Error("down"));
  assert.deepEqual(await drainDeletionJobs(ok, 100, 0), { done: 0, failed: 0 }, "budget already spent");
  assert.equal((await jobs())[0].attempts, 0, "untouched");
  await pg.exec("delete from deletion_jobs");
  await queueDeletions("agent_box", Array.from({ length: BOX_LIMIT + 5 }, (_, i) => `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`), new Error("down"));
  const tried = [];
  assert.deepEqual(await drainDeletionJobs({ ...ok, agent_box: async (ids) => void tried.push(...ids) }), { done: BOX_LIMIT, failed: 0 });
  assert.equal((await jobs()).length, 5);
});

test("review: deleteBox counts a box Daytona doesn't have, or is destroying, as deleted; anything else throws", async () => {
  const { deleteBox } = await import("./agent-box/index.ts");
  process.env.DAYTONA_API_KEY = "test-key";
  try {
    const err = (statusCode) => Object.assign(new Error(`daytona ${statusCode}`), { statusCode });
    let deleted = 0;
    const box = (state, del = async () => void deleted++) => ({ state, delete: del });
    for (const [label, get] of [
      ["404", async () => { throw err(404); }],
      ["410", async () => { throw err(410); }],
      ["destroyed", async () => box("destroyed")],
      ["destroying", async () => box("destroying")],
      ["delete 404", async () => box("stopped", async () => { throw err(404); })],
    ]) {
      globalThis.__kismetDaytona = { get };
      await assert.doesNotReject(deleteBox("u1"), label);
    }
    assert.equal(deleted, 0);
    globalThis.__kismetDaytona = { get: async () => box("started") };
    await deleteBox("u1");
    assert.equal(deleted, 1);
    globalThis.__kismetDaytona = { get: async () => { throw err(503); } };
    await assert.rejects(deleteBox("u1"), /503/);
    globalThis.__kismetDaytona = { get: async () => box("started", async () => { throw err(500); }) };
    await assert.rejects(deleteBox("u1"), /500/);
    globalThis.__kismetDaytona = { get: async (_name, config) => (assert.equal(config.requestTimeoutMs, 60_000), box("started")) };
    await deleteBox("u1");
  } finally {
    delete process.env.DAYTONA_API_KEY;
    globalThis.__kismetDaytona = undefined;
  }
});

test("a job that keeps failing backs off (1 h, 2 h ... 7 days) and stops after MAX_ATTEMPTS, kept with its error", async () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => backoffMs(n) / 3_600_000), [1, 2, 4, 8]);
  assert.equal(backoffMs(30), 7 * 24 * 3_600_000);
  await queueDeletions("blob", ["p/x.jpg"], new Error("down"));
  await pg.query("update deletion_jobs set attempts = $1", [MAX_ATTEMPTS - 1]);
  assert.deepEqual(await drainDeletionJobs({ ...ok, blob: fail(["p/x.jpg"]) }), { done: 0, failed: 1 });
  const [j] = await jobs();
  assert.equal(j.attempts, MAX_ATTEMPTS);
  assert.equal((await pg.query("select count(*)::int as n from deletion_jobs where next_at = 'infinity'")).rows[0].n, 1, "never due again");
  assert.match(j.last_error, /cannot delete/);
});

test("a failing retry step never stops the daily job", async () => {
  const r = await dailyJob({
    dropAbandoned: async () => 0, pushAll: async () => 0, people: async () => [], reserve: async () => [], runDates: async () => {},
    deletionJobs: async () => { throw new Error("db down"); },
  });
  assert.equal(r.deletions, 0);
});

test("the account's waitlist entry with one of its sign-in emails goes with it (and its log row); others stay", async () => {
  const me = await person("Cy", "cy_real_1");
  await pg.query("insert into auth_identities (auth_user_id, user_id, email) values ('auth-cy', $1, 'Cy@Example.com')", [me]);
  const add = async (email, n) => (await pg.query(`insert into waitlist (email, ref_code, removal_hash, ip_hash) values ($1, $2, $3, 'ip') returning id`,
    [email, `ref${n}`, `rm${n}`])).rows[0].id;
  const mine = await add("cy@example.COM", 1);
  const other = await add("someone@example.com", 2);
  for (const id of [mine, other]) await pg.query(`insert into activity_log (user_id, channel, action, meta) values (null, 'waitlist', 'waitlist_join', $1)`, [{ waitlistId: id }]);
  await deleteUser(me, WEB);
  assert.deepEqual((await pg.query("select id from waitlist")).rows.map((r) => Number(r.id)), [Number(other)]);
  assert.deepEqual((await pg.query("select meta->>'waitlistId' as w from activity_log where action = 'waitlist_join'")).rows.map((r) => r.w), [String(other)]);
});

test("an account with no sign-in email never touches the waitlist", async () => {
  const me = await person("Di", "di_real_1");
  await pg.query(`insert into waitlist (email, ref_code, removal_hash, ip_hash) values ('', 'r9', 'h9', 'ip')`);
  await deleteUser(me, WEB);
  assert.equal((await pg.query("select count(*)::int as n from waitlist")).rows[0].n, 1);
});

// Second review: selection per kind, boxes one by one, no try charged when the budget ran out first.
test("review 2: a backlog of one kind (or boxes Daytona can't take now) never starves the others", async () => {
  const boxes = Array.from({ length: 120 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
  await queueDeletions("agent_box", boxes, new Error("down"));
  await pg.query("update deletion_jobs set next_at = now() - interval '2 days'"); // older than anything else
  await queueDeletions("blob", ["p/new.jpg"], new Error("down"));
  await queueDeletions("neon_auth", ["auth-new"], new Error("down"));
  const tried = [];
  const io = { ...ok, blob: async (t) => void tried.push(...t), neon_auth: async (t) => void tried.push(...t), agent_box: async (t) => void tried.push(...t) };
  // Daytona not configured: the 120 boxes wait, untouched, and the two others still go.
  assert.deepEqual(await drainDeletionJobs({ ...io, ready: (k) => k !== "agent_box" }), { done: 2, failed: 0 });
  assert.deepEqual(tried, ["p/new.jpg", "auth-new"]);
  assert.equal((await pg.query("select count(*)::int as n from deletion_jobs where kind = 'agent_box' and attempts = 0")).rows[0].n, 120);
  // Configured: 10 boxes a run, each on its own.
  const calls = [];
  assert.deepEqual(await drainDeletionJobs({ ...ok, agent_box: async (t) => void calls.push(t.length) }), { done: 10, failed: 0 });
  assert.deepEqual(calls, Array(10).fill(1));
});

test("review 2: jobs the time budget cut off before their own try are not charged and stay due", async () => {
  await queueDeletions("blob", ["p/a.jpg", "p/b.jpg", "p/c.jpg"], new Error("down"));
  // The batch fails; the first single try uses up the (tiny) budget; the other two are never tried.
  const slow = async (t) => { if (t.length > 1) throw new Error("batch failed"); await new Promise((r) => setTimeout(r, 60)); throw new Error("still down"); };
  assert.deepEqual(await drainDeletionJobs({ ...ok, blob: slow }, 100, 30, 1_000), { done: 0, failed: 1 });
  const rows = (await pg.query("select target, attempts, next_at <= now() as due from deletion_jobs order by target")).rows;
  assert.deepEqual(rows.map((r) => [r.target, r.attempts, r.due]), [["p/a.jpg", 1, false], ["p/b.jpg", 0, true], ["p/c.jpg", 0, true]]);
});
