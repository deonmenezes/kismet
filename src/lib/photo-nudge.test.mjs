// Run: npm test. Asking for a photo without nagging (lib/photo-nudge.ts: when each ask shows on this device) and who
// may be asked at all (lib/photos.ts addPhotoHint, on a real Postgres: PGlite in memory), with the chat view's flags.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";
import {
  ASK_GAP_MS, askedMemo, comeBackAt, dismissMemo, firstWord, FOR_GOOD, hiddenNow, isFresh, LEGACY_HINT_KEY, loadMemo, NO_MEMO, NUDGE_KEY,
  readMemo, saveMemo, showCardLine, showHomeCard, showPhotoCard, showSessionAsk, SNOOZE_MS,
} from "./photo-nudge.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-30T12:00:00Z");

// ---- This device: snooze, back once, then for good -----------------------------------------------------------------

test("a stored memo is read back; anything unreadable is a fresh start; the old chat 'Not now' is for good", () => {
  assert.deepEqual(readMemo(JSON.stringify({ n: 1, until: NOW + 5 })), { n: 1, until: NOW + 5 });
  for (const raw of [null, undefined, "", "no", "{", "[]", JSON.stringify({ n: -1, until: 0 }), JSON.stringify({ n: 1.5, until: 0 }), JSON.stringify({ n: 1, until: "x" })]) {
    assert.deepEqual(readMemo(raw), NO_MEMO, String(raw));
  }
  assert.equal(readMemo(null, "no").n, FOR_GOOD);
  assert.equal(hiddenNow(readMemo(null, "no"), NOW), true);
  assert.deepEqual(readMemo(null, "yes"), NO_MEMO);
  assert.deepEqual(readMemo(JSON.stringify({ n: 0, until: 0, asked: NOW })), { n: 0, until: 0, asked: NOW });
});

test("the memo is read from and written to this device's storage; a blocked one is a fresh start", () => {
  const data = new Map();
  const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  assert.deepEqual(loadMemo(store), NO_MEMO);
  saveMemo(store, { n: 1, until: NOW });
  assert.deepEqual(loadMemo(store), { n: 1, until: NOW }, "what another tab saved is what a dismissal starts from");
  data.set(LEGACY_HINT_KEY, "no");
  assert.equal(loadMemo(store).n, FOR_GOOD);
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.deepEqual(loadMemo(blocked), NO_MEMO);
  assert.doesNotThrow(() => saveMemo(blocked, NO_MEMO));
  assert.deepEqual(loadMemo(null), NO_MEMO);
  assert.equal(data.has(NUDGE_KEY), true);
});

test("the first 'Not now' hides an ask for a few days, it comes back once, and the second is for good", () => {
  const once = dismissMemo(NO_MEMO, NOW);
  assert.deepEqual(once, { n: 1, until: NOW + SNOOZE_MS });
  assert.equal(hiddenNow(once, NOW + SNOOZE_MS - 1), true);
  assert.equal(hiddenNow(once, NOW + SNOOZE_MS), false, "back after the snooze");
  const twice = dismissMemo(once, NOW + SNOOZE_MS);
  assert.equal(twice.n, FOR_GOOD);
  assert.equal(dismissMemo(askedMemo(NO_MEMO, NOW), NOW).asked, NOW, "a dismissal keeps when the chat last asked");
  assert.equal(hiddenNow(twice, NOW + 365 * 24 * HOUR), true, "never back on this device");
});

test("it comes back before a drop when the drop is sooner than the snooze, but never within 12 hours", () => {
  const drop = (h) => new Date(NOW + h * HOUR).toISOString();
  assert.equal(comeBackAt(NOW, drop(30)), NOW + 27 * HOUR, "3 hours before a drop in 30 hours");
  assert.equal(comeBackAt(NOW, drop(10)), NOW + SNOOZE_MS, "a drop in 10 hours is too soon: the full snooze");
  assert.equal(comeBackAt(NOW, drop(24 * 5)), NOW + SNOOZE_MS, "a drop after the snooze: the snooze");
  assert.equal(comeBackAt(NOW, null), NOW + SNOOZE_MS);
  assert.equal(comeBackAt(NOW, "not a date"), NOW + SNOOZE_MS);
  assert.equal(dismissMemo(NO_MEMO, NOW, drop(30)).until, NOW + 27 * HOUR);
});

// ---- Where each ask shows ---------------------------------------------------------------------------------------------

const ask = { eligible: true, memo: NO_MEMO, now: NOW };
const snoozed = dismissMemo(NO_MEMO, NOW);

