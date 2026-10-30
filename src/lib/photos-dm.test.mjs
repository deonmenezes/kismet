// Run: npm test. Photo entitlement, EXIF stripping, moderation, and direct messages between matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { canSeePhotos } from "./secret.ts";
import { fromBase64, PhotoError, toCleanJpeg } from "./photo-image.ts";
import { judge, moderate } from "./photo-check.ts";
import { chatState, cleanText, ENDED, PER_MINUTE, readMessages, sendMessage, unmatch } from "./dm.ts";
import { summaryText } from "./chat.ts";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const C = "c0000000-0000-4000-8000-00000000000c";
const yes = { score: 8, meet: true, reason: "r", bestLine: "l", suggestedMeetup: "m" };
const no = { ...yes, meet: false };
const date = (over = {}) => ({
  id: "d0000000-0000-4000-8000-0000000000d1", aId: A, bId: B, mode: "friendly", status: "done", transcript: [],
  verdictA: yes, verdictB: yes, decisionA: null, decisionB: null, matchedAt: null, chatClosedAt: null, readA: 0, readB: 0,
  createdAt: "2026-10-18T10:00:00.000Z", ...over,
});
const matched = (over = {}) => date({ decisionA: "meet", decisionB: "meet", matchedAt: "2026-10-18T11:00:00.000Z", ...over });

test("photo entitlement: only the owner, an open recommendation of that person, or an open match", () => {
  assert.equal(canSeePhotos([], A, A), true);
  assert.equal(canSeePhotos([], C, A), false); // a stranger with no date
  assert.equal(canSeePhotos([date()], A, B), true); // A's agent recommends B: A sees B
  assert.equal(canSeePhotos([date({ verdictA: no })], A, B), false); // A's agent did not recommend B
  assert.equal(canSeePhotos([date({ verdictA: no })], B, A), true); // B's agent did recommend A
  assert.equal(canSeePhotos([date({ decisionA: "pass" })], A, B), false); // answered (no): gone
  assert.equal(canSeePhotos([date({ decisionA: "meet" })], A, B), false); // answered yes, not mutual yet: gone
  assert.equal(canSeePhotos([date({ status: "running", verdictA: null, verdictB: null })], A, B), false);
  assert.equal(canSeePhotos([matched()], A, B), true);
  assert.equal(canSeePhotos([matched({ chatClosedAt: "2026-10-18T12:00:00.000Z" })], A, B), false); // unmatched
  assert.equal(canSeePhotos([matched()], C, B), false); // someone else's match
  assert.equal(canSeePhotos([date({ aId: C, bId: B })], A, B), false); // a date between other people
});

test("photos are re-encoded to JPEG with no EXIF/GPS, auto-rotated and resized", async () => {
  const withGps = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: "#e07050" } })
    .withExif({ IFD0: { Make: "PhoneCo", Model: "SECRET-MODEL" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "15/1 39/1 0/1" } })
    .jpeg().toBuffer();
  const before = await sharp(withGps).metadata();
  assert.ok(before.exif && before.exif.length > 0);
  const out = await toCleanJpeg(withGps, 1024);
  const after = await sharp(out.data).metadata();
  assert.equal(after.format, "jpeg");
  assert.equal(after.exif, undefined);
  assert.equal(after.icc, undefined);
  assert.equal(after.xmp, undefined);
  assert.ok(!out.data.includes(Buffer.from("SECRET-MODEL")));
  assert.deepEqual([out.width, out.height], [1024, 614]);
  const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: "#00000000" } }).png().toBuffer();
  assert.equal((await sharp((await toCleanJpeg(png, 512)).data).metadata()).format, "jpeg");
  await assert.rejects(toCleanJpeg(Buffer.from("not an image at all"), 512), PhotoError);
  await assert.rejects(toCleanJpeg(new Uint8Array(5 * 1024 * 1024 + 1), 512), (e) => e instanceof PhotoError && e.status === 413);
  assert.equal(fromBase64("data:image/png;base64,@@@"), null);
  assert.deepEqual([...fromBase64("data:image/png;base64,AQID")], [1, 2, 3]);
});

test("moderation: nudity, minors, violence, no person or an unreadable answer are rejected (never stored)", async () => {
  const clean = { person: true, nudity: false, minor: false, violence: false };
  assert.deepEqual(judge(JSON.stringify(clean)), { ok: true });
  for (const bad of [{ ...clean, nudity: true }, { ...clean, minor: true }, { ...clean, violence: true }, { ...clean, person: false }, { person: true }]) {
    assert.equal(judge(JSON.stringify(bad)).ok, false, JSON.stringify(bad));
  }
  assert.match(judge(JSON.stringify({ ...clean, minor: true })).reason, /under 18/);
  assert.equal(judge("I think it's fine").ok, false);
  const stored = [];
  const mockReject = async () => '```json\n{"person": true, "nudity": true, "minor": false, "violence": false}\n```';
  const v = await moderate(mockReject, new Uint8Array([1]));
  if (v.ok) stored.push(1);
  assert.deepEqual([v.ok, stored.length], [false, 0]);
  assert.equal((await moderate(async () => { throw new Error("gateway down"); }, new Uint8Array([1]))).ok, false);
});

