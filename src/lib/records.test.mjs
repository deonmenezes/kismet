// Run: npm test. Model fallback, client/channel parsing, profile history diffs, agent notes and the village notes op.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AllModelsFailed, withFallback } from "./fallback.ts";
import { bodyClient, parseClientHeader, parseNotes, profileChanges, resolveClient, NOTE_MAX, NOTES_PER_CALL } from "./client.ts";
import { parseVillageRequest, VILLAGE_OPS } from "./village.ts";

const attempt = (id, run, timeoutMs = 1000) => ({ id, timeoutMs, run });
const nonEmpty = (t) => t.trim().length > 0;

test("fallback: the first usable reply wins and says which model served", async () => {
  const lines = [];
  const r = await withFallback("date", [attempt("a", async () => "hello"), attempt("b", async () => assert.fail("not called"))], nonEmpty, (l) => lines.push(l));
  assert.deepEqual([r.value, r.model, r.tried], ["hello", "a", ["a"]]);
  assert.match(lines[0], /^date served by a in \d+ ms$/);
});

test("fallback: an error, an empty reply and an unusable reply each move to the next model", async () => {
  const lines = [];
  const r = await withFallback("date", [
    attempt("err", async () => { throw new Error("502 bad gateway"); }),
    attempt("empty", async () => "   "),
    attempt("bad", async () => "{broken"),
    attempt("good", async () => '{"ok":true}'),
  ], (t) => { try { JSON.parse(t); return true; } catch { return false; } }, (l) => lines.push(l));
  assert.equal(r.model, "good");
  assert.deepEqual(r.tried, ["err", "empty", "bad", "good"]);
  assert.match(lines[0], /after err \(502 bad gateway\), empty \(empty or unusable reply\), bad \(empty or unusable reply\)/);
});

test("fallback: a model that hangs past its timeout is abandoned, even if it ignores the signal", async () => {
  let aborted = false;
  const t = Date.now();
  const r = await withFallback("card", [
    attempt("slow", (signal) => { signal.addEventListener("abort", () => (aborted = true)); return new Promise(() => {}); }, 50),
    attempt("fast", async () => "ok"),
  ], nonEmpty);
  assert.equal(r.model, "fast");
  assert.ok(aborted);
  assert.ok(Date.now() - t < 1000);
});

test("fallback: when every model fails, AllModelsFailed lists each reason", async () => {
  await assert.rejects(
    withFallback("date", [attempt("a", async () => ""), attempt("b", async () => { throw new Error("down"); })], nonEmpty),
    (e) => e instanceof AllModelsFailed && e.failures.length === 2 && /a: empty or unusable reply; b: down/.test(e.message),
  );
});

test("client: X-Kismet-Client header, body fields, then Bearer = api and cookie = web", () => {
  assert.deepEqual(parseClientHeader("ios/1.0.0"), { channel: "ios", client: "ios/1.0.0" });
  assert.deepEqual(parseClientHeader("iMessage/1.2.3 (build 7)"), { channel: "imessage", client: "imessage/1.2.3" });
  assert.deepEqual(parseClientHeader("android"), { channel: "android", client: "" });
  // Only clients may be claimed: never village (partner API only) or system.
  for (const bad of ["village/1.0", "system", "hacker/1", "", null, "x".repeat(200)]) assert.equal(parseClientHeader(bad), null, String(bad));
  assert.deepEqual(parseClientHeader("ios/<script>"), { channel: "ios", client: "" });
  assert.deepEqual(bodyClient({ client: "imessage/1.0.0" }), { channel: "imessage", client: "imessage/1.0.0" });
  assert.deepEqual(bodyClient({ channel: "ios", appVersion: "1.0.0" }), { channel: "ios", client: "ios/1.0.0" });
  assert.equal(bodyClient({ channel: "village" }), null);
  assert.deepEqual(resolveClient("ios/1.0.0", true, { channel: "android" }), { channel: "ios", client: "ios/1.0.0" });
  assert.deepEqual(resolveClient(null, true), { channel: "api", client: "" });
  assert.deepEqual(resolveClient(null, false), { channel: "web", client: "" });
});

test("profile history: only changed fields, with the previous and the new value", () => {
  const before = { name: "Asha", interests: ["AI", "Music"], bio: "", openness: null, publicQuotes: false, tags: ["x"] };
  const after = { name: "Asha", interests: ["AI", "Surfing"], bio: "Hi", openness: null, publicQuotes: false };
  assert.deepEqual(profileChanges(before, after), [
    { field: "interests", old: ["AI", "Music"], new: ["AI", "Surfing"] },
    { field: "bio", old: "", new: "Hi" },
  ]);
  assert.deepEqual(profileChanges(after, after), []);
});

test("agent notes: one or many, trimmed, bounded", () => {
  assert.deepEqual(parseNotes({ text: "  Builds  a reef-mapping drone " }), ["Builds a reef-mapping drone"]);
  assert.deepEqual(parseNotes({ notes: ["Surfs at dawn", "Surfs at dawn", "Wants a co-founder"] }), ["Surfs at dawn", "Wants a co-founder"]);
  for (const bad of [null, [], {}, { notes: [] }, { notes: [""] }, { notes: [5] }, { text: "x".repeat(NOTE_MAX + 1) },
    { notes: Array.from({ length: NOTES_PER_CALL + 1 }, (_, i) => `fact ${i}`) }]) {
    assert.ok("error" in parseNotes(bad), JSON.stringify(bad)?.slice(0, 40));
  }
});

test("village: notes op (list, add, delete one or all) and optional notes on signup, exact fields", () => {
  assert.ok(VILLAGE_OPS.includes("notes"));
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseVillageRequest("notes", { residentId: "r1" }), { op: "notes", residentId: "r1" });
  assert.deepEqual(parseVillageRequest("notes", { residentId: "r1", add: ["Surfs"] }), { op: "notes", residentId: "r1", add: ["Surfs"] });
  assert.deepEqual(parseVillageRequest("notes", { residentId: "r1", deleteId: id.toUpperCase() }), { op: "notes", residentId: "r1", deleteId: id });
  assert.deepEqual(parseVillageRequest("notes", { residentId: "r1", deleteAll: true }), { op: "notes", residentId: "r1", deleteAll: true });
  for (const bad of [{ residentId: "r1", deleteId: "x" }, { residentId: "r1", add: ["a"], deleteAll: true }, { residentId: "r1", deleteAll: "yes" }, { residentId: "r1", text: "a" }]) {
    assert.ok("error" in parseVillageRequest("notes", bad), JSON.stringify(bad));
  }
  const s = parseVillageRequest("signup", { residentId: "r1", answers: {}, notes: ["Surfs"] });
  assert.deepEqual(s.notes, ["Surfs"]);
  assert.equal(parseVillageRequest("signup", { residentId: "r1", answers: {} }).notes, undefined);
});