test("the chat's photo card: right after sign-up or with a Google picture, never when not eligible or waved off", () => {
  assert.equal(showPhotoCard({ ...ask, fresh: true, google: false }), true, "just signed up");
  assert.equal(showPhotoCard({ ...ask, fresh: false, google: true }), true, "the Google picture question");
  assert.equal(showPhotoCard({ ...ask, fresh: false, google: false }), false, "an older account gets the session mention instead");
  assert.equal(showPhotoCard({ ...ask, eligible: false, fresh: true, google: true }), false, "has a photo, or chose none");
  assert.equal(showPhotoCard({ ...ask, memo: snoozed, fresh: true, google: true }), false, "Skip waits");
  assert.equal(showPhotoCard({ ...ask, memo: snoozed, now: NOW + SNOOZE_MS, fresh: false, google: true }), true, "and comes back once");
});

test("the first message of a session mentions the photo once, never beside the card", () => {
  const s = { ...ask, fresh: false, google: false, askedThisSession: false };
  assert.equal(showSessionAsk(s), true);
  assert.equal(showSessionAsk({ ...s, askedThisSession: true }), false, "once per session, not every message");
  assert.equal(showSessionAsk({ ...s, fresh: true }), false, "right after sign-up the card asks");
  assert.equal(showSessionAsk({ ...s, google: true }), false, "the Google card asks");
  assert.equal(showSessionAsk({ ...s, eligible: false }), false);
  assert.equal(showSessionAsk({ ...s, memo: snoozed }), false);
  assert.equal(showSessionAsk({ ...s, memo: readMemo(null, "no") }), false, "the old 'Not now' still holds");
  // A phone opens many tabs (links from Telegram, the app): one mention a day on this device, whatever the tabs.
  const asked = askedMemo(NO_MEMO, NOW);
  assert.equal(showSessionAsk({ ...s, memo: asked, now: NOW + ASK_GAP_MS - 1 }), false, "a new tab the same day");
  assert.equal(showSessionAsk({ ...s, memo: asked, now: NOW + ASK_GAP_MS }), true, "the next day");
});

test("the /home card: no photo, eligible, not waved off", () => {
  assert.equal(showHomeCard({ ...ask, photos: 0 }), true);
  assert.equal(showHomeCard({ ...ask, photos: 1 }), false, "never to someone with a photo");
  assert.equal(showHomeCard({ ...ask, eligible: false, photos: 0 }), false, "never after removing one or saying no to Google");
  assert.equal(showHomeCard({ ...ask, memo: snoozed, photos: 0 }), false, "hidden a few days");
  assert.equal(showHomeCard({ ...ask, memo: snoozed, now: NOW + SNOOZE_MS, photos: 0 }), true, "back once");
  assert.equal(showHomeCard({ ...ask, memo: dismissMemo(snoozed, NOW + SNOOZE_MS), now: NOW + 30 * SNOOZE_MS, photos: 0 }), false, "then never");
});

test("the match / plan card line: no photo and eligible, kept while snoozed, gone for good; it names them by first name", () => {
  assert.equal(showCardLine({ eligible: true, photos: 0, memo: NO_MEMO }), true);
  assert.equal(showCardLine({ eligible: true, photos: 2, memo: NO_MEMO }), false);
  assert.equal(showCardLine({ eligible: false, photos: 0, memo: NO_MEMO }), false);
  assert.equal(showCardLine({ eligible: true, photos: 0, memo: snoozed }), true, "small and in context: not snoozed");
  assert.equal(showCardLine({ eligible: true, photos: 0, memo: readMemo(null, "no") }), false, "waved off for good");
  assert.equal(firstWord("  Priya Sharma "), "Priya");
  assert.equal(firstWord("Sam (demo)"), "Sam");
});

test("an account under a day old has just signed up", () => {
  assert.equal(isFresh(new Date(NOW - HOUR).toISOString(), NOW), true);
  assert.equal(isFresh(new Date(NOW - 25 * HOUR).toISOString(), NOW), false);
});

// ---- Who may be asked at all (server) -----------------------------------------------------------------------------------

const pg = await freshDb();
const { insertUser } = await import("./actions.ts");
const { toUser } = await import("./db.ts");
const { parseProfile } = await import("./validate.ts");
const { addPhotoHint } = await import("./photos.ts");
const { view } = await import("./text/web-chat.ts");

async function person(name, { demo = false } = {}) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase().replace(/\W/g, "")}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], edgeCity: true });
  const id = (await insertUser(r.profile, { channel: "web", client: "" })).id;
  if (demo) await pg.query("update users set is_demo = true where id = $1", [id]);
  return id;
}
const photo = (id) => pg.query("insert into photos (user_id, pathname, source, width, height) values ($1, 'p/x/y.jpg', 'upload', 10, 10)", [id]);
const log = (id, action, meta = {}) => pg.query("insert into activity_log (user_id, channel, action, meta) values ($1, 'web', $2, $3::jsonb)", [id, action, JSON.stringify(meta)]);
afterEach(() => pg.exec("delete from photos; delete from activity_log; delete from user_phones; delete from auth_identities; delete from users;"));

