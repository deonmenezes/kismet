// Run: npm test. Kismet by text: the WhatsApp adapter, the deterministic parsing, the conversation state
// machine (with a mocked model and memory fakes) and an end-to-end double opt-in through the test adapter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buttonsBody, handshake, parseWebhook, templateBody, verifySignature, whatsappAdapter, YES_ID } from "./whatsapp.ts";
import { applyContact, chipAnswer, contactOf, draftProfile, isExplicitYes, isOwnWords, isQuietHours, mergeDraft, nextField, normalizeCode, parseCommand, parseYesNo, recapText, revealTelegram, signupProgress, SKIP_CONTACT } from "./parse.ts";
import { CAPS, flushNotices, handleInbound, linkedFromApp, notifyMatch, pushNext, SIGNUP_STALE_MS } from "./agent.ts";
import { memoryAdapter, memoryStore } from "./memory.ts";

const SECRET = "test-app-secret";
const DATE = "11111111-2222-4333-8444-555555555555";
const DATE2 = "11111111-2222-4333-8444-666666666666";
// 12:00 in Goa (06:30 UTC): outside quiet hours.
const NOON = new Date("2026-10-20T06:30:00Z");

// ---- WhatsApp adapter -----------------------------------------------------------------------------

const waBody = (messages, phoneNumberId = "PN1") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId },
    contacts: [{ wa_id: "15550100199", profile: { name: "Deon" } }], messages } }] }],
});

test("whatsapp: X-Hub-Signature-256 is checked over the raw body", () => {
  const raw = JSON.stringify(waBody([]));
  const sig = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  assert.equal(verifySignature(raw, sig, SECRET), true);
  assert.equal(verifySignature(raw + " ", sig, SECRET), false);
  assert.equal(verifySignature(raw, sig.replace(/.$/, "0"), SECRET), sig.endsWith("0"));
  for (const bad of [null, "", "sha1=abc", "sha256=zz"]) assert.equal(verifySignature(raw, bad, SECRET), false);
  assert.equal(verifySignature(raw, sig, undefined), false);
  const a = whatsappAdapter({ token: "t", phoneNumberId: "PN1", appSecret: SECRET });
  assert.equal(a.verify(new Headers({ "x-hub-signature-256": sig }), raw), true);
});

test("whatsapp: the GET handshake answers the challenge only for the right verify token", () => {
  const q = (t) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": t, "hub.challenge": "1234" });
  assert.equal(handshake(q("vt"), "vt"), "1234");
  assert.equal(handshake(q("nope"), "vt"), null);
  assert.equal(handshake(q("vt"), undefined), null);
});

test("whatsapp: text, reply-button and template-button messages normalize; statuses, other numbers and groups do not", () => {
  const msgs = parseWebhook(waBody([
    { from: "15550100199", id: "wamid.1", type: "text", text: { body: "Hi Kismet" } },
    { from: "15550100199", id: "wamid.2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: YES_ID(DATE), title: "Yes" } } },
    { from: "15550100199", id: "wamid.3", type: "button", button: { payload: `kismet:no:${DATE}`, text: "No" } },
    { from: "15550100199", id: "wamid.4", type: "image", image: { id: "x" } },
  ]), "PN1");
  assert.deepEqual(msgs.map((m) => [m.from, m.text, m.buttonId, m.providerId]), [
    ["+15550100199", "Hi Kismet", null, "wamid.1"],
    ["+15550100199", "Yes", YES_ID(DATE), "wamid.2"],
    ["+15550100199", "No", `kismet:no:${DATE}`, "wamid.3"],
    ["+15550100199", "", null, "wamid.4"],
  ]);
  assert.equal(msgs[0].displayName, "Deon");
  assert.deepEqual(parseWebhook(waBody([{ from: "1", id: "x", type: "text", text: { body: "hi" } }], "OTHER"), "PN1"), []);
  const statusOnly = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN1" }, statuses: [{ id: "wamid.9", status: "delivered" }] } }] }] };
  assert.deepEqual(parseWebhook(statusOnly, "PN1"), []);
  assert.equal(parseWebhook(waBody([{ from: "1", id: "g", type: "text", text: { body: "hi" }, group_id: "G1" }]), "PN1")[0].isGroup, true);
  assert.deepEqual(parseWebhook(null), []);
});

test("whatsapp: yes/no goes as reply buttons inside the 24 h window, as the approved template outside it", async () => {
  const p = { text: "Meet Priya? Reply YES or NO.", dateId: DATE, name: "Priya", why: "Both surf\nat dawn" };
  const b = buttonsBody("+15550100199", p);
  assert.equal(b.to, "15550100199");
  assert.deepEqual(b.interactive.action.buttons.map((x) => [x.reply.id, x.reply.title]), [[`kismet:yes:${DATE}`, "Yes"], [`kismet:no:${DATE}`, "No"]]);
  const t = templateBody("+15550100199", p, "kismet_new_recommendation", "en");
  assert.equal(t.template.name, "kismet_new_recommendation");
  assert.deepEqual(t.template.components[0].parameters.map((x) => x.text), ["Priya", "Both surf at dawn"]); // no newlines in params
  assert.equal(t.template.components[2].parameters[0].payload, `kismet:no:${DATE}`);

  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${calls.length}` }] }), { status: 200 });
  };
  const a = whatsappAdapter({ token: "t", phoneNumberId: "PN1", appSecret: SECRET }, fetchFn);
  assert.deepEqual(await a.sendYesNo("+15550100199", p, true), { ok: true, id: "wamid.out1" });
  await a.sendYesNo("+15550100199", p, false);
  assert.deepEqual(calls.map((c) => c.body.type), ["interactive", "template"]);
  assert.match(calls[0].url, /graph\.facebook\.com\/v23\.0\/PN1\/messages$/);
  const fail = whatsappAdapter({ token: "t", phoneNumberId: "PN1", appSecret: SECRET },
    async () => new Response(JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }), { status: 400 }));
  assert.deepEqual(await fail.sendText("+1", "hi"), { ok: false, error: "Re-engagement message", code: 131047 });
  assert.equal(a.windowOpen(new Date(NOON.getTime() - 3600e3), NOON), true);
  assert.equal(a.windowOpen(new Date(NOON.getTime() - 25 * 3600e3), NOON), false);
  assert.equal(a.windowOpen(null, NOON), false);
  assert.equal(whatsappAdapter({}).configured(), false);
});

// ---- Parsing ------------------------------------------------------------------------------------

test("parse: commands, yes/no (strict vs loose, buttons first), link codes, quiet hours", () => {
  assert.deepEqual(parseCommand("HELP"), { cmd: "help" });
  assert.deepEqual(parseCommand("Stop"), { cmd: "stop" });
  assert.deepEqual(parseCommand("unsubscribe"), { cmd: "stop" });
  assert.deepEqual(parseCommand("delete me"), { cmd: "delete" });
  assert.deepEqual(parseCommand("link k7q2-9xmb"), { cmd: "link", code: "K7Q29XMB" });
  assert.deepEqual(parseCommand("LINK K7Q29XMB"), { cmd: "link", code: "K7Q29XMB" });
  assert.equal(parseCommand("link 123456"), null); // old 6-digit codes are gone
  assert.deepEqual(parseCommand("LINK"), { cmd: "link", code: null });
  assert.deepEqual(parseCommand("edit bio Builds reef drones."), { cmd: "edit", field: "bio", value: "Builds reef drones." });
  assert.equal(parseCommand("I want to stop surfing so much"), null);
  assert.deepEqual(parseYesNo("Yes!"), { answer: "yes", dateId: null, strict: true });
  assert.deepEqual(parseYesNo("nah"), { answer: "no", dateId: null, strict: true });
  for (const loose of ["sure", "ok", "k", "go", "👍"]) assert.deepEqual(parseYesNo(loose), { answer: "yes", dateId: null, strict: false }, loose);
  assert.equal(parseYesNo("yes but who is she?"), null);
  assert.deepEqual(parseYesNo("whatever", `kismet:no:${DATE}`), { answer: "no", dateId: DATE, strict: true });
  for (const y of ["YES", "yes.", "I agree", "agree", "Yes, I agree"]) assert.equal(isExplicitYes(y), true, y);
  for (const n of ["ok", "k", "sure", "go", "👍", "yeah", "y"]) assert.equal(isExplicitYes(n), false, n);
  assert.equal(normalizeCode("k7q2-9xmb"), "K7Q29XMB");
  assert.equal(isQuietHours(new Date("2026-10-20T17:45:00Z")), true); // 23:15 IST
  assert.equal(isQuietHours(new Date("2026-10-20T02:00:00Z")), true); // 07:30 IST
  assert.equal(isQuietHours(new Date("2026-10-20T02:31:00Z")), false); // 08:01 IST
  assert.equal(isQuietHours(NOON), false);
});

test("parse: interview order, valid values only, optional questions asked once", () => {
  let d = {};
  assert.equal(nextField(d), "edgeCity"); // Edge City only: asked first
  d = { ...d, edgeCity: false };
  assert.equal(nextField(d), "edgeCity"); // a no never goes on to the other questions
  d = { ...d, edgeCity: true, edgeWeeks: ["week3"] };
  assert.equal(nextField(d), "name");
  d = mergeDraft(d, { name: "Asha" }, "name");
  assert.equal(nextField(d), "lookingFor"); // what they're here for before anything private
  d = mergeDraft(d, { lookingFor: ["friends", "romance", "aliens"] }, "lookingFor");
  assert.deepEqual(d.lookingFor, ["friends", "romance"]);
  assert.equal(nextField(d), "relStatus"); // only because of romance
  d = mergeDraft(d, { relStatus: "guess", skipped: true }, "relStatus"); // invalid value, skipped
  assert.equal(d.relStatus, undefined);
  assert.equal(nextField(d), "genderInterest"); // only because of romance
  d = mergeDraft(d, { gender: "woman", interestedIn: "men" }, "genderInterest");
  d = mergeDraft(d, { interests: ["AI", "surfing", "music"] }, "interests");
  assert.equal(nextField(d), "bio");
  d = mergeDraft(d, {}, "bio"); // no answer: skipped
  assert.equal(nextField(d), "contact");
  d = mergeDraft(d, { telegram: "@x" }, "contact"); // too short for Telegram
  assert.equal(nextField(d), "contact");
  d = mergeDraft(d, { contactMethod: "phone" }, "contact");
  assert.equal(nextField(d), null);
  const r = recapText(d, "+15550100199");
  assert.match(r, /Asha/);
  assert.match(r, /At Edge City India: week 3\./);
  assert.match(r, /this number \(\+15550100199\)/);
  assert.match(r, /Reply YES/);
  assert.ok(r.length <= 400, String(r.length));
});

test("contact reveal: the phone only when they chose it, else Telegram; Telegram blanked for phone choosers (#6)", () => {
  assert.equal(contactOf({ telegram: "asha_k", contactMethod: "phone", contactPhone: "+15550100199" }).link, "https://wa.me/15550100199");
  assert.equal(contactOf({ telegram: "asha_k", contactMethod: "telegram", contactPhone: "+15550100199" }).link, "https://t.me/asha_k");
  assert.equal(contactOf({ telegram: "", contactMethod: "phone", contactPhone: null }).kind, "app");
  assert.equal(revealTelegram({ telegram: "asha_k", contactMethod: "phone", contactPhone: "+15550100199" }), "");
  assert.equal(revealTelegram({ telegram: "asha_k", contactMethod: "telegram", contactPhone: null }), "asha_k");
});

// ---- State machine (memory fakes) -------------------------------------------------------------------

/** A tiny fake of the app: users, recommendations, secret double opt-in, open/closed matches. */
function fakeApp(deps) {
  const users = new Map();
  const recs = []; // { dateId, a, b, whyA, whyB, decA, decB, closed }
  const events = [];
  const other = (r, id) => (r.a === id ? r.b : r.a);
  const app = {
    users, recs, events,
    signup: async (t, id, profile, notes, contactMethod) => {
      if (!profile.name) return { error: "name: required" };
      await new Promise((r) => setTimeout(r, 5)); // a slow insert: concurrent YES messages overlap here
      // Like production: the id is the caller's; an account an earlier try already made is finished, not doubled.
      const made = users.has(id);
      users.set(id, { ...users.get(id), id, ...profile, notes, contactMethod, phone: t.phone, suspended: false });
      if (!made) events.push(["signup", id]);
      return { userId: id };
    },
    suspended: async (id) => Boolean(users.get(id)?.suspended),
    exists: async (id) => users.has(id),
    firstName: async (id) => users.get(id)?.name ?? "",
    profileText: async (id) => `Name: ${users.get(id)?.name}`,
    edit: async (t, id, field, value) => {
      users.get(id)[field] = value;
      return "Updated.";
    },
    startDates: async () => "Your agent is off on 3 agent chats.",
    pending: async (id) => recs.filter((r) => users.has(other(r, id)) && ((r.a === id && r.decA === null) || (r.b === id && r.decB === null)))
      .map((r) => ({ dateId: r.dateId, name: users.get(other(r, id)).name, why: r.a === id ? r.whyA : r.whyB, meetup: "Chai at a beach shack" })),
    decide: async (t, id, dateId, answer) => {
      const r = recs.find((x) => x.dateId === dateId && (x.a === id || x.b === id));
      if (!r) return null;
      if (r.a === id && r.decA === null) r.decA = answer;
      if (r.b === id && r.decB === null) r.decB = answer;
      const o = users.get(other(r, id));
      const match = r.decA === "meet" && r.decB === "meet";
      events.push(["decide", id, answer]);
      if (match) await notifyMatch(deps(), other(r, id), dateId);
      if (answer === "pass") return { match: false, text: `Okay, I won't bring up ${o.name} again.` };
      return { match, text: match ? await app.matchNotice(id, dateId) : `Noted, privately. If ${o.name} says yes too, I'll text you.` };
    },
    matchesText: async () => "No matches yet.",
    matchNotice: async (id, dateId) => {
      const r = recs.find((x) => x.dateId === dateId && (x.a === id || x.b === id));
      const o = r && users.get(other(r, id));
      if (!r || r.closed || !o || r.decA !== "meet" || r.decB !== "meet") return null;
      return `It's a match! You and ${o.name} both said yes. Reach them on ${contactOf({ telegram: o.telegram, contactMethod: o.contactMethod, contactPhone: o.phone }).text}.`;
    },
    contactInfo: async (id) => {
      const u = users.get(id);
      return u ? { telegram: u.telegram, contactMethod: u.contactMethod, contactPhone: u.phone } : null;
    },
    addNotes: async (t, id, notes) => void events.push(["notes", id, notes]),
    notesText: async () => "Nothing yet.",
    forgetNotes: async () => {},
    deleteAccount: async (t, id) => {
      users.delete(id);
      events.push(["delete", id]);
    },
    linked: async (t, id) => void events.push(["linked", id]),
    log: async (t, id, action, meta) => void events.push([action, id, meta?.dateId ?? null]),
  };
  return app;
}

