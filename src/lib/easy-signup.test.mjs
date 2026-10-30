// Run: npm test. The website's shorter sign-up on PGlite, through the real store and app: the chat's suggestions (the
// Google first name, the Telegram skip), the step counter, the interview's taps without a model call, and a sign-up
// with no Telegram that matches reach in Kismet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
const { neonText } = await import("./text/store.ts");
const { app, deps } = await import("./text/runtime.ts");
const { webAdapter } = await import("./text/web.ts");
const { handleInbound } = await import("./text/agent.ts");
const { view, firstNameOf } = await import("./text/web-chat.ts");
const { draftProfile, SKIP_CONTACT } = await import("./text/parse.ts");
const { contactFor } = await import("./views.ts");
const { toUser } = await import("./db.ts");

// Any model call here is a test failure: every answer below is a tap the interview reads itself.
const noModel = { interview: async () => { throw new Error("model called"); }, active: async () => { throw new Error("model called"); } };
const d = () => ({ ...deps(webAdapter), model: noModel });
const send = (phone, text) => handleInbound(d(), { channel: "web", from: phone, text, buttonId: null, providerId: `web:${Math.random()}`, isGroup: false });

test("firstNameOf: the first word of a Google name, only when it looks like a name", () => {
  assert.equal(firstNameOf("Priya Sharma"), "Priya");
  assert.equal(firstNameOf("  José  María "), "José");
  assert.equal(firstNameOf("O'Neil"), "O'Neil");
  assert.equal(firstNameOf("Dr. Priya Rao"), "Priya"); // never a title
  assert.equal(firstNameOf("Mr Arjun"), "Arjun");
  for (const bad of ["", null, undefined, "priya@example.com", "1234", "https://x.y", "😀"]) assert.equal(firstNameOf(bad), null, String(bad));
});

test("web sign-up: the name chip, taps without the model, Telegram skipped, an account matches reach in Kismet", async () => {
  const phone = "web:a:auth-easy-1";
  const identity = { authUserId: "auth-easy-1", email: "priya@example.com", name: "Priya Sharma" };
  const v = { me: null, identity, connect: null };
  await send(phone, "hi");
  let w = await view(v);
  assert.deepEqual([w.state, w.progress, w.suggestions], ["consent", { step: 1, total: 8 }, ["Yes, I agree"]]);
  assert.equal(await send(phone, "Yes, I agree"), "consented");
  assert.equal(await send(phone, "Yes, I'm here"), "asked:name");
  w = await view(v);
  assert.deepEqual([w.progress, w.suggestions], [{ step: 3, total: 8 }, ["Priya"]]);
  // The name goes to the model as before: set it as the model would, then the rest are taps.
  const t = await neonText.thread("web", phone);
  await neonText.save({ ...t, draft: { ...t.draft, name: "Priya" } });
  assert.equal(await send(phone, "Collaborators"), "asked:interests");
  assert.equal(await send(phone, "Music, art, yoga"), "asked:bio");
  assert.equal(await send(phone, "Skip"), "asked:contact");
  w = await view(v);
  assert.deepEqual([w.progress, w.suggestions], [{ step: 7, total: 8 }, [SKIP_CONTACT]]);
  assert.equal(await send(phone, SKIP_CONTACT), "recap");
  w = await view(v);
  assert.equal(w.progress.step, 8);
  assert.match(w.messages.at(-1).text, /Matches message you here in Kismet/);

  // The real app.signup (agent.ts calls it on YES): no Telegram, validated and saved.
  const thread = await neonText.thread("web", phone);
  const id = crypto.randomUUID();
  const r = await app.signup(thread, id, draftProfile(thread.draft), [], thread.draft.contactMethod ?? "telegram");
  assert.deepEqual(r, { userId: id });
  const u = toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
  assert.deepEqual([u.name, u.telegram, u.relStatus, u.lookingFor, u.interests], ["Priya", "", "undisclosed", ["collaborators"], ["Music", "art", "yoga"]]);
  assert.equal(contactFor(u).kind, "app");
});

test("web sign-up: a Telegram username still works, and WhatsApp keeps asking without one", async () => {
  const phone = "web:a:auth-easy-2";
  await send(phone, "hi");
  await send(phone, "Yes, I agree");
  await send(phone, "Yes, I'm here");
  const t = await neonText.thread("web", phone);
  // As the model reads "@ravi_builds" (agent.ts also takes a bare username itself).
  await neonText.save({ ...t, draft: { ...t.draft, name: "Ravi", lookingFor: ["friends"], interests: ["AI", "Surfing", "Music"], asked: [...t.draft.asked, "bio"], telegram: "ravi_builds", contactMethod: "telegram" } });
  const thread = await neonText.thread("web", phone);
  const id = crypto.randomUUID();
  assert.deepEqual(await app.signup(thread, id, draftProfile(thread.draft), [], "telegram"), { userId: id });
  const u = toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
  assert.equal(contactFor(u).link, "https://t.me/ravi_builds");

  // The website without the Skip: no account without a Telegram (the exemption is only for a skipped contact question).
  const web2 = await neonText.createThread("web", "web:a:auth-easy-3");
  const noSkip = { ...thread.draft, telegram: undefined, contactMethod: undefined, asked: ["bio"] };
  assert.ok("error" in (await app.signup({ ...web2, draft: noSkip }, crypto.randomUUID(), draftProfile(noSkip), [], "telegram")));

  // WhatsApp: the same draft with no contact cannot sign up without Telegram or the number.
  const wa = await neonText.createThread("whatsapp", "+15550001234");
  const r = await app.signup({ ...wa, draft: { ...thread.draft, telegram: undefined, contactMethod: undefined } }, crypto.randomUUID(),
    draftProfile({ ...thread.draft, telegram: undefined, contactMethod: undefined }), [], "telegram");
  assert.ok("error" in r, JSON.stringify(r));
});
