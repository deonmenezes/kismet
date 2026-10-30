// Run: npm test. Reports kept after account deletion (lib/report-history.ts, Deon 2026-10-28 "Keep reports + update policy"),
// end to end on a real Postgres (PGlite, in memory) with db/schema.sql: deleting an account keeps the reports about it with
// one-way contact hashes and no raw contact; a new account with the same Telegram, email or phone is hidden pending review
// when that history reached the threshold or a ban, and not under it; earlier reports count toward later ones; the daily
// purge after 12 months; the migration on a database from before (twice); demo accounts stay on their side.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { freshDb, migrate } from "./test-support/pg.mjs";

process.env.SAFETY_HASH_KEY = "test-safety-hash-key-0123456789abcdef";
const pg = await freshDb();
const { insertUser, updateProfile, reportDate, deleteUser } = await import("./actions.ts");
const { toUser } = await import("./db.ts");
const { parseProfile } = await import("./validate.ts");
const { linkIdentity } = await import("./identity.ts");
const { dailyJob } = await import("./daily.ts");
const rh = await import("./report-history.ts");

const WEB = { channel: "web", client: "" };
const INTERESTS = ["AI", "Surfing/beach", "Music", "Books"];
let n = 0;

const profile = (name, telegram) => {
  const r = parseProfile({ name, telegram, lookingFor: ["friends"], interests: INTERESTS, edgeCity: true });
  assert.ok(r.profile, r.error);
  return r.profile;
};
async function person(name, telegram = `${name.toLowerCase()}_${++n}x`, opts = {}) {
  return (await insertUser(profile(name, telegram), WEB, null, [], null, opts)).id;
}
const user = async (id) => {
  const { rows } = await pg.query("select * from users where id = $1", [id]);
  return rows[0] ? toUser(rows[0]) : null;
};
/** Reporters old enough to count toward auto-hide (a day old when they report). */
async function reporters(k, demo = false) {
  const ids = [];
  for (let i = 0; i < k; i++) ids.push(await person(`Rep${i}`, undefined, { demo }));
  await pg.query("update users set created_at = now() - interval '2 days' where id = any($1::uuid[])", [ids]);
  return ids;
}
const verdict = JSON.stringify({ score: 8, meet: true, reason: "Good chat.", bestLine: "Chai?", suggestedMeetup: "Chai at Riva" });
/** A finished date both agents recommended, so `reporterId` may report `otherId` (lib/actions.ts shownPartner). */
async function shownDate(reporterId, otherId) {
  const { rows } = await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at)
    values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, now()) returning id`, [[reporterId, otherId].sort().join(":"), reporterId, otherId, verdict]);
  return rows[0].id;
}
async function report(reporterId, otherId, note = "") {
  const r = await reportDate(await user(reporterId), await shownDate(reporterId, otherId), "harassment", note, WEB);
  assert.equal(r?.reported, true);
}
/** A Kismet-by-text account: its WhatsApp number is a verified contact (the one kind of match that hides, with emails and Village keys). */
async function texter(name, phone, telegram = `${name.toLowerCase().replace(/\W/g, "")}_${++n}t`) {
  const id = (await insertUser(profile(name, telegram), { channel: "whatsapp", client: "" }, null, [], null, { contacts: { phones: [phone] } })).id;
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', $2, 'active')", [id, phone.replace(/[\s-]/g, "")]);
  return id;
}
/** Flagged for /admin as a Telegram-only match (never hidden for it). */
const flagged = async (id) => (await pg.query("select 1 from activity_log where user_id = $1 and action = 'report_history_telegram'", [id])).rows.length > 0;
const reportsAbout = async (id) => (await pg.query("select * from reports where reported_id is not distinct from $1 order by created_at", [id])).rows;
const hidden = async (id) => Boolean((await user(id)).hiddenAt);

afterEach(() => pg.exec("delete from reports; delete from blocks; delete from dates; delete from activity_log; delete from rate_limits; delete from date_log; delete from auth_identities; delete from users;"));

test("contact keys: normalized (Telegram case, @, t.me; Gmail dots and +tags; phone punctuation), HMAC only, none without a key", () => {
  const key = process.env.SAFETY_HASH_KEY;
  const k = (c) => rh.contactKeys(c, key);
  assert.deepEqual(k({ telegram: "@Dee_99" }), k({ telegram: "https://t.me/dee_99" }));
  assert.deepEqual(k({ emails: ["D.ee+kismet@GoogleMail.com"] }), k({ emails: ["dee@gmail.com"] }));
  assert.notDeepEqual(k({ emails: ["d.ee@example.com"] }), k({ emails: ["dee@example.com"] }), "dots matter outside Gmail");
  assert.deepEqual(k({ phones: ["+91 98765-43210"] }), k({ phones: ["919876543210"] }));
  assert.notDeepEqual(k({ telegram: "dee_99" }), k({ phones: ["dee_99"] }), "kinds never collide");
  const all = k({ telegram: "dee_99", phones: ["+919876543210"], emails: ["dee@example.com"], village: "abc" });
  assert.equal(all.length, 4);
  for (const h of all) assert.match(h, /^[0-9a-f]{64}$/);
  assert.deepEqual(k({ telegram: "", phones: [null, "12"], emails: ["nope"] }), [], "empty, short or malformed contacts hash to nothing");
  assert.notDeepEqual(rh.contactKeys({ telegram: "dee_99" }, "another-key-0123456789abcdef-0123456789"), k({ telegram: "dee_99" }));
  assert.equal(rh.safetyKey({ SAFETY_HASH_KEY: "short" }), null, "a short key is refused, never used");
  assert.equal(rh.safetyKey({}), null);
});

test("delete keeps the reports about the account: hashes, the time, the ban; notes scrubbed, photo unlinked; dismissed ones go", async () => {
  const [r1, r2, r3] = await reporters(3);
  const bad = await person("Vikram", "vikram_bad");
  await report(r1, bad, "Vikram kept messaging me, add him at vikram@example.com or +91 98765 43210");
  await report(r2, bad);
  await report(r3, bad);
  await pg.query("update reports set status = 'dismissed' where reporter_id = $1", [r3]);
  const atReport = await reportsAbout(bad);
  assert.equal(atReport.length, 3);
  for (const r of atReport) assert.equal(r.reported_keys.length, 1, "the Telegram hash, written when the report was filed");
  await pg.query("update reports set photo_id = gen_random_uuid()");

  await deleteUser(bad, WEB);
  assert.equal(await user(bad), null);
  const kept = await reportsAbout(null);
  assert.equal(kept.length, 2, "the dismissed report goes with the account");
  for (const r of kept) {
    assert.equal(r.reported_id, null);
    assert.ok(r.reported_gone_at);
    assert.equal(r.reported_banned, false);
    assert.equal(r.photo_id, null);
    assert.deepEqual(r.reported_keys, atReport[0].reported_keys);
  }
  const note = kept.find((r) => r.reporter_id === r1).note;
  assert.doesNotMatch(note, /Vikram|vikram@example\.com|98765/);
  assert.match(note, /kept messaging me/);
  // Reports the deleted person made are kept too, without them (as before).
  const other = await person("Ana");
  await report(r1, other);
  await deleteUser(r1, WEB);
  assert.deepEqual((await reportsAbout(other)).map((r) => r.reporter_id), [null]);
});

test("no raw contact survives the deletion anywhere in the database", async () => {
  const [r1, r2, r3] = await reporters(3);
  const bad = await person("Kiran", "kiran_tg77");
  await pg.query("update users set contact_method = 'phone', contact_phone = '+919811122233' where id = $1", [bad]);
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', '+919811122233', 'active')", [bad]);
  await linkIdentity({ authUserId: "auth-kiran", email: "kiran.k@gmail.com", name: "Kiran" }, bad, WEB);
  for (const r of [r1, r2, r3]) await report(r, bad, "Kiran wants everyone on telegram kiran_tg77");
  const keysBefore = (await reportsAbout(bad))[0].reported_keys;
  assert.equal(keysBefore.length, 3, "Telegram, phone and sign-in email (its number twice is one hash)");
  await deleteUser(bad, WEB);
  const tables = (await pg.query("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'")).rows;
  let dump = "";
  for (const { table_name } of tables) dump += JSON.stringify((await pg.query(`select * from "${table_name}"`)).rows);
  for (const raw of ["kiran_tg77", "9811122233", "kiran.k@gmail.com", "kirank@gmail.com", "Kiran"]) assert.ok(!dump.includes(raw), `${raw} is gone`);
  assert.equal((await reportsAbout(null)).length, 3);
});

test("re-sign-up with the same number, over the threshold: hidden pending review, logged for /admin; the same Telegram alone only flags", async () => {
  const reps = await reporters(3);
  const bad = await texter("Rahul", "+919811100001", "rahul_x9");
  for (const r of reps) await report(r, bad);
  assert.equal(await hidden(bad), true, "three counted reporters hide them (as before)");
  await deleteUser(bad, WEB);

  const again = await texter("Rahul K", "+91 98111-00001");
  assert.equal(await hidden(again), true);
  const { rows } = await pg.query("select action from activity_log where user_id = $1 and action = 'report_history'", [again]);
  assert.equal(rows.length, 1);
  assert.equal((await rh.historyOf(again)).length, 3, "/admin shows the history behind it");
  // The Telegram alone (not verified: anyone can type it) never hides; /admin lists it with the history.
  const sameTg = await person("Rahul T", "@Rahul_X9");
  assert.equal(await hidden(sameTg), false);
  assert.equal(await flagged(sameTg), true);
  assert.equal((await rh.historyOf(sameTg)).length, 3);
  // Someone else is untouched.
  const meera = await person("Meera");
  assert.deepEqual([await hidden(meera), await flagged(meera)], [false, false]);
});

test("under the threshold: not hidden on re-sign-up, but the earlier reports count toward the next one", async () => {
  const [r1, r2, r3] = await reporters(3);
  const bad = await texter("Arjun", "+919811100002", "arjun_q1");
  await report(r1, bad);
  await report(r2, bad);
  await deleteUser(bad, WEB);
  const again = await texter("Arjun", "+919811100002", "arjun_q1");
  assert.equal(await hidden(again), false, "two reporters: under the threshold");
  await report(r3, again);
  assert.equal(await hidden(again), true, "the third reporter hides them, counting the reports about the deleted account");
});

test("re-sign-up with the same sign-in email (linked later) or the same WhatsApp number is caught too", async () => {
  const reps = await reporters(3);
  const bad = await person("Neha", "neha_one1");
  await linkIdentity({ authUserId: "auth-neha-1", email: "Neha.S+dating@gmail.com", name: "Neha" }, bad, WEB);
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', '+919900011122', 'active')", [bad]);
  for (const r of reps) await report(r, bad);
  await deleteUser(bad, WEB);

  const byEmail = await person("N", "totally_new1");
  assert.equal(await hidden(byEmail), false, "a new handle alone matches nothing");
  await linkIdentity({ authUserId: "auth-neha-2", email: "nehas@gmail.com", name: "N" }, byEmail, WEB);
  assert.equal(await hidden(byEmail), true, "the same Gmail inbox, joined after sign-up");

  const byPhone = (await insertUser(profile("Neha P", "fresh_handle2"), { channel: "whatsapp", client: "" }, null, [], null, { contacts: { phones: ["+91 99000 11122"] } })).id;
  assert.equal(await hidden(byPhone), true, "the WhatsApp number a text sign-up comes with");
});

test("a banned account's history hides a rejoin even with one report; a new number is checked too, a Telegram change only flags", async () => {
  const [r1] = await reporters(1);
  const bad = await texter("Sid", "+919811100003", "sid_banned1");
  await report(r1, bad);
  await pg.query("update users set banned_at = now() where id = $1", [bad]);
  await pg.query("update reports set status = 'dismissed'"); // even dismissed: a ban is a ban
  await deleteUser(bad, WEB);
  assert.equal((await reportsAbout(null))[0].reported_banned, true, "a banned account's dismissed reports are kept");

  const later = await person("Sid", "innocent_7");
  assert.equal(await hidden(later), false);
  await updateProfile(later, profile("Sid", "SID_BANNED1"), WEB);
  assert.equal(await hidden(later), false, "changing to the banned handle: not verified, never a hide");
  assert.equal(await flagged(later), true, "but listed for /admin");
  // Linking the banned account's number (lib/text/runtime.ts checks on a new number).
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', '+919811100003', 'active')", [later]);
  await rh.checkReportHistory(later);
  assert.equal(await hidden(later), true, "the banned account's number");
});

test("an admin's Restore sticks: earlier reports stop counting for that account, new ones still do", async () => {
  const [r1, r2, r3, r4, r5, r6] = await reporters(6);
  const bad = await texter("Om", "+919811100004", "om_hist1");
  for (const r of [r1, r2, r3]) await report(r, bad);
  await deleteUser(bad, WEB);
  const again = await texter("Om", "+919811100004", "om_hist1");
  assert.equal(await hidden(again), true);
  // /admin Restore (app/api/admin/action op=unhide).
  await pg.query("update users set hidden_at = null, history_reviewed_at = now() where id = $1", [again]);
  await updateProfile(again, profile("Om", "om_hist1b"), WEB);
  await updateProfile(again, profile("Om", "om_hist1"), WEB);
  assert.equal(await hidden(again), false, "a contact change does not re-hide them");
  for (const r of [r4, r5]) await report(r, again);
  assert.equal(await hidden(again), false, "two new reporters: under the threshold");
  await report(r6, again);
  assert.equal(await hidden(again), true);
});

test("without SAFETY_HASH_KEY: sign-ups and reports work as before, nothing is hashed, the report is still kept", async () => {
  const saved = process.env.SAFETY_HASH_KEY;
  delete process.env.SAFETY_HASH_KEY;
  try {
    const reps = await reporters(3);
    const bad = await person("Zed", "zed_nokey1");
    for (const r of reps) await report(r, bad);
    assert.deepEqual((await reportsAbout(bad)).map((r) => r.reported_keys.length), [0, 0, 0]);
    await deleteUser(bad, WEB);
    assert.equal((await reportsAbout(null)).length, 3);
    assert.equal(await hidden(await person("Zed", "zed_nokey1")), false, "unchecked, never a wrong match");
  } finally {
    process.env.SAFETY_HASH_KEY = saved;
  }
});

test("demo isolation: demo accounts get no hashes; demo reporters never hide a real rejoin", async () => {
  const demoReps = await reporters(3, true);
  const bad = await texter("Real", "+919811100007", "real_vs_demo1");
  // A demo account can't report across the line any more (lib/actions.ts shownPartner, N-L4); reports filed before that
  // (raw rows here) still never count.
  for (const r of demoReps) {
    assert.equal(await reportDate(await user(r), await shownDate(r, bad), "harassment", "", WEB), null);
    await pg.query("insert into reports (reporter_id, reported_id, reason, reported_keys) values ($1, $2, 'harassment', $3)", [r, bad, await rh.reportKeys(bad)]);
  }
  await rh.hideOnHistory(bad, await rh.hideKeys(bad));
  assert.equal(await hidden(bad), false, "demo reporters never hide a real resident (as before)");
  await deleteUser(bad, WEB);
  assert.equal(await hidden(await texter("Real", "+919811100007", "real_vs_demo1")), false);

  const reps = await reporters(3);
  const demo = await person("Sam (demo)", "kismet_review_demo", { demo: true });
  assert.deepEqual(await rh.accountKeys(demo), []);
  const banned = await person("X", "shared_handle9");
  await report(reps[0], banned);
  await pg.query("update users set banned_at = now() where id = $1", [banned]);
  await deleteUser(banned, WEB);
  await updateProfile(demo, profile("Sam (demo)", "shared_handle9"), WEB);
  assert.equal(await hidden(demo), false, "a demo account is never matched against real history");
});

test("retention: kept reports go 12 months after the deletion; live accounts' reports never", async () => {
  const [r1] = await reporters(1);
  const live = await person("Live");
  await report(r1, live);
  for (const name of ["Old", "Recent"]) {
    const gone = await person(name);
    await report(r1, gone);
    await deleteUser(gone, WEB);
  }
  // Old: deleted 13 months ago. Recent: 11 months ago (its report filed long before, which does not matter).
  await pg.query(`update reports set reported_gone_at = now() - interval '13 months', created_at = now() - interval '14 months'
    where reported_id is null and id = (select id from reports where reported_id is null order by created_at limit 1)`);
  await pg.query(`update reports set reported_gone_at = now() - interval '11 months', created_at = now() - interval '20 months'
    where reported_id is null and reported_gone_at > now() - interval '1 day'`);
  await pg.query("update reports set created_at = now() - interval '3 years' where reported_id = $1", [live]);
  // Kept by code that does not stamp reported_gone_at (a build from before, a rollback, an old Preview): 12 months after it
  // was filed, never sooner (QA2 N-L2: a 1-hour-old one went the next morning).
  await pg.query(`insert into reports (reporter_id, reported_id, reason, created_at) values ($1, null, 'spam', now() - interval '13 months')`, [r1]);
  await pg.query(`insert into reports (reporter_id, reported_id, reason, note, created_at) values ($1, null, 'harassment', 'fresh', now() - interval '1 hour'),
    ($1, null, 'harassment', 'eleven', now() - interval '11 months')`, [r1]);
  assert.equal(await rh.purgeKeptReports(), 2);
  const left = (await pg.query("select reported_id, reported_gone_at, note from reports order by reported_id nulls first, note")).rows;
  assert.equal(left.length, 4);
  assert.deepEqual(left.filter((r) => !r.reported_gone_at && !r.reported_id).map((r) => r.note).sort(), ["eleven", "fresh"]);
  assert.equal(left.at(-1).reported_id, live);
  assert.equal(await rh.purgeKeptReports(), 0, "nothing more until they are 12 months old");
});

test("the daily job runs the purge first, and a failing purge never stops it", async () => {
  const calls = [];
  const io = {
    dropAbandoned: async () => (calls.push("abandoned"), 0),
    purgeKeptReports: async () => (calls.push("purge"), 4),
    pushAll: async () => (calls.push("push"), 0),
    people: async () => [],
    reserve: async () => [],
    runDates: async () => {},
  };
  const r = await dailyJob(io);
  assert.deepEqual(calls.slice(0, 3), ["abandoned", "purge", "push"]);
  assert.equal(r.keptReports, 4);
  const failed = await dailyJob({ ...io, purgeKeptReports: async () => { throw new Error("down"); } });
  assert.equal(failed.keptReports, 0);
});

test("migration: on a database from before (cascade key under any name, no new columns), twice, keeps every row", async () => {
  const old = new PGlite();
  await migrate(old);
  // Back to the schema in production before this change: reported_id NOT NULL with an ON DELETE CASCADE key (named
  // differently, to prove the name does not matter), and none of the new columns.
  await old.exec(`
    alter table reports drop constraint reports_reported_id_fkey;
    alter table reports add constraint reports_reported_old_fk foreign key (reported_id) references users(id) on delete cascade;
    alter table reports alter column reported_id set not null;
    drop index reports_keys_idx; drop index reports_kept_idx;
    alter table reports drop column reported_keys, drop column reported_gone_at, drop column reported_banned;
    alter table users drop column history_reviewed_at;
    insert into users (id, token_hash, name, telegram, looking_for) values
      ('00000000-0000-4000-8000-000000000001', 'h1', 'A', 'a_tg', '{friends}'),
      ('00000000-0000-4000-8000-000000000002', 'h2', 'B', 'b_tg', '{friends}');
    insert into reports (reporter_id, reported_id, reason, note) values
      ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'spam', 'old report');`);
  const fks = async () => (await old.query(`select conname, confdeltype from pg_constraint where conrelid = 'reports'::regclass and contype = 'f'
    and conkey = array[(select attnum from pg_attribute where attrelid = 'reports'::regclass and attname = 'reported_id')] order by conname`)).rows;
  assert.deepEqual(await fks(), [{ conname: "reports_reported_old_fk", confdeltype: "c" }]);
  await migrate(old);
  await migrate(old);
  assert.deepEqual(await fks(), [{ conname: "reports_reported_id_fkey", confdeltype: "n" }]);
  const cols = (await old.query(`select column_name, is_nullable from information_schema.columns where table_name = 'reports'
    and column_name in ('reported_id', 'reported_keys', 'reported_gone_at', 'reported_banned') order by column_name`)).rows;
  assert.deepEqual(cols.map((c) => `${c.column_name}:${c.is_nullable}`), ["reported_banned:NO", "reported_gone_at:YES", "reported_id:YES", "reported_keys:NO"]);
  // The reporter's key is untouched (still SET NULL), and the old report is there with empty hashes.
  const reporterFk = (await old.query(`select confdeltype from pg_constraint where conrelid = 'reports'::regclass and contype = 'f'
    and conkey = array[(select attnum from pg_attribute where attrelid = 'reports'::regclass and attname = 'reporter_id')]`)).rows;
  assert.deepEqual(reporterFk, [{ confdeltype: "n" }]);
  const [row] = (await old.query("select note, reported_keys from reports")).rows;
  assert.deepEqual(row, { note: "old report", reported_keys: [] });
  // The code from before deletes the user row as it always did: the report is now kept.
  await old.query("delete from users where id = '00000000-0000-4000-8000-000000000002'");
  assert.deepEqual((await old.query("select reported_id, note from reports")).rows, [{ reported_id: null, note: "old report" }]);
  await old.close();
});

test("no poisoning: a hidden or banned person typing someone else's Telegram adds nothing; a visible one's edits add only verified contacts", async () => {
  const reps = await reporters(3);
  const bad = await person("Mallory", "mallory_1");
  for (const r of reps) await report(r, bad);
  assert.equal(await hidden(bad), true);
  const keysAt = (await reportsAbout(bad))[0].reported_keys;
  await updateProfile(bad, profile("Mallory", "victim_handle1"), WEB);
  await rh.refreshReportKeys(bad); // an admin's ban
  await pg.query("update users set banned_at = now() where id = $1", [bad]);
  assert.deepEqual((await reportsAbout(bad))[0].reported_keys, keysAt, "the typed handle is on no report");
  await deleteUser(bad, WEB);
  assert.equal(await hidden(await person("Victim", "victim_handle1")), false, "the real owner of the handle signs up untouched");

  // Visible, under the threshold: rotating handles spreads nothing; a verified contact is added.
  const [r1] = await reporters(1);
  const rot = await person("Rot", "rot_first1");
  await report(r1, rot);
  const before = (await reportsAbout(rot))[0].reported_keys;
  await updateProfile(rot, profile("Rot", "someone_else1"), WEB);
  assert.deepEqual((await reportsAbout(rot))[0].reported_keys, before);
  await linkIdentity({ authUserId: "auth-rot", email: "rot@example.com", name: "Rot" }, rot, WEB);
  assert.equal((await reportsAbout(rot))[0].reported_keys.length, 2, "the sign-in email is added");
});

test("a ban with no report behind it is kept as one (from /admin, or from before), and catches a rejoin", async () => {
  process.env.ADMIN_KEY = "test-admin-key-0123456789abcdef";
  const { adminSession, ADMIN_COOKIE } = await import("./safety.ts");
  const bad = await person("Banned", "banned_noreport");
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', '+919000000001', 'active')", [bad]);
  // /admin's Ban (app/api/admin/action), with an admin session cookie.
  const action = await import("../app/api/admin/action/route.ts");
  const session = adminSession(process.env.ADMIN_KEY);
  globalThis.__testCookies = { [ADMIN_COOKIE]: session };
  const res = await action.POST(new Request("https://kismet.test/api/admin/action", {
    method: "POST", body: new URLSearchParams({ userId: bad, op: "ban" }), headers: { cookie: `${ADMIN_COOKIE}=${session}` },
  }));
  delete globalThis.__testCookies;
  assert.equal(res.status, 303);
  assert.ok((await user(bad)).bannedAt);
  const [rec] = await reportsAbout(bad);
  assert.deepEqual([rec.reporter_id, rec.status, rec.reported_keys.length], [null, "actioned", 2], "Telegram and number, hashed at the ban");
  await updateProfile(bad, profile("Banned", "victim_handle2"), WEB);
  await deleteUser(bad, WEB);
  const [kept] = await reportsAbout(null);
  assert.deepEqual([kept.reported_banned, kept.reported_keys.length], [true, 2], "the handle typed after the ban is not added");
  const again = (await insertUser(profile("B", "brand_new_1"), { channel: "whatsapp", client: "" }, null, [], null, { contacts: { phones: ["+919000000001"] } })).id;
  assert.equal(await hidden(again), true);
  const b2 = await person("B2", "banned_noreport");
  assert.deepEqual([await hidden(b2), await flagged(b2)], [false, true], "the handle held when banned: flagged for /admin, never a hide");
  assert.equal(await hidden(await person("V", "victim_handle2")), false);

  // Banned before this change (no report row): kept at deletion with the verified contacts.
  const old = await person("Older", "older_ban1");
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', '+919000000003', 'active')", [old]);
  await pg.query("update users set banned_at = now() where id = $1", [old]);
  await deleteUser(old, WEB);
  const back = (await insertUser(profile("O", "brand_new_2"), { channel: "whatsapp", client: "" }, null, [], null, { contacts: { phones: ["+919000000003"] } })).id;
  assert.equal(await hidden(back), true);
});

test("a history that reached the threshold still counts after reporters delete their own accounts", async () => {
  const reps = await reporters(3);
  const bad = await person("Hid", "hid_then_gone");
  await pg.query("update users set contact_method = 'phone', contact_phone = '+919000000002' where id = $1", [bad]);
  for (const r of reps) await report(r, bad);
  await deleteUser(bad, WEB);
  await deleteUser(reps[0], WEB);
  assert.equal((await reportsAbout(null)).filter((r) => r.reported_hidden).length, 3);
  const again = (await insertUser(profile("H", "other_handle7"), { channel: "whatsapp", client: "" }, null, [], null, { contacts: { phones: ["+919000000002"] } })).id;
  assert.equal(await hidden(again), true, "2 counted reporters left, but it was hidden when deleted");
});

test("reports filed before the hashes existed are backfilled by the daily job, then catch a second account", async () => {
  const [r1] = await reporters(1);
  const bad = await person("Old", "old_report1");
  await linkIdentity({ authUserId: "auth-old", email: "old@example.com", name: "Old" }, bad, WEB);
  await pg.query("insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'harassment')", [r1, bad]);
  await pg.query("update users set banned_at = now() where id = $1", [bad]);
  assert.equal(await rh.backfillReportKeys(), 1);
  assert.equal((await reportsAbout(bad))[0].reported_keys.length, 1, "the sign-in email (banned: not the Telegram they hold now)");
  assert.equal(await rh.backfillReportKeys(), 0, "once");
  const second = await person("Old2", "different_one");
  await linkIdentity({ authUserId: "auth-old-2", email: "old@example.com", name: "Old2" }, second, WEB);
  assert.equal(await hidden(second), true, "a second live account of a banned person");
});

test("kept notes lose the deleted person's handles too; placeholders and iMessage ids are never hashed; a history hide by report is logged", async () => {
  const reps = await reporters(3);
  const bad = await texter("Alice", "+919811100005", "alice_99");
  await pg.query("update users set x_handle = 'alicex' where id = $1", [bad]);
  await report(reps[0], bad, "his handle is alice_99 and on x alicex, he's a creep");
  await deleteUser(bad, WEB);
  const [kept] = await reportsAbout(null);
  assert.doesNotMatch(kept.note, /alice_99|alicex/i);
  assert.match(kept.note, /creep/);
  // A report filed while the account was being deleted (lib/actions.ts deleteUser, after its transaction).
  const { rows: [late] } = await pg.query("insert into reports (reporter_id, reported_id, reason, note) values ($1, null, 'spam', 'Alice is alice_99 call +91 98765 43210') returning id", [reps[0]]);
  await rh.scrubLateNotes([late.id], ["Alice", "alice_99"]);
  const { rows: [scrubbed] } = await pg.query("select note from reports where id = $1", [late.id]);
  assert.doesNotMatch(scrubbed.note, /Alice|alice_99|98765/);
  await pg.query("delete from reports where id = $1", [late.id]);

  const key = process.env.SAFETY_HASH_KEY;
  assert.deepEqual(rh.contactKeys({ telegram: "none" }, key), []);
  assert.deepEqual(rh.contactKeys({ telegram: "@Test" }, key), []);
  assert.deepEqual(rh.contactKeys({ phones: ["a1234567@icloud.com"] }, key), []);

  // Under the threshold at rejoin; the next report hides them through the history, which /admin lists.
  await report(reps[1], await person("x", "alice_99_old")); // noise
  const again = await texter("Alice", "+919811100005", "alice_99");
  await report(reps[1], again);
  await report(reps[2], again);
  assert.equal(await hidden(again), true);
  const { rows } = await pg.query("select meta from activity_log where user_id = $1 and action = 'report_history'", [again]);
  assert.equal(rows.length, 1);
});

test("second review: backfill and new reports skip a suspended account's Telegram; a pending (maybe wrong) hide is not passed on", async () => {
  // B1: banned before the hashes, then types a victim's handle: the backfill adds only verified contacts.
  const [r1, r2, r3] = await reporters(3);
  const old = await person("Eve", "eve_first1");
  await pg.query("insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'spam')", [r1, old]);
  await pg.query("insert into user_phones (user_id, channel, phone, state) values ($1, 'whatsapp', '+919000000004', 'active')", [old]);
  await pg.query("update users set banned_at = now(), telegram = 'victim_handle3' where id = $1", [old]);
  await rh.backfillReportKeys();
  assert.deepEqual((await reportsAbout(old))[0].reported_keys, rh.contactKeys({ phones: ["+919000000004"] }, process.env.SAFETY_HASH_KEY));
  // B2: a report filed on that banned account (a date from before) carries no Telegram either.
  await report(r2, old);
  assert.equal((await reportsAbout(old)).at(-1).reported_keys.length, 1);
  assert.equal(await hidden(await person("V3", "victim_handle3")), false);

  // B3: hidden only by a history match (pending review), one report of its own, deleted: not passed on as "was hidden".
  const banned = await person("Ban", "shared_tg_77");
  await linkIdentity({ authUserId: "auth-ban-b3", email: "shared.b3+k@gmail.com", name: "Ban" }, banned, WEB);
  await report(r3, banned);
  await pg.query("update users set banned_at = now() where id = $1", [banned]);
  const tgOnly = await person("Innocent T", "shared_tg_77");
  assert.deepEqual([await hidden(tgOnly), await flagged(tgOnly)], [false, true], "the Telegram alone never hides");
  const matched = await person("Innocent", "innocent_b3");
  await pg.query("update users set contact_method = 'phone', contact_phone = '+919000000005' where id = $1", [matched]);
  await linkIdentity({ authUserId: "auth-inn-b3", email: "sharedb3@gmail.com", name: "Innocent" }, matched, WEB);
  assert.equal(await hidden(matched), true, "the email match hides pending review");
  await report(r1, matched);
  await deleteUser(matched, WEB);
  const kept = (await reportsAbout(null)).find((r) => r.reporter_id === r1);
  assert.equal(kept.reported_hidden, false);
  const later = (await insertUser(profile("I", "brand_new_3"), { channel: "whatsapp", client: "" }, null, [], null, { contacts: { phones: ["+919000000005"] } })).id;
  assert.equal(await hidden(later), false, "their number does not inherit the wrong match");
});

test("second review: unban removes the ban's own record", async () => {
  const { adminSession, ADMIN_COOKIE } = await import("./safety.ts");
  const action = await import("../app/api/admin/action/route.ts");
  const u = await person("Unb", "unban_me_1");
  const post = async (op) => {
    globalThis.__testCookies = { [ADMIN_COOKIE]: adminSession(process.env.ADMIN_KEY) };
    try {
      return await action.POST(new Request("https://kismet.test/api/admin/action", { method: "POST", body: new URLSearchParams({ userId: u, op }) }));
    } finally {
      delete globalThis.__testCookies;
    }
  };
  assert.equal((await post("ban")).status, 303);
  assert.equal((await reportsAbout(u)).length, 1);
  assert.equal((await post("unban")).status, 303);
  assert.equal((await reportsAbout(u)).length, 0);
  assert.equal((await user(u)).bannedAt, null);
});

// QA2 N-M2 (backend/report-history-probe.test.mjs): an impersonator using a real person's Telegram must never get the real
// owner hidden, whether the impersonator was banned by an admin or reported over the threshold.
const adminBan = async (userId) => {
  process.env.ADMIN_KEY ??= "test-admin-key-0123456789abcdef";
  const { adminSession, ADMIN_COOKIE } = await import("./safety.ts");
  const action = await import("../app/api/admin/action/route.ts");
  globalThis.__testCookies = { [ADMIN_COOKIE]: adminSession(process.env.ADMIN_KEY) };
  try {
    const res = await action.POST(new Request("https://kismet.test/api/admin/action", { method: "POST", body: new URLSearchParams({ userId, op: "ban" }) }));
    assert.equal(res.status, 303);
  } finally {
    delete globalThis.__testCookies;
  }
};

test("POISON-1: an impersonator banned by an admin under a real person's Telegram never hides the real owner at sign-up", async () => {
  const [r1] = await reporters(1);
  const fake = await person("Fake Priya", "priya_real_tg");
  await report(r1, fake);
  await adminBan(fake);
  const keys = (await reportsAbout(fake)).flatMap((r) => r.reported_keys);
  assert.ok(keys.includes(rh.contactKeys({ telegram: "priya_real_tg" })[0]), "the Telegram is on the reports (for /admin)");
  const priya = await person("Priya", "Priya_Real_TG");
  assert.equal(await hidden(priya), false, "the real owner is not hidden");
  assert.equal(await flagged(priya), true, "/admin lists the match");
  // The impersonator deleted, then the owner joins: the same.
  await deleteUser(fake, WEB);
  const priya2 = await person("Priya", "priya_real_tg");
  assert.equal(await hidden(priya2), false);
});

test("POISON-2: an impersonator reported 3x under a real owner's Telegram never gets the existing owner hidden on one report", async () => {
  const reps = await reporters(4);
  const owner = await person("Arjun", "arjun_owner1");
  const fake = await person("Arjun", "arjun_owner1"); // no uniqueness on users.telegram
  for (const r of reps.slice(0, 3)) await report(r, fake);
  assert.equal(await hidden(fake), true);
  assert.equal(await hidden(owner), false);
  await report(reps[3], owner); // a single report about the owner
  assert.equal(await hidden(owner), false, "one report of their own: under the threshold");
  // A verified contact still counts: the same number as the reported account.
  const reps2 = await reporters(3);
  const bad = await texter("Kabir", "+919811100006");
  for (const r of reps2) await report(r, bad);
  await deleteUser(bad, WEB);
  const second = await texter("Kabir 2", "+919811100006");
  assert.equal(await hidden(second), true, "a phone match hides (as before)");
});

test("N-L1: placeholder handles are never hashed, so a stranger typing the same placeholder inherits nothing (PLACEHOLDER-2)", async () => {
  const key = process.env.SAFETY_HASH_KEY;
  for (const h of ["xxxxx", "12345", "abcde", "nohandle", "no_tg", "notgyet", "aaaaa", "qwerty", "dont_have", "idonthave", "nothing", "noone",
    "na_na_na", "_____", "11111", "nope_", "none_", "x_x_x_x", "username", "@None", "t.me/no_tg"]) {
    assert.deepEqual(rh.contactKeys({ telegram: h }, key), [], h);
  }
  for (const h of ["deex_99", "priya_real_tg", "Rahul_X9", "abcdesigns", "noraj_s"]) assert.equal(rh.contactKeys({ telegram: h }, key).length, 1, h);
  // Telegram's format at sign-up: digits-first, all-underscore or a trailing underscore are refused (a clean 400).
  for (const h of ["12345", "_____", "nope_", "1abcd"]) assert.match(parseProfile({ name: "P", telegram: h, lookingFor: ["friends"], interests: INTERESTS }).error, /^telegram:/, h);
  // A handle saved under the old rule is kept by an edit that sends it back unchanged (any case, @ or link).
  const { parseEdit } = await import("./validate.ts");
  const me = { telegram: "1oldhandle_", contactMethod: null, contactPhone: null };
  const edit = parseEdit({ name: "P", telegram: "@1OldHandle_", lookingFor: ["friends"], interests: INTERESTS }, me);
  assert.equal(edit.profile?.telegram, "1OldHandle_");
  assert.equal(parseEdit({ name: "P", lookingFor: ["friends"], interests: INTERESTS }, me).profile?.telegram, "1oldhandle_");
  assert.match(parseEdit({ name: "P", telegram: "2newhandle_", lookingFor: ["friends"], interests: INTERESTS }, me).error, /^telegram:/, "a new one is checked");

  // PLACEHOLDER-2: a banned user who typed "xxxxx", deleted; a stranger who types "xxxxx" is untouched.
  const [r1] = await reporters(1);
  const bad = await person("Bad", "xxxxx");
  await report(r1, bad);
  await pg.query("update users set banned_at = now() where id = $1", [bad]);
  await deleteUser(bad, WEB);
  const stranger = await person("Stranger", "xxxxx");
  assert.deepEqual([await hidden(stranger), await flagged(stranger)], [false, false]);
});
