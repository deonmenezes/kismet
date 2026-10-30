// The public profile (what people their agent recommends them to may read) and the no-dashes rule for Kismet's texts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicAbout } from "./about.ts";
import { noDashes } from "./copy.ts";

const linda = {
  bio: "Bookworm and trail runner, find me on telegram @linda_reads",
  lookingFor: ["romance", "friends"],
  interests: ["books", "hiking", "food", "AI"],
  // Private fields a profile row also has: none may come back.
  telegram: "linda_reads", gender: "woman", interestedIn: "men", relStatus: "single", openness: "monogamous", area: "Mandrem",
};

test("public about: own answers only, contacts stripped, nothing private", () => {
  const a = publicAbout(linda, "romance");
  assert.deepEqual(Object.keys(a).sort(), ["bio", "interests", "lookingFor"]);
  assert.doesNotMatch(a.bio, /linda_reads|@/);
  assert.match(a.bio, /Bookworm and trail runner/);
  assert.deepEqual(a.interests, ["books", "hiking", "food", "AI"]);
  const all = JSON.stringify(a);
  for (const secret of ["woman", "men", "single", "monogamous", "Mandrem"]) assert.ok(!all.includes(`"${secret}"`), secret);
});

test("public about: romance shows only on a romance date", () => {
  assert.deepEqual(publicAbout(linda, "romance").lookingFor, ["Romance", "Friends"]);
  assert.deepEqual(publicAbout(linda, "friendly").lookingFor, ["Friends"]);
  assert.deepEqual(publicAbout({ ...linda, bio: "" }, null).lookingFor, ["Friends"]);
});

test("public about: long bios are cut and interests capped", () => {
  const a = publicAbout({ bio: "x".repeat(900), lookingFor: [], interests: Array.from({ length: 20 }, (_, i) => `i${i}`) }, null);
  assert.equal(a.bio.length, 300);
  assert.equal(a.interests.length, 8);
});

test("no dashes: em and en dashes become commas, ranges keep a hyphen", () => {
  assert.equal(noDashes("Linda loves books — and trails."), "Linda loves books, and trails.");
  assert.equal(noDashes("Free 10–12 or 3 – 5 pm"), "Free 10-12 or 3-5 pm");
  assert.equal(noDashes("1–2–3"), "1-2-3");
  assert.equal(noDashes("Top 3 — 2 of them surf"), "Top 3, 2 of them surf");
  assert.equal(noDashes("Great match —"), "Great match");
  assert.equal(noDashes("Line one\n— item two"), "Line one\nitem two");
  assert.equal(noDashes("Hi —\n\nBye"), "Hi\n\nBye");
  assert.equal(noDashes("x —:"), "x:");
  assert.equal(noDashes("Sunrise surf—then chai"), "Sunrise surf, then chai");
  assert.equal(noDashes("Great match —!"), "Great match!");
  assert.equal(noDashes("— hi"), "hi");
  assert.equal(noDashes("plain - hyphen stays"), "plain - hyphen stays");
});
