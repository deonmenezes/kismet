// Run: npm test. The model contact check on the real write paths and the daily backfill (lib/contact-check.ts,
// lib/contact-backfill.ts), real modules on PGlite (db/schema.sql), the model mocked: every door's sign-up, an edit and
// notes go through insertUser / updateProfile / addNotes; a model that is down saves the regex text unchecked; the daily
// job checks unchecked rows once, never a row edited since it was read, and never blocks the rest of the job.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, migrate } from "./test-support/pg.mjs";

const pg = await freshDb();
const { insertUser, updateProfile, addAgentNotes } = await import("./actions.ts");
const { parseProfile } = await import("./validate.ts");
const { backfillContactChecks, MAX_ATTEMPTS } = await import("./contact-backfill.ts");
const { dailyJob } = await import("./daily.ts");
const { afterQueue } = await import("next/server");

const WEB = { channel: "web", client: "" };
const VILLAGE = { channel: "village", client: "" };
const down = globalThis.__kismetContactModel;
let calls = [];
/** The model, mocked: names each of `spans` wherever it occurs in a field. */
const model = (spans) => {
  globalThis.__kismetContactModel = async ({ prompt }) => {
    calls.push(prompt);
    const found = [];
    for (const m of prompt.matchAll(/<field name="([^"]+)">\n([\s\S]*?)\n<\/field>/g)) for (const s of spans) if (m[2].includes(s)) found.push({ field: m[1], text: s });
    return JSON.stringify({ found });
  };
};
const SPANS = ["find me on the gram, k a b i r s u r f s", "inst@: meera.paints", "the word saltwater on the bird app", "snap biscuit"];
const profile = (bio, extra = {}) => {
  const r = parseProfile({ name: "Kabir", telegram: `kabir_${Math.random().toString(36).slice(2, 8)}`, lookingFor: ["friends"], interests: ["Surfing"], bio, edgeCity: true, ...extra });
  assert.ok(r.profile, r.error);
  return r.profile;
};
const row = async (id) => (await pg.query("select bio, interests, tags, persona_card, contacts_checked_at from users where id = $1", [id])).rows[0];
const notes = async (id) => (await pg.query("select text, contacts_checked_at from agent_notes where user_id = $1 order by text", [id])).rows;
const quietly = async (fn) => {
  const w = console.warn, l = console.log, e = console.error;
  console.warn = console.log = console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.log = l; console.error = e; }
};

afterEach(async () => {
  globalThis.__kismetContactModel = down;
  calls = [];
  afterQueue.length = 0;
  await pg.exec("delete from agent_notes; delete from activity_log; delete from profile_history; delete from users;");
});

test("the migration is idempotent and leaves rows from before unchecked", async () => {
  await migrate(pg);
  await migrate(pg);
  await pg.query("insert into users (token_hash, name, telegram, looking_for, bio) values ('t1', 'Old', 'old_one', '{friends}', 'snap biscuit')");
  assert.equal((await pg.query("select contacts_checked_at from users")).rows[0].contacts_checked_at, null);
});

test("sign-up: the clue goes and the row is checked; the notes sent with it are screened in the same call", async () => {
  model(SPANS);
  const { id } = await quietly(() => insertUser(profile("Potter. find me on the gram, k a b i r s u r f s"), WEB, null, ["Usually inst@: meera.paints", "Loves surf"]));
  const u = await row(id);
  assert.equal(u.bio, "Potter. [removed]");
  assert.ok(u.contacts_checked_at);
  assert.deepEqual((await notes(id)).map((n) => [n.text, Boolean(n.contacts_checked_at)]), [["Loves surf", true], ["Usually [removed]", true]]);
  assert.equal(calls.length, 1);
});

test("sign-up with the model down: saved as stripContacts left it, unchecked, and the sign-up still succeeds", async () => {
  const { id } = await quietly(() => insertUser(profile("snap biscuit"), VILLAGE, "resident-1", ["the word saltwater on the bird app"]));
  const u = await row(id);
  assert.equal(u.bio, "snap biscuit");
  assert.equal(u.contacts_checked_at, null);
  assert.deepEqual((await notes(id)).map((n) => n.contacts_checked_at), [null]);
});

test("a plain bio is checked without a model call", async () => {
  model(SPANS);
  const { id } = await insertUser(profile("Into chai, jazz and long walks at Mandrem."), WEB);
  assert.ok((await row(id)).contacts_checked_at);
  assert.equal(calls.length, 0);
});

