// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSeePhotos, isMutual, isRecommendation, matchView, mySide, recommendationView, runningStarted, visiblePhoto } from "./secret.ts";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const yes = { score: 8, meet: true, reason: "MY-REASON-A loves surfing too", bestLine: "BEST-LINE", suggestedMeetup: "Sunset walk" };
const noB = { score: 3, meet: false, reason: "THEIR-REASON-B not a fit", bestLine: "B-LINE", suggestedMeetup: "B-MEETUP" };
const yesB = { ...noB, score: 9, meet: true, reason: "THEIR-REASON-B keen" };
const date = (over = {}) => ({
  id: "d0000000-0000-4000-8000-000000000003", aId: A, bId: B, mode: "romance", status: "done",
  transcript: [{ speaker: "a", text: "hi from A's agent" }, { speaker: "b", text: "hi from B's agent" }],
  verdictA: yes, verdictB: noB, decisionA: null, decisionB: null, matchedAt: null, createdAt: "2026-10-18T10:00:00.000Z", ...over,
});
const person = { name: "Bee", summary: "builds tools", interests: ["AI", "Surf"] };

test("only a resident whose own agent said meet is told about the date", () => {
  const d = date();
  assert.equal(isRecommendation(d, A), true);
  assert.equal(isRecommendation(d, B), false); // B's agent said no: B never hears of it
  assert.equal(isRecommendation(date({ status: "running", verdictA: null, verdictB: null }), A), false);
});

test("a recommendation carries only my own agent's view: never theirs, no transcript, no kind, no decisions", () => {
  const r = recommendationView(date({ verdictB: yesB, decisionB: "meet" }), A, person, ["AI"]);
  assert.deepEqual(Object.keys(r).sort(), ["createdAt", "dateId", "interests", "myAgent", "name", "sharedInterests", "summary"]);
  assert.deepEqual(r.myAgent, { score: 8, reason: yes.reason, suggestedMeetup: "Sunset walk" });
  const text = JSON.stringify(r);
  for (const leak of ["THEIR-REASON", "B-LINE", "B-MEETUP", "BEST-LINE", "hi from", "romance", "meet\"", "decision", "theirs"]) assert.ok(!text.includes(leak), leak);
});

test("non-mutual: A says yes, B's agent said no; B learns nothing, A sees nothing change, no handles", () => {
  const after = date({ decisionA: "meet" });
  assert.equal(isMutual(after), false);
  assert.equal(isRecommendation(after, A), false); // answered: gone from A's list, no waiting state
  assert.equal(isRecommendation(after, B), false);
  // Whatever B's agent or B does, A's view is identical: nothing to show.
  for (const other of [{ decisionB: null }, { decisionB: "pass" }, { verdictB: yesB, decisionB: "pass" }, { verdictB: yesB, decisionB: null }]) {
    const d = date({ decisionA: "meet", ...other });
    assert.equal(isMutual(d), false);
    assert.equal(isRecommendation(d, A), false);
  }
  // Both agents recommended, A said yes, B said no: still never mutual, neither is told.
  const declined = date({ verdictB: yesB, decisionA: "meet", decisionB: "pass" });
  assert.deepEqual([isMutual(declined), isRecommendation(declined, A), isRecommendation(declined, B)], [false, false, false]);
  // B's open recommendation does not depend on A's answer either.
  assert.equal(isRecommendation(date({ verdictB: yesB, decisionA: "pass" }), B), true);
  assert.equal(isRecommendation(date({ verdictB: yesB, decisionA: "meet" }), B), true);
});

