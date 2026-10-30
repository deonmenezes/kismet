// Run: npm test. The model contact check (lib/contact-check.ts) on every door, through the real route handlers on PGlite
// with the model mocked: web /api/signup, PATCH /api/me, POST /api/me/notes, Agent Village /api/village/signup and
// notes, and MCP kismet_signup. Kismet by text signs up and edits through the same insertUser / updateProfile.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const KEY = (process.env.VILLAGE_PARTNER_KEY = "test-partner-key-0123456789abcdef0123456789");
const pg = await freshDb();
const signup = await import("../app/api/signup/route.ts");
const me = await import("../app/api/me/route.ts");
const notesRoute = await import("../app/api/me/notes/route.ts");
const village = await import("../app/api/village/[op]/route.ts");
const mcp = await import("../app/mcp/route.ts");
const { afterQueue } = await import("next/server");

const down = globalThis.__kismetContactModel;
const SPANS = ["find me on the gram, k a b i r s u r f s", "inst@: meera.paints", "the word saltwater on the bird app", "snap biscuit"];
globalThis.__kismetContactModel = async ({ prompt }) => {
  const found = [];
  for (const m of prompt.matchAll(/<field name="([^"]+)">\n([\s\S]*?)\n<\/field>/g)) for (const s of SPANS) if (m[2].includes(s)) found.push({ field: m[1], text: s });
  return JSON.stringify({ found });
};
const w = console.log;
console.log = () => {};

const INTERESTS = ["AI", "Music"];
const body = (name, extra = {}) => ({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: INTERESTS, agreedToTerms: true, ageConfirmed: true, edgeCity: true, ...extra });
const json = (method, url, b, headers = {}) => new Request(url, { method, headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", ...headers }, body: JSON.stringify(b) });
const partner = (subject) => ({ authorization: `Bearer ${KEY}`, "x-village-subject": subject });
const byName = async (name) => (await pg.query("select id, bio, contacts_checked_at from users where name = $1", [name])).rows[0];
const notesOf = async (id) => (await pg.query("select text from agent_notes where user_id = $1 order by text", [id])).rows.map((r) => r.text);

afterEach(async () => {
  afterQueue.length = 0;
  await pg.exec("delete from rate_limits; delete from agent_notes; delete from users;");
});

test("web sign-up, then PATCH /api/me and POST /api/me/notes", async () => {
  const res = await signup.POST(json("POST", "https://kismet.test/api/signup", body("Asha", { bio: "Potter. inst@: meera.paints", notes: ["Usually the word saltwater on the bird app"] })));
  assert.equal(res.status, 201, await res.clone().text());
  const token = new URL((await res.json()).privateLink).pathname.split("/").pop();
  const u = await byName("Asha");
  assert.deepEqual([u.bio, Boolean(u.contacts_checked_at)], ["Potter. [removed]", true]);
  assert.deepEqual(await notesOf(u.id), ["Usually [removed]"]);
  const auth = { authorization: `Bearer ${token}` };
  const edit = await me.PATCH(json("PATCH", "https://kismet.test/api/me", body("Asha", { bio: "Potter. snap biscuit" }), auth));
  assert.equal(edit.status, 200, await edit.clone().text());
  assert.equal((await byName("Asha")).bio, "Potter. [removed]");
  const added = await notesRoute.POST(json("POST", "https://kismet.test/api/me/notes", { notes: ["find me on the gram, k a b i r s u r f s", "Throws pots"] }, auth));
  assert.equal(added.status, 201);
  assert.deepEqual(await notesOf(u.id), ["Throws pots", "Usually [removed]"]);
});

test("Agent Village sign-up and notes, and MCP kismet_signup", async () => {
  const res = await village.POST(json("POST", "https://kismet.test/api/village/signup", { answers: body("Vik", { about: "Surfer, snap biscuit" }), notes: ["inst@: meera.paints"] }, partner("res-v")),
    { params: Promise.resolve({ op: "signup" }) });
  assert.equal(res.status, 201, await res.clone().text());
  const v = await byName("Vik");
  assert.deepEqual([v.bio, Boolean(v.contacts_checked_at)], ["Surfer, [removed]", true]);
  assert.deepEqual(await notesOf(v.id), [], "a note that was only a contact is not kept");
  const n = await village.POST(json("POST", "https://kismet.test/api/village/notes", { add: ["Big on the word saltwater on the bird app"] }, partner("res-v")), { params: Promise.resolve({ op: "notes" }) });
  assert.equal(n.status, 200, await n.clone().text());
  assert.deepEqual(await notesOf(v.id), ["Big on [removed]"]);
  const t = await mcp.POST(json("POST", "https://kismet.test/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "kismet_signup", arguments: { answers: body("Mira", { about: "Dancer. find me on the gram, k a b i r s u r f s" }) } } }, partner("res-m")));
  assert.equal((await t.json()).result.isError ?? false, false);
  assert.equal((await byName("Mira")).bio, "Dancer. [removed]");
});

test("the model down on a door: the sign-up succeeds with the regex text, unchecked", async () => {
  globalThis.__kismetContactModel = down;
  try {
    const res = await signup.POST(json("POST", "https://kismet.test/api/signup", body("Dev", { bio: "snap biscuit" })));
    assert.equal(res.status, 201);
    const u = await byName("Dev");
    assert.deepEqual([u.bio, u.contacts_checked_at], ["snap biscuit", null]);
  } finally {
    console.log = w;
  }
});
