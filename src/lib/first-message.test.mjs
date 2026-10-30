// Run: npm test. Words typed before signing in (lib/first-message.ts) and leaving the sign-in page (QA6 Q6-M1).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const { firstMessage } = await import("./first-message.ts");
beforeEach(() => store.clear());

test("leaving the sign-in page without signing in: the landing page takes the words back, once", () => {
  firstMessage.set("someone kind who loves hiking");
  assert.equal(firstMessage.takeBack(), null, "not before they leave");
  firstMessage.leftSignIn(false);
  assert.equal(firstMessage.takeBack(), "someone kind who loves hiking");
  assert.equal(firstMessage.takeBack(), null);
  assert.equal(firstMessage.get(), null);
});

test("leaving after signing in: never marked back, so the landing page doesn't restore them; the chat still gets them", () => {
  firstMessage.set("hello");
  firstMessage.leftSignIn(true);
  assert.equal(firstMessage.takeBack(), null);
  assert.equal(firstMessage.get(), "hello");
});

test("nothing typed: leaving marks nothing", () => {
  firstMessage.leftSignIn(false);
  assert.equal(firstMessage.takeBack(), null);
  assert.equal(store.size, 0);
});

test("the sign-in page marks back in its unmount cleanup (the browser's Back unmounts it before any popstate listener of its own runs)", () => {
  const src = readFileSync(new URL("../components/sign-in-page.tsx", import.meta.url), "utf8");
  assert.match(src, /return \(\) => \{[^}]*clearTimeout\(t\);[\s\S]*?firstMessage\.leftSignIn\(lockedRef\.current\);\s*\};\s*\}, \[\]\);/);
  assert.doesNotMatch(src, /addEventListener\("popstate"/);
  // The lock is known at once, not one effect later: "You're in" may navigate away before effects run.
  assert.match(src, /const onLock = useCallback\(\(v: boolean\) => \{ lockedRef\.current = v; setLocked\(v\); \}, \[\]\);/);
  const signIn = readFileSync(new URL("../components/sign-in.tsx", import.meta.url), "utf8");
  assert.match(signIn, /setStep\("done"\);\s*onLock\?\.\(true\);[^\n]*\n\s*setTimeout\(\(\) => \{\s*router\.replace\(next\);/);
});

test("QA8 L1: \"your first message comes back once you're set up\" only beside the step counter, never after \"No, I'm not at Edge City\"", async () => {
  const { signupProgress } = await import("./text/parse.ts");
  // Signing up but told "No, I'm not": no step counter (the waitlist), and nobody is set up.
  for (const at of ["consent", "interview", "confirm"]) assert.equal(signupProgress({ edgeCity: false }, at), null, at);
  assert.ok(signupProgress({ edgeCity: true }, "interview"));
  const src = readFileSync(new URL("../components/kismet-chat.tsx", import.meta.url), "utf8");
  const promise = /Your first message comes back here once you&apos;re set up\./g;
  assert.equal(src.match(promise)?.length, 1, "said in one place only");
  // ...and that place is inside the {view?.progress && (...)} step line.
  const step = src.indexOf("{view?.progress && (");
  const end = src.indexOf(")}", src.indexOf("</p>", step));
  const at = src.search(promise);
  assert.ok(step > 0 && at > step && at < end, "the promise sits inside the step line");
});
