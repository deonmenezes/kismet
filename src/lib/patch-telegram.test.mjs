// Run: npm test. PATCH /api/me and the Telegram (lib/validate.ts parseEdit), end to end on a real Postgres (PGlite, in
// memory) with db/schema.sql applied: a Kismet-by-text account reached on WhatsApp saves edits without a Telegram and can
// clear one, a Telegram account is still checked and can't clear its only contact, a left-out Telegram stays as it is,
// the web Edit page's Telegram step and the text chat's EDIT follow the same rule.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
const { insertUser } = await import("./actions.ts");
const { toUser } = await import("./db.ts");
const { meView, meCompact, summaryJson } = await import("./views.ts");
const { parseProfile, parseEdit, telegramOptionalFor, reachedByPhone } = await import("./validate.ts");
const { telegramStepOk } = await import("./options.ts");
const { PATCH } = await import("../app/api/me/route.ts");
const { app } = await import("./text/runtime.ts");
const { hashToken } = await import("./auth.ts");

const WEB = { channel: "web", client: "" };
const INTERESTS = ["AI", "Surfing/beach", "Music", "Books"];

async function person(name, telegram, { phone = null, demo = false } = {}) {
  const r = parseProfile({ name, telegram, lookingFor: ["friends"], interests: INTERESTS, edgeCity: true }, { telegramOptional: Boolean(phone) });
  assert.ok(r.profile, r.error);
  const made = await insertUser(r.profile, WEB, null, [], null, { demo });
  if (phone) await pg.query("update users set contact_method = 'phone', contact_phone = $2 where id = $1", [made.id, phone]);
  return made;
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const patch = (token, b) => PATCH(new Request("https://kismet.test/api/me", {
  method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b),
}));
const edit = (b) => ({ lookingFor: ["friends"], interests: INTERESTS, ...b });

afterEach(() => pg.exec("delete from rate_limits; delete from users;"));

test("a WhatsApp account (no Telegram) saves an edit without one, left out or empty; its contact stays WhatsApp", async () => {
  const wa = await person("Wanda", "", { phone: "+919800000001" });
  assert.equal((await user(wa.id)).telegram, "");
  const left = await patch(wa.token, edit({ name: "Wanda", bio: "Surfs at dawn." }));
  assert.equal(left.status, 200, await left.clone().text());
  assert.equal((await patch(wa.token, edit({ name: "Wanda", telegram: "", bio: "Chai after." }))).status, 200);
  assert.equal((await patch(wa.token, edit({ name: "Wanda", telegram: null, bio: "Chai after." }))).status, 200);
  const u = await user(wa.id);
  assert.deepEqual([u.telegram, u.bio, u.contactMethod, u.contactPhone], ["", "Chai after.", "phone", "+919800000001"]);
  // GET /api/me?full=1 says how matches reach them.
  assert.equal((await meView(u)).contact.kind, "phone");
});