test("edit: a changed bio is checked; an edit that leaves the checked text as it was makes no call", async () => {
  model(SPANS);
  const { id } = await insertUser(profile("Into chai and jazz."), WEB);
  await quietly(() => updateProfile(id, profile("Into chai and jazz. snap biscuit"), WEB));
  assert.equal((await row(id)).bio, "Into chai and jazz. [removed]");
  assert.equal(calls.length, 1);
  await updateProfile(id, profile("Into chai and jazz. [removed]", { availability: "weekends" }), WEB);
  assert.equal(calls.length, 1, "nothing screened changed");
  assert.ok((await row(id)).contacts_checked_at);
  // Down on the next real change: saved unchecked (the daily job checks it).
  globalThis.__kismetContactModel = down;
  await quietly(() => updateProfile(id, profile("New bio, find me on the gram, k a b i r s u r f s"), WEB));
  assert.deepEqual([(await row(id)).bio, (await row(id)).contacts_checked_at], ["New bio, find me on the gram, k a b i r s u r f s", null]);
});

test("edit: the same raw text sent again (an agent's own copy) reuses its check: no call, and a model outage can't undo it", async () => {
  model(SPANS);
  const raw = "Potter. snap biscuit";
  const { id } = await quietly(() => insertUser(profile(raw), VILLAGE, "resident-r"));
  assert.equal((await row(id)).bio, "Potter. [removed]");
  calls = [];
  globalThis.__kismetContactModel = down;
  await updateProfile(id, profile(raw), VILLAGE);
  assert.equal(calls.length, 0);
  const u = await row(id);
  assert.deepEqual([u.bio, Boolean(u.contacts_checked_at)], ["Potter. [removed]", true]);
});

test("edit: an area left out is the stored one, and an unchecked stored area is screened with the edit", async () => {
  const [{ id }] = (await pg.query("insert into users (token_hash, name, telegram, looking_for, bio, area) values ('ta', 'Ana', 'ana_tg', '{friends}', 'Hi', 'Mandrem, snap biscuit') returning id")).rows;
  model(SPANS);
  await quietly(() => updateProfile(id, profile("Hi again"), WEB)); // no area in the edit
  const [u] = (await pg.query("select area, contacts_checked_at from users where id = $1", [id])).rows;
  assert.deepEqual([u.area, Boolean(u.contacts_checked_at)], ["Mandrem, [removed]", true]);
});

test("notes added by an agent are screened; a note that was only a contact is not kept", async () => {
  model(SPANS);
  const { id } = await insertUser(profile("Into chai."), WEB);
  assert.equal(await quietly(() => addAgentNotes(id, ["snap biscuit", "Builds boats"], WEB)), 1);
  assert.deepEqual((await notes(id)).map((n) => n.text), ["Builds boats"]);
});

test("backfill: unchecked rows are checked once, clues removed, the card cleared; a rerun makes no call", async () => {
  // Rows from before the check (and one saved while the model was down).
  const ins = async (bio, interests = ["Surfing"]) => (await pg.query(
    "insert into users (token_hash, name, telegram, looking_for, bio, interests, tags, persona_card, profile_hash) values ($1, 'Xan', $1, '{friends}', $2, $3, $4, 'Kabir surfs, find him on the gram', 'a:b') returning id",
    [`t${Math.random()}`, bio, interests, interests.map((s) => s.toLowerCase())])).rows[0].id;
  const evasive = await ins("Surfer. find me on the gram, k a b i r s u r f s", ["Surfing", "insta", "kabirsurfs"]);
  const plain = await ins("Into chai and jazz.");
  const innocent = await ins("Telegram groups are where I find all the Goa events");
  await pg.query("insert into agent_notes (user_id, text, source) values ($1, 'Usually inst@: meera.paints', 'web'), ($1, 'Builds boats', 'web'), ($1, 'snap biscuit', 'web')", [plain]);
  model([...SPANS, "kabirsurfs"]);
  const r = await quietly(() => backfillContactChecks());
  assert.deepEqual(r, { users: 3, notes: 3, changed: 3, failed: 0 });
  const e = await row(evasive);
  assert.equal(e.bio, "Surfer. [removed]");
  assert.deepEqual(e.interests, ["Surfing", "insta"]);
  assert.deepEqual(e.tags, ["surfing", "insta"]);
  assert.equal(e.persona_card, "", "the card written from the old bio goes");
  assert.equal((await row(innocent)).bio, "Telegram groups are where I find all the Goa events");
  assert.ok((await row(innocent)).persona_card, "unchanged rows keep their card");
  assert.deepEqual((await notes(plain)).map((n) => n.text), ["Builds boats", "Usually [removed]"]);
  assert.equal((await row(plain)).persona_card, "");
  // One call per thing worth checking (the evasive profile, the app-naming innocent one, the plain account's notes); the
  // plain profile and the plain note need none.
  assert.equal(calls.length, 3);
  assert.ok(!calls.some((c) => c.includes("Into chai and jazz.")));
  calls = [];
  assert.deepEqual(await backfillContactChecks(), { users: 0, notes: 0, changed: 0, failed: 0 });
  assert.equal(calls.length, 0);
});

