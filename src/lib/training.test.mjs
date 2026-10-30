// Sharing for feedback and training: asked once after 90 minutes of use, and what shared data must go through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bothShared, cleanFeedback, FEEDBACK_MAX, scrubForTraining, shouldAsk } from "./training-core.ts";

test("training: asked once, only after 90 minutes of use", () => {
  assert.equal(shouldAsk(null, 89), false);
  assert.equal(shouldAsk(null, 90), true);
  assert.equal(shouldAsk(true, 500), false); // answered: Profile is where they change it
  assert.equal(shouldAsk(false, 500), false);
});

test("training: feedback is trimmed, capped and empty means none", () => {
  assert.equal(cleanFeedback("  more  dates\n please "), "more dates please");
  assert.equal(cleanFeedback("   "), null);
  assert.equal(cleanFeedback(42), null);
  assert.equal(cleanFeedback("x".repeat(FEEDBACK_MAX + 50)).length, FEEDBACK_MAX);
});

test("training: names and contact details never leave, and a date needs both yeses", () => {
  const out = scrubForTraining("Asha said text me on +91 98765 43210 or @asha_dev", ["Asha Rao"]);
  assert.ok(!/asha/i.test(out), out);
  assert.ok(!/98765/.test(out), out);
  assert.equal(bothShared(true, true), true);
  assert.equal(bothShared(true, null), false);
  assert.equal(bothShared(true, false), false);
});