function memoryDm(d) {
  const msgs = [];
  const hits = new Map();
  const store = {
    msgs,
    blockedPair: false,
    date: async (id) => (id === d.id ? d : null),
    blocked: async () => store.blockedPair,
    hit: async (key, limit) => { hits.set(key, (hits.get(key) ?? 0) + 1); return hits.get(key) <= limit; },
    insert: async (dateId, senderId, text) => { const m = { id: msgs.length + 1, senderId, text, createdAt: new Date().toISOString() }; msgs.push(m); return m; },
    list: async (dateId, afterId, limit) => msgs.filter((m) => m.id > afterId).slice(0, limit),
    markRead: async (dateId, side, upTo) => { d[side === "a" ? "readA" : "readB"] = Math.max(d[side === "a" ? "readA" : "readB"], upTo); },
    close: async () => { d.chatClosedAt = new Date().toISOString(); },
  };
  return store;
}

test("messaging only between matched people; IDOR on matchId answers 404", async () => {
  const d = matched();
  const s = memoryDm(d);
  assert.equal((await sendMessage(s, A, d.id, { text: "hi Bee!" })).ok, true);
  const forB = await readMessages(s, B, d.id);
  assert.deepEqual(forB.messages.map((m) => [m.mine, m.text]), [[false, "hi Bee!"]]);
  assert.equal(d.readB, 1); // marked read on fetch
  assert.equal((await readMessages(s, A, d.id, 1)).messages.length, 0); // ?after= polling
  // Someone outside the match, or an unknown id: the same 404.
  for (const [who, id] of [[C, d.id], [A, "e0000000-0000-4000-8000-000000000000"]]) {
    assert.equal((await readMessages(s, who, id)).status, 404);
    assert.equal((await sendMessage(s, who, id, { text: "x" })).status, 404);
    assert.equal((await unmatch(s, who, id)).status, 404);
  }
  // Not a match (yet): a recommendation, one-sided yes, or both agents yes but a human said no.
  for (const notYet of [date(), date({ decisionA: "meet" }), date({ decisionA: "meet", decisionB: "pass" }), date({ verdictB: no, decisionA: "meet", decisionB: "meet" })]) {
    const s2 = memoryDm(notYet);
    assert.equal((await sendMessage(s2, A, notYet.id, { text: "hi" })).status, 404);
    assert.equal(chatState(notYet, A, false), null);
  }
  assert.equal((await sendMessage(s, A, d.id, { text: "  " })).status, 400);
  assert.equal((await sendMessage(s, A, d.id, { text: "x".repeat(1001) })).status, 400);
  assert.equal(cleanText("a\u0000b‮c\n  d\t"), "abc\n  d");
});

test("unmatch, block or report closes the chat for both, with the same neutral notice", async () => {
  const d = matched();
  const s = memoryDm(d);
  await sendMessage(s, A, d.id, { text: "see you at sunset" });
  assert.equal((await unmatch(s, B, d.id)).ok, true);
  for (const who of [A, B]) {
    const r = await readMessages(s, who, d.id);
    assert.deepEqual([r.ended, r.text, r.messages.length], [true, ENDED, 0]);
    const w = await sendMessage(s, who, d.id, { text: "hello?" });
    assert.deepEqual([w.status, w.error], [409, ENDED]);
  }
  const d2 = matched();
  const s2 = memoryDm(d2);
  s2.blockedPair = true; // a block (either way) or a ban
  assert.equal((await readMessages(s2, A, d2.id)).ended, true);
  assert.equal((await sendMessage(s2, B, d2.id, { text: "hi" })).status, 409);
});

test("rate limits: 30 messages a minute per person", async () => {
  const d = matched();
  const s = memoryDm(d);
  for (let i = 0; i < PER_MINUTE; i++) assert.equal((await sendMessage(s, A, d.id, { text: `m${i}` })).ok, true);
  const over = await sendMessage(s, A, d.id, { text: "one more" });
  assert.equal(over.status, 429);
  assert.equal(s.msgs.length, PER_MINUTE);
  assert.equal((await sendMessage(s, B, d.id, { text: "my own limit" })).ok, true);
});

test("summary mentions unread counts and that someone has a photo, never message text or photo URLs", () => {
  const t = summaryText({
    since: null, datesLeftToday: 6, running: 0, worldId: { verifyLink: null }, topPick: null,
    recommendations: [{ dateId: "r1", name: "Priya", worldVerified: false, photos: ["https://x/api/photos/p1"], sharedInterests: [], myAgent: { reason: "", suggestedMeetup: "" } }],
    matches: [{ dateId: "m1", name: "Bee", telegram: "bee_tg", worldVerified: false, unread: 2, lastMessage: { text: "SECRET-MESSAGE", mine: false, createdAt: "" }, photos: ["https://x/api/photos/p2"] }],
  });
  assert.match(t, /2 unread messages from Bee/);
  assert.match(t, /Priya \(has a photo\)/);
  assert.doesNotMatch(t, /SECRET-MESSAGE|api\/photos/);
});