test("asked only with no photo, and never after removing one or saying no to the Google picture", async () => {
  const id = await person("Mia");
  assert.equal(await addPhotoHint(id), true, "no photo, no choice made");
  await photo(id);
  assert.equal(await addPhotoHint(id), false, "has a photo");
  await pg.query("delete from photos");
  await log(id, "photo_remove", { photoId: "x" });
  assert.equal(await addPhotoHint(id), false, "removed one on purpose");

  const no = await person("Noa");
  await log(no, "google_photo", { answer: "no" });
  assert.equal(await addPhotoHint(no), false, "said no to the Google picture");

  // The check refused a Google letter avatar: not their choice, so an upload may still be asked for.
  const refused = await person("Ria");
  await log(refused, "google_photo", { answer: "refused" });
  assert.equal(await addPhotoHint(refused), true);
});

test("demo accounts follow the same rule, and asking writes nothing", async () => {
  const sam = await person("Sam (demo)", { demo: true });
  const before = (await pg.query("select (select count(*) from activity_log) a, (select count(*) from photos) p, (select updated_at from users where id = $1) u", [sam])).rows[0];
  assert.equal(await addPhotoHint(sam), true);
  await photo(sam);
  assert.equal(await addPhotoHint(sam), false);
  await pg.query("delete from photos");
  const after = (await pg.query("select (select count(*) from activity_log) a, (select count(*) from photos) p, (select updated_at from users where id = $1) u", [sam])).rows[0];
  assert.deepEqual(after, before);
});

// ---- The chat view's flags ------------------------------------------------------------------------------------------------

async function chatOf(id, { ageHours = 0, identity = null } = {}) {
  await pg.query("update users set created_at = now() - make_interval(hours => $2) where id = $1", [id, ageHours]);
  await pg.query("insert into user_phones (user_id, channel, phone, state, verified_at) values ($1, 'web', $2, 'active', now())", [id, `web:u:${id}`]);
  await pg.query("insert into conversation_messages (phone_id, direction, text) select id, 'out', 'You''re in!' from user_phones where user_id = $1", [id]);
  const me = toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
  return view({ me, identity, connect: null });
}

test("the chat view: a new account gets the photo step; an older one just the ask; none with a photo", async () => {
  const fresh = await chatOf(await person("Ana"));
  assert.equal(fresh.addPhoto, true);
  assert.equal(fresh.photoStep, true, "just signed up");

  const older = await chatOf(await person("Ben"), { ageHours: 48 });
  assert.equal(older.addPhoto, true);
  assert.equal(older.photoStep, false);

  const withPhoto = await person("Cai");
  await photo(withPhoto);
  const v = await chatOf(withPhoto);
  assert.equal(v.addPhoto, false);
  assert.equal(v.photoStep, false);

  const chose = await person("Dev");
  await log(chose, "google_photo", { answer: "no" });
  const c = await chatOf(chose);
  assert.equal(c.addPhoto, false, "said no to the Google picture: not asked");
  assert.equal(c.photoStep, false);

  const sam = await person("Sam (demo)", { demo: true });
  const d = await chatOf(sam, { ageHours: 24 * 20 });
  assert.equal(d.addPhoto, true, "the demo account: the same rule");
  assert.equal(d.photoStep, false);
});

// A Google sign-in with a picture (Neon Auth keeps it; PGlite gets a small stand-in of its table).
await pg.exec(`create schema if not exists neon_auth; create table if not exists neon_auth."user" (id uuid primary key, image text)`);
async function googleSignIn(id) {
  const authId = crypto.randomUUID();
  await pg.query(`insert into neon_auth."user" (id, image) values ($1, 'https://lh3.googleusercontent.com/a/test=s96-c')`, [authId]);
  await pg.query("insert into auth_identities (auth_user_id, user_id, email) values ($1, $2, 'g@example.com')", [authId, id]);
  return { authUserId: authId, email: "g@example.com", name: "Gia Rao" };
}

test("the Google picture question goes with the photo ask, and never holds back the training question", async () => {
  const fresh = await person("Gia");
  const identity = await googleSignIn(fresh);
  let v = await chatOf(fresh, { identity });
  assert.deepEqual([v.googlePhoto, v.addPhoto, v.photoStep], [true, true, true], "just signed up with a Google picture");

  // Older, and 90+ minutes in: training is due even with the Google question unanswered (Skip never answers it).
  const older = await person("Hal");
  const id2 = await googleSignIn(older);
  await pg.query("insert into user_channels (user_id, channel, active_minutes) values ($1, 'web', 120) on conflict (user_id, channel) do update set active_minutes = 120", [older]);
  v = await chatOf(older, { ageHours: 72, identity: id2 });
  assert.deepEqual([v.googlePhoto, v.addPhoto, v.photoStep, v.training], [true, true, false, true]);

  // A refused letter avatar: no more Google question, but an upload may still be asked for.
  const refused = await person("Ivo");
  const id3 = await googleSignIn(refused);
  await log(refused, "google_photo", { answer: "refused" });
  v = await chatOf(refused, { ageHours: 72, identity: id3 });
  assert.deepEqual([v.googlePhoto, v.addPhoto], [false, true]);
});
