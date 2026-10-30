// Run: npm test. The match chat's polling backs off when idle (lib/poll.ts, QA2: ~25 requests a minute per tab).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollDelay } from "./poll.ts";

test("match chat polling: 4 s while active, then 8, 16 and at most 30 s", () => {
  assert.equal(pollDelay(0), 4000);
  assert.equal(pollDelay(119_999), 4000);
  assert.equal(pollDelay(120_001), 8000);
  assert.equal(pollDelay(180_001), 16_000);
  assert.equal(pollDelay(240_001), 30_000);
  assert.equal(pollDelay(3_600_000), 30_000);
  // An idle hour: about 2 requests a minute instead of 15.
  assert.ok(60_000 / pollDelay(3_600_000) <= 2);
});