test("a WhatsApp account can add a Telegram (still checked) and clear it again; matches still reach it on WhatsApp", async () => {
  const wa = await person("Wes", "", { phone: "+919800000002" });
  const bad = await patch(wa.token, edit({ name: "Wes", telegram: "no" }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /^telegram: /);
  assert.equal((await patch(wa.token, edit({ name: "Wes", telegram: "t.me/wes_99" }))).status, 200);
  assert.deepEqual([(await user(wa.id)).telegram, (await user(wa.id)).contactMethod], ["wes_99", "phone"]);
  assert.equal((await patch(wa.token, edit({ name: "Wes", bio: "Left out: kept." }))).status, 200);
  assert.equal((await user(wa.id)).telegram, "wes_99");
  assert.equal((await patch(wa.token, edit({ name: "Wes", telegram: "  " }))).status, 200);
  assert.equal((await user(wa.id)).telegram, "");
  assert.equal((await meView(await user(wa.id))).contact.kind, "phone");
});

test("a Telegram account: a bad or empty Telegram is refused (nothing saved); left out = unchanged; a new one is saved", async () => {
  const tg = await person("Tia", "tia_tg");
  for (const telegram of ["", "  ", null, "ab", "has space", "t.me/"]) {
    const res = await patch(tg.token, edit({ name: "Tia", telegram, bio: "Should not save." }));
    assert.equal(res.status, 400, `telegram ${JSON.stringify(telegram)}`);
    assert.match((await res.json()).error, /^telegram: /);
  }
  const empty = await patch(tg.token, edit({ name: "Tia", telegram: "" }));
  assert.match((await empty.json()).error, /reach you on Telegram, so it can't be left empty/);
  assert.deepEqual([(await user(tg.id)).telegram, (await user(tg.id)).bio], ["tia_tg", ""]);
  // Left out: kept (before this fix, a 400 for every account).
  assert.equal((await patch(tg.token, edit({ name: "Tia", bio: "Kept." }))).status, 200);
  assert.deepEqual([(await user(tg.id)).telegram, (await user(tg.id)).bio], ["tia_tg", "Kept."]);
  assert.equal((await patch(tg.token, edit({ name: "Tia", telegram: "@tia_new" }))).status, 200);
  assert.equal((await user(tg.id)).telegram, "tia_new");
  assert.equal((await meView(await user(tg.id))).contact.kind, "telegram");
});

test("an account with no Telegram and no WhatsApp (reached in the Kismet app) can still save edits and add one", async () => {
  assert.match(parseProfile({ name: "Ari", telegram: "", lookingFor: ["friends"], interests: INTERESTS }).error, /^telegram: /, "a web sign-up needs one");
  // One made without (an old row, or a WhatsApp choice with no number): its matches message it in Kismet.
  const { rows } = await pg.query("insert into users (token_hash, name, telegram, looking_for, interests, edge_city) values ('h-ari', 'Ari', '', '{friends}', $1, true) returning id", [INTERESTS]);
  const u = await user(rows[0].id);
  assert.deepEqual([telegramOptionalFor(u), reachedByPhone(u)], [true, false]);
  assert.equal((await meView(u)).contact.kind, "app");
  assert.ok("profile" in parseEdit(edit({ name: "Ari", bio: "Hi" }), u));
  assert.equal(parseEdit(edit({ name: "Ari", telegram: "" }), u).profile.telegram, "");
  assert.equal(parseEdit(edit({ name: "Ari", telegram: "ari_tg" }), u).profile.telegram, "ari_tg");
  assert.match(parseEdit(edit({ name: "Ari", telegram: "x" }), u).error, /^telegram: /);
  // Once it has one, it is its contact and can't be cleared.
  const withTg = { ...u, telegram: "ari_tg" };
  assert.equal(telegramOptionalFor(withTg), false);
  assert.match(parseEdit(edit({ name: "Ari", telegram: "" }), withTg).error, /can't be left empty/);
  // A WhatsApp choice without a number is not reached by phone (lib/text/parse.ts contactOf), so it is treated the same.
  assert.equal(reachedByPhone({ telegram: "x_tg_1", contactMethod: "phone", contactPhone: null }), false);
});

test("demo names: a left-out Telegram still counts, so a real account can't take the pair and a demo account keeps its own", async () => {
  const kai = await person("Kai", "kismet_review_demo");
  const res = await patch(kai.token, edit({ name: "Sam (demo)" }));
  assert.equal(res.status, 403);
  assert.equal((await user(kai.id)).name, "Kai");
  const sam = await person("Sam (demo)", "kismet_review_demo", { demo: true });
  assert.equal((await patch(sam.token, edit({ name: "Sam (demo)", bio: "Demo" }))).status, 200);
  // A demo name alone is reserved too (QA2 N-L3), with no Telegram as well; a real name with no Telegram is fine.
  const wa = await person("Wren", "", { phone: "+919800000003" });
  assert.equal((await patch(wa.token, edit({ name: "Maya (demo)", telegram: "" }))).status, 403);
  assert.equal((await patch(wa.token, edit({ name: "Wren R", telegram: "" }))).status, 200);
  const taken = await patch(wa.token, edit({ name: "Maya (demo)", telegram: "maya_demo_kismet" }));
  assert.equal(taken.status, 403);
});

test("Edge answers left out stay unchanged when the Telegram is left out too", async () => {
  const wa = await person("Edda", "", { phone: "+919800000004" });
  await pg.query("update users set edge_weeks = '{week2}' where id = $1", [wa.id]);
  assert.equal((await patch(wa.token, edit({ name: "Edda" }))).status, 200);
  const u = await user(wa.id);
  assert.deepEqual([u.edgeCity, u.edgeWeeks, u.telegram], [true, ["week2"], ""]);
});

test("web Edit page: the Telegram step allows empty exactly where PATCH does", () => {
  assert.equal(telegramStepOk("", false), false, "sign-up and Telegram accounts need one");
  assert.equal(telegramStepOk("  ", false), false);
  assert.equal(telegramStepOk("tia_tg", false), true);
  assert.equal(telegramStepOk("@tia_tg", false), true);
  assert.equal(telegramStepOk("", true), true, "WhatsApp accounts and accounts with none may leave it empty");
  assert.equal(telegramStepOk("ab", true), false, "a typed one is still checked");
  const wa = { telegram: "", contactMethod: "phone", contactPhone: "+919800000005" };
  assert.deepEqual([telegramOptionalFor(wa), reachedByPhone(wa)], [true, true]);
  const tg = { telegram: "tia_tg", contactMethod: "telegram", contactPhone: null };
  assert.deepEqual([telegramOptionalFor(tg), reachedByPhone(tg)], [false, false]);
});

test("a Telegram that isn't text is refused, never read as empty (a WhatsApp account's Telegram is not wiped)", async () => {
  const wa = await person("Wynn", "wynn_tg", { phone: "+919800000006" });
  for (const telegram of [12345, false, {}, ["wynn_tg"]]) {
    const res = await patch(wa.token, edit({ name: "Wynn", telegram }));
    assert.equal(res.status, 400, `telegram ${JSON.stringify(telegram)}`);
    assert.match((await res.json()).error, /^telegram: /);
  }
  assert.equal((await user(wa.id)).telegram, "wynn_tg");
});

test("a WhatsApp choice with no number on file is reached on Telegram: PATCH can't clear that Telegram", async () => {
  const odd = await person("Odo", "odo_tg");
  await pg.query("update users set contact_method = 'phone', contact_phone = null where id = $1", [odd.id]);
  assert.equal((await patch(odd.token, edit({ name: "Odo", telegram: "" }))).status, 400);
  assert.equal((await user(odd.id)).telegram, "odo_tg");
  assert.equal((await meView(await user(odd.id))).contact.kind, "telegram");
});

test("an account with no Telegram and no WhatsApp saves edits through PATCH; once it adds one, it can't clear it", async () => {
  const { rows } = await pg.query("insert into users (token_hash, name, telegram, looking_for, interests, edge_city) values ('h-ida', 'Ida', '', '{friends}', $1, true) returning id", [INTERESTS]);
  // A bearer token for this row, hashed as insertUser stores it.
  const token = "ida-token-0123456789abcdef0123456789";
  await pg.query("update users set token_hash = $2 where id = $1", [rows[0].id, hashToken(token)]);
  assert.equal((await patch(token, edit({ name: "Ida", telegram: "", bio: "Hi" }))).status, 200);
  assert.equal((await meView(await user(rows[0].id))).contact.kind, "app");
  assert.equal((await patch(token, edit({ name: "Ida", telegram: "ida_tg", bio: "Hi" }))).status, 200);
  assert.equal((await patch(token, edit({ name: "Ida", telegram: "", bio: "Hi" }))).status, 400);
  assert.equal((await user(rows[0].id)).telegram, "ida_tg");
});

test("availability and area left out stay unchanged", async () => {
  const wa = await person("Ava", "", { phone: "+919800000007" });
  assert.equal((await patch(wa.token, edit({ name: "Ava", availability: "weekends", area: "Mandrem" }))).status, 200);
  assert.equal((await patch(wa.token, edit({ name: "Ava", bio: "New" }))).status, 200);
  const u = await user(wa.id);
  assert.deepEqual([u.availability, u.area, u.bio], ["weekends", "Mandrem", "New"]);
});

test("GET /api/me: the full view says how matches reach them, without the number; the agent views leave it out", async () => {
  const wa = await person("Nia", "", { phone: "+919800000008" });
  const view = await meView(await user(wa.id));
  assert.deepEqual(view.contact, { kind: "phone" });
  assert.ok(!JSON.stringify(view).includes("9800000008"), "no number in the view");
  assert.ok(!("contact" in meCompact(view)));
  assert.ok(!("contact" in summaryJson(view)));
});

test("text chat EDIT: an account with no Telegram edits other fields; on a web thread a WhatsApp number is never overwritten", async () => {
  const { rows } = await pg.query("insert into users (token_hash, name, telegram, looking_for, interests, edge_city) values ('h-ivo', 'Ivo', '', '{friends}', $1, true) returning id", [INTERESTS]);
  const ivo = rows[0].id;
  const web = (id) => ({ id: "00000000-0000-4000-8000-0000000000b1", channel: "web", phone: `web:u:${id}`, draft: {} });
  assert.match(await app.edit(web(ivo), ivo, "bio", "Surfs."), /^Updated\./);
  assert.equal((await user(ivo)).bio, "Surfs.");
  assert.match(await app.edit(web(ivo), ivo, "telegram", "x"), /^That didn't work: telegram: /, "EDIT telegram is still checked");
  // A WhatsApp account editing on the website (thread "web:u:<id>"): its number stays.
  const wa = await person("Wim", "", { phone: "+919800000009" });
  assert.match(await app.edit(web(wa.id), wa.id, "bio", "Chai."), /^Updated\./);
  const u = await user(wa.id);
  assert.deepEqual([u.bio, u.contactMethod, u.contactPhone], ["Chai.", "phone", "+919800000009"]);
  // On WhatsApp itself, EDIT bio without a Telegram works as before.
  const wapp = { id: "00000000-0000-4000-8000-0000000000b2", channel: "whatsapp", phone: "+919800000009", draft: {} };
  assert.match(await app.edit(wapp, wa.id, "bio", "Dawn."), /^Updated\./);
  assert.deepEqual([(await user(wa.id)).contactPhone, (await user(wa.id)).bio], ["+919800000009", "Dawn."]);
});