/** Scripted model: the interview extracts from simple "field=value" messages; active answers by keywords. */
const model = {
  calls: 0,
  async interview({ message }) {
    model.calls++;
    const out = { reply: "Lovely.", notes: [], skipped: false };
    for (const part of message.split(";")) {
      const [k, v] = part.split("=").map((s) => s?.trim());
      if (!v) continue;
      out[k] = ["lookingFor", "interests"].includes(k) ? v.split(",").map((s) => s.trim()) : v;
    }
    if (/skip/i.test(message)) out.skipped = true;
    if (/build/i.test(message)) out.notes = ["Builds reef drones"];
    return out;
  },
  async active({ pending, message }) {
    model.calls++;
    if (/love to|would like to/i.test(message) && pending) return { reply: "", notes: [], answer: "yes" };
    if (/not my type/i.test(message) && pending) return { reply: "", notes: [], answer: "no" };
    return { reply: "I'm here! Text HELP for commands.", notes: /i make/i.test(message) ? ["Makes pottery"] : [], answer: "none" };
  },
};

function setup({ now = NOON, minuteCap = false } = {}) {
  const store = memoryStore({ minuteCap });
  const adapter = memoryAdapter();
  const clock = { now };
  let app;
  const deps = () => ({ store, adapter, model, app, now: () => clock.now, site: "https://kismet.test" });
  app = fakeApp(deps);
  const send = (from, text, buttonId) => handleInbound(deps(), adapter.inbound(from, text, buttonId));
  const last = (to) => adapter.sent.filter((s) => s.to === to).at(-1);
  const to = (p) => adapter.sent.filter((s) => s.to === p);
  const thread = (p) => store.threads.get(`whatsapp:${p}`);
  return { store, adapter, app, deps, send, last, to, thread, clock };
}

async function toConfirm(s, phone, name, contact = "contactMethod=phone") {
  await s.send(phone, "Hi Kismet");
  await s.send(phone, "YES");
  await s.send(phone, "Yes, weeks 2 and 3"); // at Edge City India
  await s.send(phone, `name=${name}`);
  await s.send(phone, "relStatus=single");
  await s.send(phone, "skip");
  await s.send(phone, "lookingFor=friends,collaborators");
  await s.send(phone, "interests=AI,surfing,music; I build drones");
  await s.send(phone, "skip");
  return s.send(phone, contact);
}
const signUp = async (s, phone, name, contact) => {
  await toConfirm(s, phone, name, contact);
  return s.send(phone, "yes");
};
/** Two signed-up people with an open recommendation each way and both prompts sent. */
async function pair(s, contactB = "telegram=ben_surfs") {
  const A = "+15550000001", B = "+15550000002";
  await signUp(s, A, "Asha");
  await signUp(s, B, "Ben", contactB);
  const [ua, ub] = [...s.app.users.keys()];
  s.app.recs.push({ dateId: DATE, a: ua, b: ub, whyA: "Both build with AI.", whyB: "Fellow surfer.", decA: null, decB: null });
  await pushNext(s.deps(), await s.store.thread("whatsapp", A));
  await pushNext(s.deps(), await s.store.thread("whatsapp", B));
  return { A, B, ua, ub };
}