test("backfill: the model down leaves rows unchecked for the next run; a row edited since it was read is left alone", async () => {
  const { id } = await quietly(() => insertUser(profile("snap biscuit"), WEB));
  assert.equal((await row(id)).contacts_checked_at, null);
  const failed = await quietly(() => backfillContactChecks());
  assert.deepEqual(failed, { users: 0, notes: 0, changed: 0, failed: 1 });
  assert.equal((await row(id)).contacts_checked_at, null);
  // The person edits while the backfill's model call is in flight: the backfill doesn't overwrite the edit.
  globalThis.__kismetContactModel = async ({ prompt }) => {
    await pg.query("update users set bio = 'Brand new bio', updated_at = now() + interval '1 second' where id = $1", [id]);
    return JSON.stringify({ found: prompt.includes("snap biscuit") ? [{ field: "bio", text: "snap biscuit" }] : [] });
  };
  const raced = await quietly(() => backfillContactChecks());
  assert.equal(raced.users, 0);
  assert.deepEqual([(await row(id)).bio, (await row(id)).contacts_checked_at], ["Brand new bio", null]);
});

test("backfill: a row that keeps failing stops after MAX_ATTEMPTS and never holds the queue; a change is in profile history", async () => {
  const [{ id: stuck }] = (await pg.query("insert into users (token_hash, name, telegram, looking_for, bio) values ('ts', 'Sam', 'sam_tg', '{friends}', 'snap biscuit') returning id")).rows;
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await quietly(() => backfillContactChecks())).failed, 1);
  assert.equal((await pg.query("select contacts_check_attempts from users where id = $1", [stuck])).rows[0].contacts_check_attempts, MAX_ATTEMPTS);
  assert.deepEqual(await quietly(() => backfillContactChecks()), { users: 0, notes: 0, changed: 0, failed: 0 }, "left for a person");
  const [{ id: later }] = (await pg.query("insert into users (token_hash, name, telegram, looking_for, bio) values ('tl', 'Lia', 'lia_tg', '{friends}', 'Potter. inst@: meera.paints') returning id")).rows;
  model(SPANS);
  assert.equal((await quietly(() => backfillContactChecks())).changed, 1);
  assert.equal((await row(later)).bio, "Potter. [removed]");
  const hist = (await pg.query("select field, new_value, channel from profile_history where user_id = $1", [later])).rows;
  assert.deepEqual(hist.map((h) => [h.field, h.new_value, h.channel]), [["bio", "Potter. [removed]", "system"]]);
});

test("backfill: a reply with a span in no field keeps what it did remove, stays unchecked and counts an attempt", async () => {
  const [{ id }] = (await pg.query("insert into users (token_hash, name, telegram, looking_for, bio) values ('tp', 'Pia', 'pia_tg', '{friends}', 'snap biscuit and the bird app as saltwater') returning id")).rows;
  globalThis.__kismetContactModel = async () => JSON.stringify({ found: [{ field: "bio", text: "snap biscuit" }, { field: "bio", text: "salt-water-99" }] });
  const r = await quietly(() => backfillContactChecks());
  assert.deepEqual([r.failed, r.changed, r.users], [1, 1, 0]);
  const [u] = (await pg.query("select bio, contacts_checked_at, contacts_check_attempts from users where id = $1", [id])).rows;
  assert.deepEqual([u.bio, u.contacts_checked_at, u.contacts_check_attempts], ["[removed] and the bird app as saltwater", null, 1]);
});

test("daily job: the contact checks run before the dates, and a failure never stops the job", async () => {
  const order = [];
  const io = {
    dropAbandoned: async () => 0,
    pushAll: async () => (order.push("push"), 0),
    contactChecks: async () => (order.push("contacts"), 7),
    people: async () => (order.push("people"), []),
    reserve: async () => [],
    runDates: async () => {},
  };
  const r = await dailyJob(io);
  assert.deepEqual(order, ["push", "contacts", "people"]);
  assert.equal(r.contactChecks, 7);
  const failed = await quietly(() => dailyJob({ ...io, contactChecks: async () => { throw new Error("down"); } }));
  assert.equal(failed.contactChecks, 0);
});
