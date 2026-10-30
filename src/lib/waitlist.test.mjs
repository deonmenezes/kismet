// Run: npm test. Waitlist logic against an in-memory store (production uses Neon, lib/waitlist-store.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinWaitlist, parseWaitlist, position, REFERRAL_BOOST, removalHash, WAITLIST_PER_IP_HOUR } from "./waitlist.ts";

function memoryStore() {
  const rows = [];
  const hits = new Map();
  const view = (r) => ({ refCode: r.refCode, order: rows.indexOf(r) + 1, referrals: rows.filter((x) => x.referredBy === r.refCode).length });
  return {
    rows,
    hit: async (ip) => { hits.set(ip, (hits.get(ip) ?? 0) + 1); return hits.get(ip) <= WAITLIST_PER_IP_HOUR; },
    byEmail: async (email) => { const r = rows.find((x) => x.email.toLowerCase() === email.toLowerCase()); return r ? view(r) : null; },
    refExists: async (code) => rows.some((x) => x.refCode === code),
    insert: async (w) => { if (rows.some((x) => x.email === w.email)) return null; rows.push(w); return view(w); },
  };
}
const body = (email, extra = {}) => ({ email, consent: true, ...extra });
let ip = 0;
const nextIp = () => `ip-${++ip}`;

test("the same email again returns the same position and referral code, never an error or a second row", async () => {
  const s = memoryStore();
  const first = await joinWaitlist(s, body("Asha@Example.com", { name: "Asha" }), nextIp());
  await joinWaitlist(s, body("ben@example.com"), nextIp());
  const again = await joinWaitlist(s, body("  asha@example.COM "), nextIp());
  assert.equal(first.existing, false);
  assert.equal(first.position, 1);
  assert.ok(first.removalToken);
  assert.deepEqual([again.ok, again.existing, again.position, again.refCode, again.removalToken], [true, true, 1, first.refCode, null]);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].email, "asha@example.com");
  assert.equal(s.rows[0].removalHash, removalHash(first.removalToken)); // only the hash is stored
});

test("referral math: each sign-up through your link moves you up 3 places, never above #1", async () => {
  assert.equal(position(10, 0), 10);
  assert.equal(position(10, 2), 10 - 2 * REFERRAL_BOOST);
  assert.equal(position(5, 4), 1);
  const s = memoryStore();
  for (let i = 1; i <= 9; i++) await joinWaitlist(s, body(`p${i}@example.com`), nextIp());
  const me = await joinWaitlist(s, body("me@example.com"), nextIp());
  assert.equal(me.position, 10);
  await joinWaitlist(s, body("f1@example.com", { ref: me.refCode }), nextIp());
  await joinWaitlist(s, body("f2@example.com", { ref: me.refCode }), nextIp());
  await joinWaitlist(s, body("f3@example.com", { ref: "zzzzzzzz" }), nextIp()); // unknown code: no credit
  const now = await joinWaitlist(s, body("me@example.com"), nextIp());
  assert.equal(now.position, 10 - 2 * REFERRAL_BOOST);
  assert.equal(s.rows.find((r) => r.email === "f3@example.com").referredBy, null);
});

test("honeypot: a filled hidden field looks like success but stores nothing", async () => {
  const s = memoryStore();
  const r = await joinWaitlist(s, body("bot@example.com", { website: "http://spam.example" }), nextIp());
  assert.deepEqual(r, { ok: true, bot: true });
  assert.equal(s.rows.length, 0);
  assert.equal(parseWaitlist(body("x@example.com", { website: "  " })).input.email, "x@example.com"); // empty is fine
});

test("rate limit per IP, checked before anything else (no probing emails)", async () => {
  const s = memoryStore();
  const addr = nextIp();
  for (let i = 0; i < WAITLIST_PER_IP_HOUR; i++) assert.equal((await joinWaitlist(s, body(`r${i}@example.com`), addr)).ok, true);
  const over = await joinWaitlist(s, body("r0@example.com"), addr);
  assert.deepEqual([over.ok, over.status], [false, 429]);
  assert.equal((await joinWaitlist(s, body("other@example.com"), nextIp())).ok, true);
});

test("validation: email and consent required; optional fields cleaned", () => {
  assert.ok("error" in parseWaitlist({ consent: true }));
  assert.ok("error" in parseWaitlist({ email: "not-an-email", consent: true }));
  assert.ok("error" in parseWaitlist({ email: "a@example.com" }));
  assert.ok("error" in parseWaitlist({ email: "a@example.com", consent: "yes" }));
  const { input } = parseWaitlist({ email: "A@Example.com", consent: true, handle: "https://x.com/asha_dev", platforms: ["ios", "pc", "web"],
    interests: ["AI", "AI", "x".repeat(40)], name: " Asha\n<b> ", ref: "BAD" });
  assert.deepEqual(input, { email: "a@example.com", name: "Asha b", place: "", handle: "asha_dev", interests: ["AI", "x".repeat(30)], platforms: ["ios", "web"], ref: null });
});
