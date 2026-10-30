// Run: npm test. QA3 N3-L2: the "account deleted" notice needs this tab's flag from a real delete; the link alone shows nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markDeleted, takeDeleted } from "./deleted-note.ts";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
};
const T = 1_800_000_000_000;

test("a crafted /?deleted=1 with no delete in this tab shows nothing", () => {
  assert.equal(takeDeleted("?deleted=1", T, memory()), false);
  assert.equal(takeDeleted("?deleted=1", T, null), false, "no storage at all");
});

test("after a real delete in this tab the notice shows once, then never again (reload, later visit)", () => {
  const s = memory();
  markDeleted(T, s);
  assert.equal(takeDeleted("?deleted=1", T + 2_000, s), true);
  assert.equal(s.m.size, 0, "the flag is used up");
  assert.equal(takeDeleted("?deleted=1", T + 4_000, s), false);
});

test("the flag needs the address too, is used up either way, and goes stale after 10 minutes", () => {
  const s = memory();
  markDeleted(T, s);
  assert.equal(takeDeleted("", T + 1_000, s), false, "plain / never shows it");
  assert.equal(takeDeleted("?deleted=1", T + 2_000, s), false, "and it was used up");
  markDeleted(T, s);
  assert.equal(takeDeleted("?deleted=1", T + 11 * 60_000, s), false, "stale");
  s.setItem("kismet:deleted", "junk");
  assert.equal(takeDeleted("?deleted=1", T, s), false, "not a time");
  markDeleted(T + 60_000, s);
  assert.equal(takeDeleted("?deleted=1", T, s), false, "from the future");
});

test("blocked storage never throws", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => markDeleted(T, broken));
  assert.equal(takeDeleted("?deleted=1", T, broken), false);
});
