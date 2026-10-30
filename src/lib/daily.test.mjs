// Run: npm test. The daily cron job: text pushes before dates, a bounded date batch, and stuck-date cleanup
// that never cuts a date still queued in a running pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CRON_CONCURRENCY, CRON_DATES, CRON_PEOPLE, dailyJob, STALE_QUEUED_MS, STALE_STARTED_MS, staleRunning } from "./daily.ts";

test("D2 daily job: pushes go out before any date is reserved or run, and the date batch is bounded", async () => {
  const calls = [];
  const io = {
    dropAbandoned: async () => (calls.push("abandoned"), 2),
    pushAll: async () => (calls.push("push"), 5),
    people: async (limit) => (calls.push(`people:${limit}`), Array.from({ length: limit }, (_, i) => ({ id: `u${i}` }))),
    reserve: async (id) => (calls.push("reserve"), [`${id}-a`, `${id}-b`, `${id}-c`]),
    runDates: async (ids, concurrency) => void calls.push(`run:${ids.length}@${concurrency}`),
  };
  const r = await dailyJob(io);
  assert.deepEqual(calls.slice(0, 3), ["abandoned", "push", `people:${CRON_PEOPLE}`]);
  assert.equal(calls.filter((c) => c === "reserve").length, CRON_DATES / 3); // stops reserving at the cap
  assert.equal(calls.at(-1), `run:${CRON_DATES}@${CRON_CONCURRENCY}`);
  assert.ok(CRON_DATES <= 30 && CRON_CONCURRENCY >= 6); // about 5 rounds: fits ~200 s of a 300 s function
  assert.deepEqual(r, { people: CRON_PEOPLE, dates: CRON_DATES, threads: 5, abandoned: 2 });
});

test("D2 daily job: a failing push step is logged and the dates still start", async () => {
  const calls = [];
  const r = await dailyJob({
    dropAbandoned: async () => 0,
    pushAll: async () => { throw new Error("down"); },
    people: async () => [{ id: "u1" }],
    reserve: async () => ["d1"],
    runDates: async (ids) => void calls.push(ids),
  });
  assert.deepEqual(calls, [["d1"]]);
  assert.equal(r.threads, 0);
});

test("weekly drop catch-up: runs before the text push (so released drops go out in the same run); a failure never stops the job", async () => {
  const calls = [];
  const io = {
    dropAbandoned: async () => (calls.push("abandoned"), 0),
    weeklyDrop: async () => (calls.push("drop"), 3),
    pushAll: async () => (calls.push("push"), 1),
    people: async () => [],
    reserve: async () => [],
    runDates: async () => {},
  };
  const r = await dailyJob(io);
  assert.deepEqual(calls.slice(0, 3), ["abandoned", "drop", "push"]);
  assert.equal(r.drops, 3);
  const failed = await dailyJob({ ...io, weeklyDrop: async () => { throw new Error("down"); } });
  assert.equal(failed.drops, 0);
  assert.equal(failed.threads, 1);
});

test("D2 stuck dates: judged by started_at; a date still queued is kept until no function can be alive", () => {
  const now = new Date("2026-10-20T06:30:00Z");
  const ago = (ms) => new Date(now.getTime() - ms);
  // Queued 5 minutes ago in a pool that has not reached it yet: kept (the old created_at rule deleted it).
  assert.equal(staleRunning({ status: "running", createdAt: ago(5 * 60_000), startedAt: null }, now), false);
  assert.equal(staleRunning({ status: "running", createdAt: ago(STALE_QUEUED_MS + 1), startedAt: null }, now), true);
  // Queued long ago, started a minute ago: kept.
  assert.equal(staleRunning({ status: "running", createdAt: ago(6 * 60_000), startedAt: ago(60_000) }, now), false);
  assert.equal(staleRunning({ status: "running", createdAt: ago(9 * 60_000), startedAt: ago(STALE_STARTED_MS + 1) }, now), true);
  assert.equal(staleRunning({ status: "done", createdAt: ago(3600e3), startedAt: ago(3600e3) }, now), false);
  assert.ok(STALE_QUEUED_MS > 300_000); // longer than maxDuration
});
