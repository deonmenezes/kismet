// Run: npm test. The prebuild schema check (scripts/check-schema.mjs, M8): a build onto a database without the Edge City
// and demo columns stops with a clear message; with no DATABASE_URL (CI, tests) it skips. On PGlite with db/schema.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshDb } from "./test-support/pg.mjs";
import { missingColumns, REQUIRED, run } from "../../scripts/check-schema.mjs";

const pg = await freshDb();
const connect = async () => async (text, params) => (await pg.query(text, params)).rows;
const SCRIPT = fileURLToPath(new URL("../../scripts/check-schema.mjs", import.meta.url));

test("a migrated database passes", async () => {
  assert.deepEqual(await missingColumns(await connect()), []);
  const r = await run({ url: "postgres://x", connect });
  assert.equal(r.code, 0);
  assert.match(r.message, /Schema check OK: users\.is_demo, users\.edge_city/);
});

test("a database without users.edge_city or users.is_demo stops the build, naming the columns and the fix", async () => {
  await pg.exec("alter table users drop column edge_city; alter table users drop column is_demo cascade");
  const r = await run({ url: "postgres://x", connect });
  assert.equal(r.code, 1);
  assert.match(r.message, /not migrated[\s\S]*users\.is_demo[\s\S]*users\.edge_city[\s\S]*npm run db:migrate/);
  assert.doesNotMatch(r.message, /edge_weeks/);
  assert.deepEqual((await missingColumns(await connect())).map(([, c]) => c), ["is_demo", "edge_city"]);
});

test("an unreadable database stops the build too; no DATABASE_URL skips", async () => {
  const down = await run({ url: "postgres://x", connect: async () => async () => { throw new Error("connection refused"); } });
  assert.deepEqual([down.code, /connection refused/.test(down.message)], [1, true]);
  assert.equal((await run({ url: undefined, connect })).code, 0);
  assert.equal(REQUIRED.length, 15);
  assert.ok(REQUIRED.some(([t, c]) => t === "deletion_jobs" && c === "next_at"), "the QA3 deletion retries need their table");
  assert.ok(REQUIRED.some(([t, c]) => t === "agent_notes" && c === "contacts_checked_at"), "the model contact check needs its markers");
});

test("the script itself: exits 0 and says it skipped when there is no DATABASE_URL", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_UNPOOLED;
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped: no DATABASE_URL/);
  // npm runs it before every build.
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.prebuild, /scripts\/check-schema\.mjs/);
});