test("mutual: both agents recommended and both humans said yes; revealed to both alike", () => {
  const d = date({ verdictB: yesB, decisionA: "meet", decisionB: "meet", matchedAt: "2026-10-18T11:00:00.000Z" });
  assert.equal(isMutual(d), true);
  const forA = matchView(d, A, { name: "Bee", agentName: "Bee's agent", telegram: "bee_tg", romance: { relationshipStatus: "Single", openTo: "Polyamorous" } }, "Ay's agent");
  const forB = matchView(d, B, { name: "Ay", agentName: "Ay's agent", telegram: "ay_tg" }, "Bee's agent");
  assert.equal(forA.link, "https://t.me/bee_tg");
  assert.equal(forB.telegram, "ay_tg");
  // No Telegram (WhatsApp or app-only contact): no "@" handle and never a bare https://t.me/ link.
  const none = matchView(d, A, { name: "Bee", agentName: "Bee's agent", telegram: "" }, "Ay's agent");
  assert.equal(none.telegram, "");
  assert.equal(none.link, null);
  assert.deepEqual(forA.transcript.map((t) => t.who), ["mine", "theirs"]);
  assert.deepEqual(forB.transcript.map((t) => t.who), ["theirs", "mine"]);
  // Relationship status and openness stay private even to a match (even if a caller passes them).
  assert.equal("relationshipStatus" in forA, false);
  assert.equal("openTo" in forA, false);
  assert.deepEqual(mySide(d, B), { verdict: yesB, decision: "meet", otherId: A });
});

test("running dates: a count of the ones I started, never who with, never the ones others started with me", () => {
  const dates = [date({ status: "running" }), date({ status: "running", aId: B, bId: A }), date()];
  assert.equal(runningStarted(dates, A), 1);
  assert.equal(runningStarted(dates, B), 1);
});

test("a card or chat avatar shows someone's photo only when the viewer may see it", () => {
  const C = "c0000000-0000-4000-8000-000000000004";
  const photos = new Map([[B, [{ url: "/api/photos/b1" }, { url: "/api/photos/b2" }]], [A, [{ url: "/api/photos/a1" }]], [C, [{ url: "/api/photos/c1" }]]]);
  const rec = date(); // A's agent recommends B; B's agent said no
  // An open recommendation: the first photo, and only once the viewer's account sees photos at all (views.ts seesPhotos).
  assert.equal(visiblePhoto([rec], A, B, photos, true), "/api/photos/b1");
  assert.equal(visiblePhoto([rec], A, B, photos, false), null);
  // The other side was never told about this date: no photo of A for B.
  assert.equal(canSeePhotos([rec], B, A), false);
  assert.equal(visiblePhoto([rec], B, A, photos, true), null);
  // Someone with no date with the viewer, or no photo, shows the initial avatar.
  assert.equal(visiblePhoto([rec], A, C, photos, true), null);
  assert.equal(visiblePhoto([rec], A, B, new Map(), true), null);
  // Answered (pass, or a yes not yet matched) is gone; a running date is not a recommendation.
  assert.equal(visiblePhoto([date({ decisionA: "pass" })], A, B, photos, true), null);
  assert.equal(visiblePhoto([date({ decisionA: "meet" })], A, B, photos, true), null);
  assert.equal(visiblePhoto([date({ status: "running", verdictA: null, verdictB: null })], A, B, photos, true), null);
  // A held weekly drop not yet released to A shows nothing.
  assert.equal(visiblePhoto([date({ held: true })], A, B, photos, true), null);
  // An open match: both see each other; a closed one (unmatch, block, report) shows no photo to either.
  const match = date({ verdictB: yesB, decisionA: "meet", decisionB: "meet", matchedAt: "2026-10-18T11:00:00.000Z" });
  assert.equal(visiblePhoto([match], A, B, photos, true), "/api/photos/b1");
  assert.equal(visiblePhoto([match], B, A, photos, true), "/api/photos/a1");
  const closed = { ...match, chatClosedAt: "2026-10-19T09:00:00.000Z" };
  assert.equal(visiblePhoto([closed], A, B, photos, true), null);
  assert.equal(visiblePhoto([closed], B, A, photos, true), null);
  // Another pair's date never opens a photo of someone else.
  assert.equal(visiblePhoto([date({ bId: C })], A, B, photos, true), null);
});