test("consent gates everything: only the words YES / I AGREE count (#9)", async () => {
  const s = setup();
  const P = "+15550100199";
  assert.equal(await s.send(P, "Hi Kismet"), "consent-asked");
  assert.match(s.last(P).text, /18\+.*terms: https:\/\/kismet\.test\/terms/);
  assert.equal(await s.send(P, "name=Asha"), "consent-pending");
  for (const weak of ["k", "ok", "go", "👍", "sure"]) assert.equal(await s.send(P, weak), "consent-pending", weak);
  assert.equal(await s.send(P, "Yes", `kismet:yes:${DATE}`), "consent-pending"); // a stale button from another prompt
  assert.equal(model.calls, 0);
  assert.equal(await s.send(P, "I agree"), "consented");
  assert.match(s.last(P).text, /Are you at Edge City India/);
  assert.equal(await s.send(P, "yes"), "asked:name");
  assert.match(s.last(P).text, /What name should other residents see\?/);
  assert.ok(s.thread(P).draft.consentAt);
});

test("interview: one question at a time in quiz order, recap, explicit YES signs up and sends the agent on dates", async () => {
  const s = setup();
  const P = "+15550100199";
  await s.send(P, "hi");
  await s.send(P, "yes");
  assert.equal(await s.send(P, "Yes, I'm here"), "asked:name");
  assert.equal(await s.send(P, "name=Asha"), "asked:lookingFor");
  assert.match(s.last(P).text, /^Lovely\. What are you here for\?/);
  assert.equal(await s.send(P, "lookingFor=friends,romance"), "asked:relStatus"); // romance: the private questions
  assert.match(s.last(P).text, /^Lovely\. Relationship status\?/);
  assert.equal(await s.send(P, "relStatus=single"), "asked:openness");
  assert.equal(await s.send(P, "skip that"), "asked:genderInterest");
  assert.equal(await s.send(P, "gender=woman;interestedIn=men"), "asked:interests");
  assert.equal(await s.send(P, "interests=AI,surfing,music; I build drones"), "asked:bio");
  assert.equal(await s.send(P, "bio=Building reef drones in Goa"), "asked:contact");
  assert.equal(await s.send(P, "telegram=asha_k"), "recap");
  assert.match(s.last(P).text, /Here's your profile: Asha\.[\s\S]*Telegram @asha_k[\s\S]*Reply YES/);
  assert.equal(await s.send(P, "bio=Reef drones and dawn surfs"), "recap");
  assert.match(s.last(P).text, /About: Reef drones and dawn surfs/);
  assert.notEqual(await s.send(P, "ok"), "signed-up"); // "ok" is not a YES to signing up
  assert.equal(s.app.users.size, 0);
  assert.equal(await s.send(P, "YES"), "signed-up");
  const [u] = s.app.users.values();
  assert.deepEqual([u.name, u.relStatus, u.lookingFor, u.telegram, u.contactMethod, u.notes], ["Asha", "single", ["friends", "romance"], "asha_k", "telegram", ["Builds reef drones"]]);
  assert.equal(s.thread(P).state, "active");
});

test("#1 concurrency: two YES messages at once create exactly one account, and DELETE leaves none", async () => {
  const s = setup();
  const P = "+15550000001";
  assert.equal(await toConfirm(s, P, "Asha"), "recap");
  const results = await Promise.all([s.send(P, "yes"), s.send(P, "yes"), s.send(P, "YES")]);
  assert.equal(results.filter((r) => r === "signed-up").length, 1, results.join(","));
  assert.equal(s.app.users.size, 1);
  assert.equal(s.thread(P).userId, [...s.app.users.keys()][0]);
  await s.send(P, "delete me");
  assert.equal(await s.send(P, "DELETE"), "deleted");
  assert.equal(s.app.users.size, 0);
});

test("pushes: one pending at a time (also when two dates finish at once), buttons in the window, template outside, quiet hours, daily cap", async () => {
  const s = setup();
  const A = "+15550000001", B = "+15550000002";
  await signUp(s, A, "Asha");
  await signUp(s, B, "Ben");
  const [ua, ub] = [...s.app.users.keys()];
  s.app.recs.push({ dateId: DATE, a: ua, b: ub, whyA: "Both build with AI.", whyB: "Fellow surfer.", decA: null, decB: null });
  s.app.recs.push({ dateId: DATE2, a: ua, b: ub, whyA: "Second.", whyB: "Second.", decA: null, decB: null });
  const tA = () => s.store.thread("whatsapp", A);
  s.clock.now = new Date("2026-10-20T18:00:00Z"); // 23:30 IST
  assert.equal(await pushNext(s.deps(), await tA()), "skip:quiet");
  s.clock.now = NOON;
  const both = await Promise.all([pushNext(s.deps(), await tA()), pushNext(s.deps(), await tA())]);
  assert.deepEqual(both.sort(), ["pushed", "skip:pending"]);
  const p = s.last(A);
  assert.deepEqual([p.kind, p.dateId], ["buttons", DATE]);
  assert.match(p.text, /Your agent chatted with Ben's agent\. Why it clicked: Both build with AI\./);
  assert.match(p.text, /private and final/);
  assert.equal(await pushNext(s.deps(), await tA()), "skip:pending");
  // Ben has not texted for two days: his prompt goes out as the approved template.
  s.clock.now = new Date(NOON.getTime() + 48 * 3600e3);
  assert.equal(await pushNext(s.deps(), await s.store.thread("whatsapp", B)), "pushed:template");
  assert.equal(s.last(B).kind, "template");
  s.clock.now = NOON;
  await s.send(A, "No", `kismet:no:${DATE}`);
  assert.equal(s.last(A).kind, "buttons"); // the next one
  assert.doesNotMatch(s.last(A).text, /final/); // said once only
  for (let i = 0; i < CAPS.pushesPerDay + 2; i++) {
    const t = await tA();
    await s.store.releasePending(t, t.pendingDateId);
    await pushNext(s.deps(), await tA());
  }
  const t = await tA();
  await s.store.releasePending(t, t.pendingDateId);
  assert.equal(await pushNext(s.deps(), await tA()), "skip:cap");
});

test("#9 yes/no: buttons and strict words are final; fuzzy replies and 'ok' are confirmed once; stale buttons do nothing", async () => {
  const s = setup();
  const { A, B } = await pair(s);
  // A stale button (another date) answers nothing.
  assert.equal(await s.send(A, "Yes", `kismet:yes:${DATE2}`), "decide-stale");
  // Fuzzy words: asked to confirm, nothing saved yet.
  assert.equal(await s.send(A, "I'd love to meet them"), "confirm:yes");
  assert.match(s.last(A).text, /^Just to confirm: YES to meeting Ben\? This is final\./);
  assert.equal(s.app.events.filter((e) => e[0] === "decide").length, 0);
  assert.equal(await s.send(A, "no"), "confirm-cancelled"); // think again: still open
  assert.equal(await s.send(A, "ok"), "confirm:yes");
  assert.equal(await s.send(A, "ok"), "confirm:yes"); // "ok" never confirms: only YES does
  const benBefore = s.to(B).length;
  assert.equal(await s.send(A, "YES"), "decided:meet");
  assert.match(s.last(A).text, /Noted, privately\. If Ben says yes too/);
  assert.equal(s.to(B).length, benBefore); // Ben is told nothing
  // Ben taps Yes: a match; both get the other's chosen contact.
  assert.equal(await s.send(B, "Yes", YES_ID(DATE)), "matched");
  assert.match(s.last(B).text, /It's a match! You and Asha .*WhatsApp \+15550000001/);
  assert.match(s.last(A).text, /It's a match! You and Ben .*Telegram t\.me\/ben_surfs/);
  assert.equal(await s.send(B, "Yes", YES_ID(DATE)), "decide-stale");
});

test("#5 transcripts never hold another resident's name, reason or contact", async () => {
  const s = setup();
  const { A, B } = await pair(s);
  await s.send(A, "YES");
  await s.send(B, "YES");
  await s.send(A, "matches");
  const forbidden = { [A]: /Ben|ben_surfs|\+15550000002|Both build with AI/, [B]: /Asha|\+15550000001|Fellow surfer/ };
  for (const p of [A, B]) {
    for (const m of s.store.msgs.get(s.thread(p).id).filter((x) => x.direction === "out")) assert.doesNotMatch(m.text, forbidden[p], `${p}: ${m.text}`);
  }
  assert.ok(s.store.msgs.get(s.thread(A).id).some((m) => m.text === `[recommendation date:${DATE}]`));
  assert.ok(s.store.msgs.get(s.thread(B).id).some((m) => m.text === `[answer meet date:${DATE}]`));
});

test("#2 #8 a match notice is queued in quiet hours and dropped if the match closed or the partner left", async () => {
  for (const ending of ["delete", "unmatch", "block"]) {
    const s = setup();
    const { A, B, ua, ub } = await pair(s);
    await s.send(A, "YES");
    s.clock.now = new Date("2026-10-20T19:00:00Z"); // 00:30 IST: quiet hours
    await s.send(B, "YES"); // Ben is texting, so he hears now; Asha's notice waits
    assert.match(s.last(B).text, /It's a match!/);
    assert.deepEqual(s.thread(A).notices, [{ kind: "match", dateId: DATE }]);
    const before = s.to(A).length;
    if (ending === "delete") { await s.send(B, "delete me"); await s.send(B, "DELETE"); }
    else s.app.recs[0].closed = true; // unmatch, block or report closes the match
    s.clock.now = new Date("2026-10-21T03:00:00Z"); // 08:30 IST
    assert.equal(await flushNotices(s.deps(), await s.store.thread("whatsapp", A)), 0, ending);
    assert.equal(s.to(A).length, before, ending);
    assert.deepEqual(s.thread(A).notices, [], ending);
    void ua; void ub;
  }
});

test("#7 #8 outside the window the match notice is the partner-free template; in quiet hours it waits for the morning", async () => {
  const s = setup();
  const { A, ub } = await pair(s);
  await s.send(A, "YES");
  s.clock.now = new Date(NOON.getTime() + 30 * 3600e3); // next day 18:00 IST: Asha's 24 h window has closed
  await s.app.decide(s.thread("+15550000002"), ub, DATE, "meet"); // Ben answers (e.g. in the app)
  const m = s.last(A);
  assert.equal(m.kind, "match-template");
  assert.doesNotMatch(m.text, /Ben/);

  const s2 = setup();
  const p2 = await pair(s2);
  await s2.send(p2.A, "YES");
  s2.clock.now = new Date("2026-10-20T20:30:00Z"); // 02:00 IST
  const before = s2.to(p2.A).length;
  await s2.app.decide(s2.thread(p2.B), p2.ub, DATE, "meet");
  assert.equal(s2.to(p2.A).length, before); // nothing at night
  assert.deepEqual(s2.thread(p2.A).notices, [{ kind: "match", dateId: DATE }]);
  assert.equal(await flushNotices(s2.deps(), await s2.store.thread("whatsapp", p2.A)), 0); // still quiet hours
  s2.clock.now = new Date("2026-10-21T03:05:00Z"); // 08:35 IST
  assert.equal(await flushNotices(s2.deps(), await s2.store.thread("whatsapp", p2.A)), 1);
  assert.match(s2.last(p2.A).text, /It's a match! You and Ben/);
});

test("#4 STOP works even over the message caps, and START comes back", async () => {
  const s = setup({ minuteCap: true });
  const A = "+15550000001";
  await s.send(A, "hi");
  for (let i = 0; i < CAPS.perMinute; i++) await s.send(A, "hello");
  assert.equal(await s.send(A, "hello"), "capped");
  assert.equal(await s.send(A, "STOP"), "opted-out");
  assert.ok(s.thread(A).optedOutAt);
  const n = s.adapter.sent.length;
  assert.equal(await s.send(A, "STOP"), "opted-out-ignored"); // no second confirmation
  assert.equal(await s.send(A, "anyone?"), "opted-out-ignored");
  assert.equal(s.adapter.sent.length, n);
  assert.equal(await s.send(A, "START"), "opted-in");
});

test("commands: help, pause/resume, notes from chat, delete needs a confirmation and erases account and transcript", async () => {
  const s = setup();
  const A = "+15550000001";
  await signUp(s, A, "Asha");
  const [ua] = [...s.app.users.keys()];
  assert.equal(await s.send(A, "help"), "cmd:help");
  assert.match(s.last(A).text, /MATCHES, PROFILE/);
  assert.equal(await s.send(A, "pause"), "cmd:pause");
  s.app.users.set("u9", { id: "u9", name: "Zed", telegram: "zed_z" });
  s.app.recs.push({ dateId: DATE, a: ua, b: "u9", whyA: "x", whyB: "x", decA: null, decB: null });
  assert.equal(await pushNext(s.deps(), await s.store.thread("whatsapp", A)), "skip:inactive");
  s.app.recs.length = 0;
  assert.equal(await s.send(A, "resume"), "cmd:resume");
  assert.equal(await s.send(A, "I make pottery at night"), "chat");
  assert.deepEqual(s.app.events.find((l) => l[0] === "notes"), ["notes", ua, ["Makes pottery"]]);
  assert.equal(await s.send(A, "delete me"), "delete-asked");
  assert.equal(await s.send(A, "wait no"), "delete-cancelled");
  assert.equal(await s.send(A, "delete me"), "delete-asked");
  assert.equal(await s.send(A, "DELETE"), "deleted");
  assert.match(s.last(A).text, /^Done: your account and this conversation are deleted/);
  assert.equal(s.app.users.size, 1); // only Zed
  assert.equal(s.store.threads.size, 0);
  assert.equal(s.store.msgs.size, 0);
  assert.equal(await s.send(A, "hi"), "consent-asked");
});

test("#3 link: codes need the other side's approval, and the per-number limit survives DELETE ME cycles", async () => {
  const s = setup();
  const A = "+15550000666";
  let limited = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < 6; i++) if ((await s.send(A, `link ZZZZ${String(cycle * 10 + i).padStart(4, "0")}`)) === "link-limited") limited++;
    await s.send(A, "delete me");
    await s.send(A, "DELETE");
  }
  assert.equal(limited, 18 - CAPS.linkPerNumberHour); // 10 tries in the hour across all three threads

  // An app code typed on the phone only requests the link: the app must approve it.
  const t = setup();
  t.app.users.set("app-user", { id: "app-user", name: "Mira", telegram: "mira_m", contactMethod: "telegram" });
  t.store.userCodes.set("K7Q29XMB", "app-user");
  assert.equal(await t.send(A, "link K7Q2-9XMB"), "link-requested");
  assert.equal(t.thread(A).userId, null);
  assert.equal(await t.send(A, "link K7Q2-9XMB"), "link-bad"); // single use
  // A code the phone handed out, entered on the web: the phone must say YES.
  const P = "+15550000777";
  assert.equal(await t.send(P, "link"), "link-code-sent");
  const [code] = [...t.store.threadCodes.keys()];
  t.store.requests.set("r-web", { id: "r-web", userId: "app-user", userName: "Mira", threadId: t.thread(P).id, needs: "phone" });
  t.store.threadCodes.delete(code);
  assert.notEqual(await t.send(P, "ok"), "linked");
  assert.equal(await t.send(P, "YES"), "linked");
  assert.equal(t.thread(P).userId, "app-user");
});

test("#12 a link approved in the app never activates or texts an opted-out number", async () => {
  const s = setup();
  const A = "+15550000001";
  await s.send(A, "hi");
  await s.send(A, "STOP");
  const n = s.adapter.sent.length;
  assert.equal(await linkedFromApp(s.deps(), { ...(await s.store.thread("whatsapp", A)), userId: "x", state: "active" }), "skip:opted-out");
  assert.equal(s.adapter.sent.length, n);
});

test("#11 text sign-ups are capped per number prefix and globally per hour", async () => {
  const s = setup();
  const results = [];
  for (let i = 0; i < CAPS.signupsPerPrefixHour + 1; i++) {
    const P = `+1555${String(1000000 + i)}`;
    await toConfirm(s, P, `P${i}`);
    results.push(await s.send(P, "YES"));
  }
  assert.equal(results.filter((r) => r === "signed-up").length, CAPS.signupsPerPrefixHour);
  assert.equal(results.at(-1), "signup-limited");
});

test("idempotency and groups", async () => {
  const s = setup();
  const A = "+15550000001";
  const m = s.adapter.inbound(A, "hi");
  assert.equal(await handleInbound(s.deps(), m), "consent-asked");
  assert.equal(await handleInbound(s.deps(), m), "duplicate"); // a webhook retry
  assert.equal(await handleInbound(s.deps(), { ...s.adapter.inbound(A, "hi"), isGroup: true }), "group-ignored");
});

test("D1 a sign-up that throws goes back to the recap; the next YES signs up, with exactly one account", async () => {
  const s = setup();
  const P = "+15550000001";
  assert.equal(await toConfirm(s, P, "Asha"), "recap");
  const real = s.app.signup;
  let calls = 0;
  s.app.signup = async (...args) => {
    if (++calls === 1) throw new Error("setContact failed"); // production deletes the half-made user first
    return real(...args);
  };
  assert.equal(await s.send(P, "YES"), "signup-failed");
  assert.match(s.last(P).text, /Something went wrong.*Reply YES to try again/);
  assert.equal(s.thread(P).state, "confirm");
  assert.equal(s.app.users.size, 0);
  assert.equal(await s.send(P, "YES"), "signed-up");
  assert.equal(s.app.users.size, 1);
  assert.equal(s.thread(P).state, "active");
  assert.equal(s.thread(P).draft.signupAt, undefined);
});

test("D1 a signing_up thread is busy for 2 minutes, then stale: YES retries the sign-up", async () => {
  const s = setup();
  const P = "+15550000001";
  await toConfirm(s, P, "Asha");
  const t = s.thread(P);
  t.state = "signing_up"; // a sign-up that died after claiming the state
  t.draft = { ...t.draft, signupAt: new Date(NOON.getTime() - 30_000).toISOString() };
  assert.equal(await s.send(P, "YES"), "signing-up");
  assert.equal(s.app.users.size, 0);
  s.clock.now = new Date(NOON.getTime() + SIGNUP_STALE_MS);
  assert.equal(await s.send(P, "YES"), "signed-up");
  assert.equal(s.app.users.size, 1);
  // One without a timestamp (an older build) is stale too.
  const Q = "+15550000002";
  await toConfirm(s, Q, "Ben");
  s.thread(Q).state = "signing_up";
  assert.equal(await s.send(Q, "YES"), "signed-up");
  assert.equal(s.app.users.size, 2);
});

test("D5 a sign-up killed after the insert, retried once stale, still leaves exactly one account for the number", async () => {
  const s = setup();
  const P = "+15550000001";
  await toConfirm(s, P, "Asha");
  // The function is hard-killed right after the account is inserted: nothing after it runs (no thread save).
  const KILL = new Error("killed");
  const realSave = s.store.save;
  s.store.save = async (t) => {
    if (t.state === "active") throw KILL;
    return realSave(t);
  };
  await assert.rejects(s.send(P, "YES"), (e) => e === KILL);
  s.store.save = realSave;
  assert.equal(s.app.users.size, 1);
  assert.equal(s.thread(P).state, "signing_up");
  assert.equal(s.thread(P).userId, null);
  // Busy for 2 minutes, then stale: the next YES finishes that same account instead of making a second one.
  assert.equal(await s.send(P, "YES"), "signing-up");
  s.clock.now = new Date(NOON.getTime() + SIGNUP_STALE_MS);
  assert.equal(await s.send(P, "YES"), "signed-up");
  const [only] = [...s.app.users.keys()];
  assert.equal(s.app.users.size, 1);
  assert.equal(s.thread(P).userId, only);
  assert.equal(s.thread(P).state, "active");
  assert.deepEqual(s.app.events.filter((e) => e[0] === "signup"), [["signup", only]]);
  // A live try slower than 2 minutes (its 30 s lease long gone), overtaken by the stale retry: one account.
  const Q = "+15550000002";
  s.clock.now = NOON;
  await toConfirm(s, Q, "Ben");
  const realSignup = s.app.signup;
  let resume;
  const slow = new Promise((r) => (resume = r));
  s.app.signup = async (...args) => {
    s.app.signup = realSignup;
    const r = await realSignup(...args);
    await slow; // still running when the retry comes in
    return r;
  };
  const first = s.send(Q, "YES");
  while (s.app.users.size < 2) await new Promise((r) => setTimeout(r, 5));
  s.clock.now = new Date(NOON.getTime() + SIGNUP_STALE_MS);
  s.store.lock = async () => async () => {}; // the lease expired
  assert.equal(await s.send(Q, "YES"), "signed-up");
  resume();
  assert.equal(await first, "signed-up");
  assert.equal(s.app.users.size, 2);
  assert.equal(s.thread(Q).userId, [...s.app.users.keys()][1]);
});

test("D4 rate-limit keys hold a salted hash, never the number or its prefix, and stay per number", async () => {
  const s = setup();
  const { A, B } = await pair(s);
  await s.send(A, "link");
  await s.send(B, "link ZZZZ0000");
  const keys = [...s.store.counters.keys()];
  assert.ok(keys.some((k) => k.startsWith("text-day:whatsapp:")) && keys.some((k) => k.startsWith("text-signup:whatsapp:"))
    && keys.some((k) => k.startsWith("text-push:whatsapp:")) && keys.some((k) => k.startsWith("text-link:whatsapp:")), keys.join(" "));
  for (const k of keys) {
    for (const p of [A, B]) {
      const digits = p.replace(/\D/g, "");
      assert.ok(!k.includes(digits) && !k.includes(digits.slice(0, 5)) && !k.includes(digits.slice(-7)), k);
    }
    assert.match(k, /^text-[a-z-]+(:all|:all:(whatsapp|web)|:whatsapp:[0-9a-f]{32}|:(whatsapp|web))?$/, k); // a bare channel: a per-channel budget
  }
  const day = keys.filter((k) => k.startsWith("text-day:"));
  assert.equal(day.length, 2); // still one counter per number
});

test("caps: site-wide sign-up and failed-link counts are watched, never a refusal for everyone", async () => {
  const s = setup();
  const P = "+15550000001";
  await toConfirm(s, P, "Asha");
  s.store.counters.set("text-signup:all:whatsapp", CAPS.signupsGlobalHour + 50); // far over the watch level
  assert.equal(await s.send(P, "YES"), "signed-up"); // still signed up: a flood elsewhere can't lock people out
  const Q = "+15550000002";
  await s.send(Q, "hi");
  s.store.counters.set("text-link-fail:all", CAPS.linkFailuresGlobalHour + 50);
  assert.equal(await s.send(Q, "link ZZZZ0001"), "link-bad"); // checked as usual (the per-number limit guards guessing)
  assert.doesNotMatch(s.last(Q).text, /Linking is paused/);
});

test("#13 a contact-method change is written to profile_history; the first choice and no-ops are not", async () => {
  const run = async (before, after) => {
    const saved = [], history = [];
    await applyContact({ save: async (c) => void saved.push(c), record: async (b, a) => void history.push([b, a]) }, before, after);
    return { saved, history };
  };
  const tg = { method: "telegram", phone: null }, ph = { method: "phone", phone: "+15550000001" };
  assert.deepEqual(await run(tg, ph), { saved: [ph], history: [[tg, ph]] });
  assert.deepEqual((await run(ph, { method: "phone", phone: "+15550000009" })).history, [[ph, { method: "phone", phone: "+15550000009" }]]);
  assert.deepEqual(await run(null, ph), { saved: [ph], history: [] }); // sign-up: the first choice
  assert.deepEqual(await run(ph, { ...ph }), { saved: [ph], history: [] });
});

test("web chat (live adapter): no quiet hours or daily push cap, no STOP opt-out, Telegram-only contact, notices stay on their channel", async () => {
  const s = setup({ now: new Date("2026-10-20T19:00:00Z") }); // 00:30 in Goa: quiet hours for WhatsApp
  const base = memoryAdapter();
  const web = { ...base, channel: "web", live: true, inbound: (from, text, buttonId) => { const m = base.inbound(from, text, buttonId); return { ...m, channel: "web", providerId: `web-${m.providerId}` }; } };
  const wdeps = () => ({ ...s.deps(), adapter: web });
  const wsend = (from, text, buttonId) => handleInbound(wdeps(), web.inbound(from, text, buttonId));
  const W = "web:a:auth-1";
  const lastWeb = () => base.sent.filter((x) => x.to === W).at(-1);
  await wsend(W, "hi");
  await wsend(W, "yes");
  await wsend(W, "Yes, all 3 weeks");
  for (const m of ["name=Asha", "relStatus=single", "skip", "lookingFor=friends", "interests=AI,surfing,music"]) await wsend(W, m);
  assert.equal(await wsend(W, "skip"), "asked:contact");
  assert.match(lastWeb().text, /Telegram username/);
  assert.doesNotMatch(lastWeb().text, /PHONE|WhatsApp/);
  assert.equal(await wsend(W, "contactMethod=phone"), "asked:contact"); // no phone to share on the web
  assert.equal(await wsend(W, "telegram=asha_k"), "recap");
  assert.equal(await wsend(W, "YES"), "signed-up");
  const wt = () => s.store.threads.get(`web:${W}`);
  assert.equal(wt().state, "active");
  assert.notEqual(await wsend(W, "stop"), "opted-out");
  assert.equal(wt().optedOutAt, null);

  const B = "+15550000002";
  await signUp(s, B, "Ben", "telegram=ben_surfs");
  const [ua, ub] = [...s.app.users.keys()];
  s.app.recs.push({ dateId: DATE, a: ua, b: ub, whyA: "Both build with AI.", whyB: "Fellow surfer.", decA: null, decB: null });
  assert.equal(await pushNext(s.deps(), await s.store.thread("whatsapp", B)), "skip:quiet");
  assert.equal(await pushNext(wdeps(), await s.store.thread("web", W)), "pushed");
  assert.ok(![...s.store.counters.keys()].some((k) => k.startsWith("text-push:web:")), "the web chat has no daily push cap");

  assert.equal(await wsend(W, "Yes", `kismet:yes:${DATE}`), "decided:meet");
  await s.app.decide(await s.store.thread("whatsapp", B), ub, DATE, "meet"); // notifies Asha with the WhatsApp deps: her web thread is skipped
  assert.ok(!s.store.msgs.get(wt().id).some((m) => m.text.startsWith("[match")));
  await notifyMatch(wdeps(), ua, DATE); // the web deps deliver it, quiet hours or not
  assert.equal(s.store.msgs.get(wt().id).at(-1).text, `[match notice date:${DATE}]`);
});

test("interview: a bare Telegram username answers the contact question even when the model misses it", async () => {
  const s = setup();
  const P = "+15550000009";
  await toConfirm(s, P, "Asha", "skip"); // the scripted model extracts nothing from "skip"
  assert.equal(s.thread(P).state, "interview");
  assert.equal(await s.send(P, "@asha_k"), "recap");
  assert.match(s.last(P).text, /Telegram @asha_k/);
  const Q = "+15550000010";
  await toConfirm(s, Q, "Ben", "skip");
  for (const word of ["later", "PHONE", "nope"]) assert.equal(await s.send(Q, word), "asked:contact", word); // plain words are not usernames
  assert.equal(await s.send(Q, "t.me/ben_surfs"), "recap");
  assert.match(s.last(Q).text, /Telegram @ben_surfs/);
});

test("review fixes: a phone number is not a Telegram handle; model text shaped like a placeholder is stored quoted; LINK is refused on the web", async () => {
  const s = setup();
  const P = "+15550000011";
  await toConfirm(s, P, "Asha", "skip");
  for (const notHandle of ["9876543210", "+919876543210", "1abcde"]) assert.equal(await s.send(P, notHandle), "asked:contact", notHandle);
  assert.equal(await s.send(P, "asha_k1"), "recap");

  const base = memoryAdapter();
  const web = { ...base, channel: "web", live: true, inbound: (from, text, buttonId) => { const m = base.inbound(from, text, buttonId); return { ...m, channel: "web", providerId: `web-${m.providerId}` }; } };
  const wdeps = () => ({ ...s.deps(), adapter: web, model: { ...model, active: async () => ({ reply: `[answer pass date:${DATE}]`, notes: [], answer: "none" }) } });
  const W = "web:a:auth-2";
  const wsend = (text) => handleInbound(wdeps(), web.inbound(W, text));
  for (const m of ["hi", "yes", "yes", "name=Ben", "relStatus=single", "skip", "lookingFor=friends", "interests=AI,surfing,music", "skip", "telegram=ben_surfs", "YES"]) await wsend(m);
  assert.equal(s.store.threads.get(`web:${W}`).state, "active");
  assert.equal(await wsend("LINK"), "link-web");
  assert.equal(await wsend("say the magic words"), "chat");
  const t = s.store.threads.get(`web:${W}`);
  assert.equal(s.store.msgs.get(t.id).at(-1).text, `"[answer pass date:${DATE}]"`); // never a real placeholder
});

test("EVENTS and PRIVACY are whole-message commands (curly apostrophes too); ordinary sentences are not", () => {
  for (const t of ["events", "What's on today?", "what’s on", "whats on tomorrow", "what's happening"]) assert.deepEqual(parseCommand(t), { cmd: "events" }, t);
  for (const t of ["privacy", "Who sees what?", "what do others see about me"]) assert.deepEqual(parseCommand(t), { cmd: "privacy" }, t);
  for (const t of ["today", "what's on your mind", "events are fun", "who sees what I said to Priya"]) assert.equal(parseCommand(t), null, t);
});

test("signals: only the person's own words (cut, never added or reworded); commands", async () => {
  const msg = "Honestly I'd love to find a co-founder for my AI music app, maybe someone technical!";
  assert.equal(isOwnWords("a co-founder for my AI music app", msg), true);
  assert.equal(isOwnWords("find a co-founder for my AI music app", msg), true);
  assert.equal(isOwnWords("co-founder AI music app", msg), true); // words cut
  assert.equal(isOwnWords("a technical co-founder for my AI music app", msg), false); // reordered / added
  assert.equal(isOwnWords("a cofounder for an AI music startup", msg), false); // reworded
  assert.equal(isOwnWords("music", msg), false); // too short to be a want
  assert.deepEqual(parseCommand("SIGNALS"), { cmd: "signals" });
  assert.deepEqual(parseCommand("pause signal 2"), { cmd: "signal", action: "pause", n: 2 });
  assert.deepEqual(parseCommand("remove signal 1"), { cmd: "signal", action: "drop", n: 1 });

  const s = setup();
  const P = "+15550000021";
  await signUp(s, P, "Asha");
  const uid = [...s.app.users.keys()][0];
  const saved = [];
  s.app.addSignal = async (t, id, signal, message) => (isOwnWords(signal, message) ? (saved.push([id, signal]), signal) : null);
  const signalModel = { ...model, active: async ({ message }) => ({ reply: "Love that.", notes: [], answer: "none", signal: /paraphrase/.test(message) ? "a technical cofounder" : "a co-founder for my AI music app" }) };
  const d = () => ({ ...s.deps(), model: signalModel });
  await handleInbound(d(), s.adapter.inbound(P, msg));
  assert.deepEqual(saved, [[uid, "a co-founder for my AI music app"]]);
  assert.match(s.last(P).text, /Saved as a signal: "a co-founder for my AI music app"/);
  await handleInbound(d(), s.adapter.inbound(P, "paraphrase this one please"));
  assert.equal(saved.length, 1); // the model's own wording is never saved
  assert.doesNotMatch(s.last(P).text, /Saved as a signal/);
});

test("names never reach a stored reply: full or first name, any case, whole words only", async () => {
  const { withoutName } = await import("./agent.ts");
  assert.equal(withoutName("Priya Sharma sounds great; PRIYA surfs too.", "Priya Sharma"), "them sounds great; them surfs too.");
  assert.equal(withoutName("Want to meet priya at The Circle?", "Priya"), "Want to meet them at The Circle?");
  assert.equal(withoutName("Priyanka and Ali are not the same as Al.", "Al"), "Priyanka and Ali are not the same as them.");
  assert.equal(withoutName("Nothing to hide here.", "Zoë"), "Nothing to hide here.");
});

test("names in scripts without spaces are scrubbed too; short Latin particles are left alone", async () => {
  const { withoutName } = await import("./agent.ts");
  assert.equal(withoutName("你想见王伟吗？王伟喜欢下棋。", "王伟"), "你想见them吗？them喜欢下棋。");
  assert.equal(withoutName("さくらさんと会いますか", "さくら"), "themさんと会いますか");
  assert.equal(withoutName("Maria de la Cruz loves la playa de Goa.", "Maria de la Cruz"), "them loves la playa de Goa.");
  assert.equal(withoutName("Did Cruz say yes? Maria did.", "Maria de la Cruz"), "Did them say yes? them did.");
  assert.equal(withoutName("Zoë and José met Élodie.", "Élodie Martin"), "Zoë and José met them.");
});

// ---- Edge City only (lib/edge-city.ts) ------------------------------------------------------------

/** The fake app with Edge City answers stored on its users (as production does in users.edge_city). */
function withEdge(s) {
  s.app.edgeCity = async (id) => (s.app.users.has(id) ? (s.app.users.get(id).edgeCity ?? null) : null);
  s.app.setEdgeCity = async (t, id, member, weeks) => {
    Object.assign(s.app.users.get(id), { edgeCity: member, edgeWeeks: weeks });
    s.app.events.push(["edge_city", id, member]);
  };
  return s;
}

test("edge city sign-up: asked right after consent; a no gets the waitlist and creates nothing, the questions never start", async () => {
  const s = withEdge(setup());
  const P = "+15550000101";
  await s.send(P, "hi");
  assert.match(s.last(P).text, /intros to friends, collaborators and co-founders for Edge City India residents/);
  assert.match(s.last(P).text, /private agent: it talks only to you/);
  assert.equal(await s.send(P, "YES"), "consented");
  assert.match(s.last(P).text, /Are you at Edge City India \(Mandrem, Goa/);
  const calls = model.calls;
  assert.equal(await s.send(P, "No, I'm not"), "edge-only");
  assert.match(s.last(P).text, /Edge City only for now[\s\S]*https:\/\/kismet\.test\/waitlist/);
  assert.equal(await s.send(P, "name=Asha"), "asked:edgeCity"); // still nothing else is asked
  assert.match(s.last(P).text, /waitlist[\s\S]*reply YES/);
  assert.equal(await s.send(P, "what is edge city?"), "asked:edgeCity");
  assert.equal(model.calls, calls); // the question is read without the model
  assert.equal(s.app.users.size, 0);
  assert.equal(s.thread(P).draft.edgeCity, false);
  // Changed their mind (or tapped no by mistake): a yes goes on, with the weeks it names.
  assert.equal(await s.send(P, "yes, weeks 2 and 3"), "asked:name");
  assert.match(s.last(P).text, /welcome[\s\S]*only meets other Edge City residents' agents[\s\S]*What name/i);
  assert.deepEqual([s.thread(P).draft.edgeCity, s.thread(P).draft.edgeWeeks], [true, ["week2", "week3"]]);
});

test("edge city sign-up: unclear answers are explained and asked again; a yes reaches the account with its weeks", async () => {
  const s = withEdge(setup());
  const P = "+15550000102";
  await s.send(P, "hi");
  await s.send(P, "yes");
  assert.equal(await s.send(P, "what's that?"), "asked:edgeCity");
  assert.match(s.last(P).text, /pop-up village in Mandrem, Goa[\s\S]*Reply YES or NO/);
  assert.equal(await s.send(P, "not sure"), "asked:edgeCity");
  assert.equal(await s.send(P, "Yes, all 3 weeks"), "asked:name");
  for (const m of ["name=Asha", "relStatus=single", "skip", "lookingFor=friends", "interests=AI,surfing,music", "skip"]) await s.send(P, m);
  assert.equal(await s.send(P, "telegram=asha_k"), "recap");
  assert.match(s.last(P).text, /At Edge City India: all three weeks\./);
  assert.equal(await s.send(P, "YES"), "signed-up");
  const [u] = s.app.users.values();
  assert.deepEqual([u.edgeCity, u.edgeWeeks], [true, ["week1", "week2", "week3"]]);
});

test("edge city sign-up: a recap from before Edge City only asks the question before any account is made", async () => {
  const s = withEdge(setup());
  const P = "+15550000103";
  await toConfirm(s, P, "Asha");
  const t = s.thread(P);
  // A thread at its recap when this shipped: never asked.
  t.draft = { ...t.draft, edgeCity: undefined, edgeWeeks: undefined, asked: t.draft.asked.filter((f) => f !== "edgeCity") };
  assert.equal(t.state, "confirm");
  assert.equal(await s.send(P, "YES"), "asked:edgeCity"); // the YES answers nothing: the Edge City question first
  assert.match(s.last(P).text, /^One question first\. Are you at Edge City India/);
  assert.equal(s.app.users.size, 0);
  assert.equal(await s.send(P, "yes"), "recap"); // nothing else to ask: straight back to the recap
  assert.match(s.last(P).text, /Here's your profile: Asha\.\nAt Edge City India\./);
  assert.equal(await s.send(P, "YES"), "signed-up");
  assert.equal(s.app.users.size, 1);
  assert.equal([...s.app.users.values()][0].edgeCity, true);
});

test("edge city sign-up: a thread mid-interview when this shipped is asked first; its next answer is never read as one", async () => {
  const s = withEdge(setup());
  const P = "+15550000106";
  await s.send(P, "hi");
  await s.send(P, "yes");
  await s.send(P, "yes");
  await s.send(P, "name=Asha");
  const t = s.thread(P);
  t.draft = { ...t.draft, edgeCity: undefined, asked: [] }; // as it was before: name answered, asked about status
  assert.equal(await s.send(P, "no"), "asked:edgeCity"); // "no" answered the status question, not Edge City
  assert.equal(s.thread(P).draft.edgeCity, undefined);
  assert.equal(await s.send(P, "yes"), "asked:lookingFor");
});

test("edge city, accounts from before: asked on their next message; commands still work; yes joins the pool, no gets the waitlist", async () => {
  const s = withEdge(setup());
  const P = "+15550000104";
  await signUp(s, P, "Asha");
  const uid = [...s.app.users.keys()][0];
  s.app.users.get(uid).edgeCity = null; // an account from before: never asked
  const calls = model.calls;
  assert.equal(await s.send(P, "hey, any news?"), "edge-asked");
  assert.match(s.last(P).text, /Kismet is now just for Edge City India residents[\s\S]*Reply YES or NO[\s\S]*break from meeting people/);
  assert.equal(model.calls, calls); // no model call, no recommendation talk
  assert.equal(await s.send(P, "MATCHES"), "cmd:matches"); // commands still answer
  assert.equal(await s.send(P, "yes, week 3"), "edge-yes");
  assert.deepEqual([s.app.users.get(uid).edgeCity, s.app.users.get(uid).edgeWeeks], [true, ["week3"]]);
  assert.match(s.last(P).text, /welcome[\s\S]*off on 3 agent chats/i);
  assert.equal(await s.send(P, "hi again"), "chat"); // a member chats as before

  const Q = "+15550000105";
  await signUp(s, Q, "Ben");
  const vid = [...s.app.users.keys()][1];
  s.app.users.get(vid).edgeCity = null;
  assert.equal(await s.send(Q, "No"), "edge-asked"); // never shown the question yet: this "No" answers nothing
  assert.equal(s.app.users.get(vid).edgeCity, null);
  assert.equal(await s.send(Q, "Nope"), "edge-no");
  assert.equal(s.app.users.get(vid).edgeCity, false);
  assert.match(s.last(Q).text, /Edge City only for now[\s\S]*\/waitlist[\s\S]*after all, reply YES/);
  assert.equal(await s.send(Q, "tell me a joke"), "edge-asked"); // still out: the waitlist again, never the model
  assert.match(s.last(Q).text, /waitlist/);
  assert.equal(await s.send(Q, "DELETE ME"), "delete-asked"); // and they can always leave
});

test("edge city, accounts from before: a tap on an old recommendation's button, or a YES typed to it, is never the answer", async () => {
  const s = withEdge(setup());
  const { A, ua } = await pair(s); // Asha's recommendation was pushed before the deploy
  s.app.users.get(ua).edgeCity = null; // then the migration: never asked
  assert.equal(await s.send(A, "Yes", `kismet:yes:${DATE}`), "edge-asked"); // the button: the question instead
  assert.equal(s.app.users.get(ua).edgeCity, null);
  assert.match(s.last(A).text, /Are you at Edge City India/);
  assert.equal(await s.send(A, "No", `kismet:no:${DATE}`), "edge-asked"); // a button never answers it, even once asked
  assert.equal(s.app.users.get(ua).edgeCity, null);
  assert.equal(s.app.recs[0].decA, null); // and the recommendation was not answered either
  assert.equal(await s.send(A, "Yes, week 3"), "edge-yes"); // typed, after the question: that is the answer
  assert.equal(s.app.users.get(ua).edgeCity, true);
  assert.equal(s.app.recs[0].decA, null);

  const t = withEdge(setup());
  const p = await pair(t);
  t.app.users.get(p.ua).edgeCity = null;
  assert.equal(await t.send(p.A, "YES"), "edge-asked"); // a YES typed to the old push, before any question
  assert.equal(t.app.users.get(p.ua).edgeCity, null);
});

test("edge city, said no: a typed YES later puts them back (they saw the waitlist message that says so)", async () => {
  const s = withEdge(setup());
  const { A, ua } = await pair(s);
  s.app.users.get(ua).edgeCity = false;
  assert.equal(await s.send(A, "hello"), "edge-asked");
  assert.match(s.last(A).text, /waitlist[\s\S]*after all, reply YES/);
  assert.equal(await s.send(A, "YES"), "edge-yes");
  assert.equal(s.app.recs[0].decA, null); // the Edge City answer, never the recommendation
  assert.equal(s.app.users.get(ua).edgeCity, true);
});

// The 4.3(b) repositioning (2026-10-29): the chat says agent chats and intros. The web chat's "Meet more people" chip
// does what "Go on dates" did, and the old words still work for anyone who learned them.
test("intros copy: the greetings never say dating, and the chip and the old commands start agent chats", async () => {
  const { consentText, webConsentText } = await import("./agent.ts");
  for (const t of [consentText("https://k.test"), webConsentText("https://k.test")]) {
    assert.doesNotMatch(t, /\bdat(e|es|ed|ing)\b/i, t);
    assert.match(t, /intros to friends, collaborators and co-founders/);
  }
  for (const w of ["Meet more people", "meet more people.", "MORE", "dates", "Go on dates", "more dates"]) assert.deepEqual(parseCommand(w), { cmd: "dates" }, w);
});

// ---- Easy sign-up (2026-10-30): shorter interview, tapped answers without the model, Telegram optional on the web ----

test("easy sign-up: a tapped answer is read without the model; anything else still goes to it", () => {
  assert.deepEqual(chipAnswer("relStatus", "Prefer not to say"), { relStatus: "undisclosed" });
  assert.deepEqual(chipAnswer("relStatus", "in a relationship."), { relStatus: "relationship" });
  assert.equal(chipAnswer("relStatus", "single but it's complicated"), null);
  assert.deepEqual(chipAnswer("openness", "Skip"), { skipped: true });
  assert.deepEqual(chipAnswer("openness", "Not sure"), { openness: "unsure" });
  assert.deepEqual(chipAnswer("lookingFor", "Co-founder"), { lookingFor: ["cofounder"] });
  assert.deepEqual(chipAnswer("lookingFor", "Friends, collaborators and Just vibes"), { lookingFor: ["friends", "collaborators", "vibes"] });
  assert.equal(chipAnswer("lookingFor", "friends and someone to surf with"), null); // not all offered answers: the model
  assert.deepEqual(chipAnswer("genderInterest", "A woman, into men"), { gender: "woman", interestedIn: "men" });
  assert.deepEqual(chipAnswer("genderInterest", "Skip"), { skipped: true });
  assert.equal(chipAnswer("genderInterest", "A woman"), null);
  assert.deepEqual(chipAnswer("interests", "AI, startups, surfing"), { interests: ["AI", "startups", "surfing"] });
  // The model naming them again later (from the history) adds nothing: once each, whatever the case.
  assert.deepEqual(mergeDraft({ interests: ["AI", "startups", "surfing"] }, { interests: ["Startups", "surfing", "jazz"] }, "contact").interests, ["AI", "startups", "surfing", "jazz"]);
  assert.equal(chipAnswer("interests", "AI, jazz, chess"), null); // their own words: the model (and its notes)
  assert.deepEqual(chipAnswer("bio", "skip"), { skipped: true });
  assert.equal(chipAnswer("bio", "Skipper of a sailing boat"), null);
  assert.deepEqual(chipAnswer("contact", SKIP_CONTACT), { skipped: true });
  assert.equal(chipAnswer("contact", "asha_k"), null);
  for (const f of ["name", "edgeCity", null]) assert.equal(chipAnswer(f, "Skip"), null, String(f)); // never read without the model or the Edge City parser
});

test("easy sign-up: private questions only for romance; the step counter follows the draft", () => {
  let d = { edgeCity: true, name: "Asha" };
  assert.equal(nextField(d), "lookingFor");
  assert.deepEqual(signupProgress({}, "consent"), { step: 1, total: 8 });
  assert.deepEqual(signupProgress(d, "interview"), { step: 4, total: 8 });
  d = mergeDraft(d, { lookingFor: ["friends", "cofounder"] }, "lookingFor");
  assert.equal(nextField(d), "interests"); // no relationship status, openness or gender asked
  d = mergeDraft(d, { interests: ["AI", "surfing", "music"] }, "interests");
  d = mergeDraft(d, { skipped: true }, "bio");
  assert.equal(nextField(d), "contact");
  assert.deepEqual(signupProgress(d, "interview"), { step: 7, total: 8 });
  assert.deepEqual(signupProgress(d, "confirm"), { step: 8, total: 8 });
  assert.equal(nextField({ ...d, asked: [...d.asked, "contact"] }), null); // the website's Skip
  const romance = { edgeCity: true, name: "Ben", lookingFor: ["romance"], relStatus: "single" };
  assert.equal(nextField(romance), "openness");
  assert.deepEqual(signupProgress(romance, "interview"), { step: 6, total: 11 });
  assert.equal(signupProgress(romance, "active"), null);
  assert.match(recapText({ ...d, asked: [...d.asked, "contact"] }, "web:a:x"), /Matches message you here in Kismet/);
  assert.doesNotMatch(recapText({ ...d, asked: [...d.asked, "contact"] }, "web:a:x"), /@undefined|Status \(private\)/);
});

test("easy sign-up on the web: taps need no model call, no Telegram is fine, and the account has none", async () => {
  const s = setup();
  const base = memoryAdapter();
  const web = { ...base, channel: "web", live: true, inbound: (from, text, buttonId) => { const m = base.inbound(from, text, buttonId); return { ...m, channel: "web", providerId: `web-${m.providerId}` }; } };
  const wsend = (from, text) => handleInbound({ ...s.deps(), adapter: web }, web.inbound(from, text));
  const W = "web:a:auth-easy";
  const lastWeb = () => base.sent.filter((x) => x.to === W).at(-1).text;
  await wsend(W, "hi");
  assert.equal(await wsend(W, "Yes, I agree"), "consented");
  assert.equal(await wsend(W, "Yes, I'm here"), "asked:name");
  assert.equal(await wsend(W, "name=Asha"), "asked:lookingFor");
  const calls = model.calls;
  assert.equal(await wsend(W, "Co-founder"), "asked:interests");
  assert.equal(await wsend(W, "AI, startups, surfing"), "asked:bio");
  assert.equal(await wsend(W, "Skip"), "asked:contact");
  assert.match(lastWeb(), /^How should matches reach you\? Send your Telegram username .*or skip/);
  assert.equal(await wsend(W, SKIP_CONTACT), "recap");
  assert.equal(model.calls, calls, "four taps, no model call");
  assert.match(lastWeb(), /Here for: Co-founder\.[\s\S]*Interests: AI, startups, surfing\.[\s\S]*Matches message you here in Kismet/);
  assert.equal(await wsend(W, "YES"), "signed-up");
  const u = [...s.app.users.values()].at(-1);
  assert.deepEqual([u.name, u.lookingFor, u.relStatus, u.telegram, u.contactMethod], ["Asha", ["cofounder"], "undisclosed", "", "telegram"]);
});

test("easy sign-up: WhatsApp still needs a way to reach them (Telegram or this number); skip asks again", async () => {
  const s = setup();
  const P = "+15550000123";
  await toConfirm(s, P, "Asha", "skip");
  assert.equal(s.thread(P).state, "interview");
  assert.equal(await s.send(P, SKIP_CONTACT), "asked:contact");
  assert.match(s.last(P).text, /reply PHONE/);
});

test("easy sign-up review fixes: private answers only with Romance; no step line on the waitlist; a Telegram at the recap", async () => {
  // Romance picked, status given, then Romance dropped: the private answers are not kept or shown.
  const d = { edgeCity: true, name: "Asha", lookingFor: ["friends"], relStatus: "married", openness: "poly", gender: "woman", interestedIn: "men", interests: ["AI", "art", "yoga"], asked: ["bio"], telegram: "asha_k", contactMethod: "telegram" };
  assert.deepEqual(Object.values((({ relStatus, openness, gender, interestedIn }) => ({ relStatus, openness, gender, interestedIn }))(draftProfile(d))), ["undisclosed", null, null, null]);
  assert.doesNotMatch(recapText(d, "web:a:x"), /Status \(private\)/);
  const r = draftProfile({ ...d, lookingFor: ["romance"] });
  assert.deepEqual([r.relStatus, r.openness, r.gender, r.interestedIn], ["married", "poly", "woman", "men"]);
  assert.equal(signupProgress({ edgeCity: false }, "interview"), null); // "No, I'm not": the waitlist, no step line

  // The website: Telegram skipped, then a username typed at the recap is read without the model's help.
  const s = setup();
  const base = memoryAdapter();
  const web = { ...base, channel: "web", live: true, inbound: (from, text, buttonId) => { const m = base.inbound(from, text, buttonId); return { ...m, channel: "web", providerId: `web-${m.providerId}` }; } };
  const wsend = (from, text) => handleInbound({ ...s.deps(), adapter: web }, web.inbound(from, text));
  const W = "web:a:auth-recap";
  for (const m of ["hi", "Yes, I agree", "Yes, I'm here", "name=Asha", "Friends", "AI, startups, surfing", "Skip"]) await wsend(W, m);
  assert.equal(await wsend(W, SKIP_CONTACT), "recap");
  assert.equal(await wsend(W, "@asha_builds"), "recap");
  assert.match(base.sent.filter((x) => x.to === W).at(-1).text, /Matches reach you via Telegram @asha_builds/);
  // WhatsApp at its recap: a bare handle is still only read on the contact question (unchanged).
  const P = "+15550000124";
  await toConfirm(s, P, "Ben", "telegram=ben_surfs");
  assert.equal(await s.send(P, "@ben_new1"), "recap");
  assert.equal(s.thread(P).draft.telegram, "ben_surfs");
});

test("easy sign-up: a thread at the old relationship-status question when this ships is asked what it's here for, not stuck", async () => {
  const s = setup();
  const P = "+15550000125";
  await s.send(P, "hi");
  await s.send(P, "yes");
  await s.send(P, "yes");
  await s.send(P, "name=Asha");
  const t = s.thread(P);
  t.draft = { ...t.draft, lookingFor: undefined }; // as before: name given, "Relationship status?" was the last question
  assert.equal(await s.send(P, "Single"), "asked:lookingFor"); // not a looking-for answer: asked what they're here for
  assert.equal(await s.send(P, "Friends"), "asked:interests");
});
