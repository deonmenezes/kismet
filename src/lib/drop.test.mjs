// Run: npm test. The weekly drop (lib/drop.ts): drop times in India time (weekly, the extra last-Friday drop, nothing
// after the event and nothing held after its last drop), picking the single best eligible match from the person's OWN
// agent's side out of a rolling pool, one drop per person per drop time (retries, double fires, crashed runs, stale
// claims), pushes right after each release within the time budget, recommendations held until the drop, the date plan
// (validation, fallback, rotation, no private fields) and the plan confirmed only after a mutual yes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catchUpDrop, confirmPlan, currentDrop, DROP, DROP_EARLY_MS, dropAt, dropLabel, dropSchedule, dropTimes, dropWhen, EVENT_END, eventEndAt, EXTRA_DROPS, extraDropDue,
  heldNow, holding, HOLDS_LIFTED, HOLDS_LIFTED_AT, nextDropAt, parsePlan, pickDrop, planFor, planPrompt, planSlot, planText, POOL_DAYS, rollForward, runDrop, safeLine, SCHEDULE, seedOf,
  templatePlan, unheldPushDue, UNHELD_PUSH_MS, venuesFor, weekKey, weeklyDropOn, WHY_WORDS,
} from "./drop.ts";
import { canSeePhotos, isNewSince, isRecommendation } from "./secret.ts";
import { EDGE_CITY_VENUES } from "./venues.ts";
import { howItWorks, weeklyHow } from "./copy.ts";
import { agentScript, agentScriptCore } from "./agent-script.ts";
import { parseProfile } from "./validate.ts";
import { pushNext } from "./text/agent.ts";
import { isQuietHours } from "./text/parse.ts";
import { memoryAdapter, memoryStore } from "./text/memory.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const V = (meet, score = 8) => ({ score, meet, reason: "Both build with AI.", bestLine: "line", suggestedMeetup: "chai" });
const date = (id, over = {}) => ({
  id, aId: A, bId: B, mode: "friendly", status: "done", transcript: [], verdictA: V(true), verdictB: V(true), decisionA: null, decisionB: null,
  matchedAt: null, finishedAt: "2026-10-18T10:00:00.000Z", chatClosedAt: null, createdAt: "2026-10-18T09:59:00.000Z",
  held: true, dropAAt: null, dropBAt: null, ...over,
});

// ---- Drop times, the event's end, the week boundary --------------------------------------------------

const T = (s) => new Date(s);
const NO_EVENT = { ...SCHEDULE, extra: [], eventEnd: null };

test("drop time: Wednesday 19:00 India time is 13:30 UTC; due from an hour early (Hobby cron hour) until the next drop's cutoff", () => {
  assert.deepEqual(DROP, { weekday: 3, hour: 19, minute: 0, timeZone: "Asia/Kolkata" });
  assert.equal(dropLabel(T("2026-10-21T06:00:00Z")), "Wednesday 21 Oct at 7 pm India time");
  const wed = T("2026-10-21T13:30:00Z");
  assert.equal(dropAt(T("2026-10-19T00:00:00Z")).toISOString(), wed.toISOString()); // from Monday
  // 17:59 India time: Wednesday's drop is not due yet; last week's is still in its catch-up window.
  assert.equal(currentDrop(T("2026-10-21T12:29:00Z")).key, "2026-10-14T13:30:00.000Z");
  assert.equal(nextDropAt(T("2026-10-21T12:29:00Z")).toISOString(), wed.toISOString());
  // 18:30 India time: the cron's hour has started.
  const d = currentDrop(T("2026-10-21T13:00:00Z"));
  assert.equal(d.key, wed.toISOString());
  assert.equal(d.week, "2026-W43");
  assert.equal(d.to.toISOString(), new Date(wed.getTime() - DROP_EARLY_MS).toISOString());
  assert.equal(d.from.toISOString(), new Date(d.to.getTime() - POOL_DAYS * 86_400_000).toISOString());
  assert.equal(nextDropAt(T("2026-10-21T13:00:00Z")).toISOString(), "2026-10-28T13:30:00.000Z");
  // Monday 26 Oct 00:10 India time (still Sunday in UTC): still Wednesday's drop, until the next cutoff.
  assert.equal(currentDrop(T("2026-10-25T18:40:00Z")).key, wed.toISOString());
});

test("drop label: built from the real next drop, never a fixed weekday (the last drop is Saturday 31 Oct, the event ends 1 Nov)", () => {
  assert.equal(dropWhen(T("2026-10-30T13:30:00Z")), "Friday 30 Oct at 7 pm India time");
  // Wednesday 28 Oct, 22:30 India time: Wednesday's drop is out; the only one left is Friday's, and it is the last.
  // Thursday 29 Oct: tonight's 9:30 pm extra drop is next, and it is not the last.
  const thuDrop = dropSchedule(T("2026-10-29T06:00:00Z"));
  assert.match(thuDrop.label, /^Thursday 29 Oct/);
  assert.equal(thuDrop.last, false);
  // Friday 11:30 India time: the 4 pm extra drop is next, and it is not the last.
  const fri4 = dropSchedule(T("2026-10-30T06:00:00Z"));
  assert.match(fri4.label, /^Friday 30 Oct at 4 pm/);
  assert.equal(fri4.last, false);
  // Friday 17:59 India time: Friday's 7 pm drop is next, and it is no longer the last.
  const fri7 = dropSchedule(T("2026-10-30T12:00:00Z"));
  assert.deepEqual([fri7.state, fri7.at.toISOString(), fri7.last], ["upcoming", "2026-10-30T13:30:00.000Z", false]);
  assert.equal(fri7.label, "Friday 30 Oct at 7 pm India time");
  assert.equal(dropLabel(T("2026-10-30T12:29:00Z")), "Friday 30 Oct at 7 pm India time");
  // Friday 18:00 India time on (the 7 pm drop's cron hour, then all night): Saturday's 10 am drop is next, and the last.
  for (const at of ["2026-10-30T12:30:00Z", "2026-10-30T13:30:00Z", "2026-10-30T14:30:00Z", "2026-10-30T17:30:00Z", "2026-10-31T03:29:00Z"]) {
    const sat = dropSchedule(T(at));
    assert.equal(sat.state, "upcoming", at);
    assert.equal(sat.at.toISOString(), "2026-10-31T04:30:00.000Z");
    assert.equal(sat.last, true);
    assert.equal(sat.label, "Saturday 31 Oct at 10 am India time (the last drop)");
    assert.equal(dropLabel(T(at)), "Saturday 31 Oct at 10 am India time (the last drop)");
    assert.equal(sat.text, "The next drop is Saturday 31 Oct at 10 am India time, and it is the last one (the event ends 1 Nov).");
    assert.ok(!/Wednesdays?|Friday|7 pm/.test(sat.label + sat.text));
  }
  assert.equal(dropWhen(T("2026-10-31T04:30:00Z")), "Saturday 31 Oct at 10 am India time");
  // Earlier in the event a Wednesday drop is next, and it is not the last.
  const mon = dropSchedule(T("2026-10-26T06:00:00Z"));
  assert.deepEqual([mon.label, mon.last], ["Wednesday 28 Oct at 7 pm India time", false]);
  assert.equal(mon.text, "The next drop is Wednesday 28 Oct at 7 pm India time.");
  // During: Saturday 09:00-10:59 India time, the last drop is going out.
  for (const at of ["2026-10-31T03:30:00Z", "2026-10-31T04:30:00Z", "2026-10-31T05:29:00Z"]) {
    const s = dropSchedule(T(at));
    assert.equal(s.state, "now", at);
    assert.equal(s.label, "any minute now (the last drop is going out)");
    assert.equal(s.text, "The last drop is going out now (Saturday 31 Oct at 10 am India time) (the event ends 1 Nov).");
  }
  // After: Saturday 11:00 India time until the event ends, no more drops.
  for (const at of ["2026-10-31T05:30:00Z", "2026-10-31T12:00:00Z", "2026-11-01T18:29:00Z"]) {
    const s = dropSchedule(T(at));
    assert.equal(s.state, "over", at);
    assert.equal(s.at, null);
    assert.equal(s.label, "no more drops (the last one was Saturday 31 Oct at 10 am India time)");
    assert.equal(s.text, "There are no more drops (the last one was Saturday 31 Oct at 10 am India time). New recommendations now arrive as soon as they are ready, until the event ends on 1 Nov.");
  }
  // After 1 Nov: the event is over.
  for (const at of ["2026-11-01T18:30:00Z", "2026-11-05T06:00:00Z", "2027-01-10T06:00:00Z"]) {
    const s = dropSchedule(T(at));
    assert.deepEqual([s.state, s.label, s.text], ["over", "no more drops (the event is over)", "There are no more drops: the event ended on 1 Nov."], at);
  }
  // Without an event end, drops go on: never "last".
  assert.deepEqual([dropSchedule(T("2026-11-10T00:00:00Z"), NO_EVENT).label, dropSchedule(T("2026-11-10T00:00:00Z"), NO_EVENT).last], ["Wednesday 11 Nov at 7 pm India time", false]);
});

test("drop copy: MCP how_it_works, llms.txt / llms-full.txt and the cards say the real next drop, and no more drops after the last", () => {
  const at = (s, f) => {
    const real = Date;
    globalThis.Date = class extends real { constructor(...a) { super(...(a.length ? a : [s])); } static now() { return new real(s).getTime(); } };
    try { return f(); } finally { globalThis.Date = real; }
  };
  const before = dropSchedule(T("2026-10-30T17:30:00Z")); // Friday 23:00 India time, after the 7 pm drop
  const hiw = howItWorks(before);
  assert.match(hiw.weekly, /The next drop is Saturday 31 Oct at 10 am India time, and it is the last one \(the event ends 1 Nov\)\./);
  assert.ok(!/Wednesday|once a week|7 pm/.test(JSON.stringify(hiw)));
  assert.deepEqual(Object.keys(hiw), ["name", "formerly", "tagline", "where", "who", "what", "join", "board", "weekly", "privacy"]);
  assert.equal(howItWorks(dropSchedule(T("2026-10-31T06:00:00Z"))).weekly, "Drops: There are no more drops (the last one was Saturday 31 Oct at 10 am India time). New recommendations now arrive as soon as they are ready, until the event ends on 1 Nov.");
  assert.equal(weeklyHow(before.label), "One person per drop, with a full meetup plan (when, where, what). Your next Kismet arrives Saturday 31 Oct at 10 am India time (the last drop).");
  // The served scripts are built per request from the clock.
  for (const script of [agentScriptCore, agentScript]) {
    const fri = at("2026-10-30T17:30:00Z", () => script("https://k.test"));
    assert.ok(fri.includes("Saturday 31 Oct at 10 am India time, and it is the last one"), script.name);
    assert.ok(!/Wednesdays|Friday 30 Oct at 7 pm/.test(fri), script.name);
    const sat = at("2026-10-31T06:00:00Z", () => script("https://k.test"));
    assert.ok(sat.includes("There are no more drops"), script.name);
    const later = at("2026-11-03T06:00:00Z", () => script("https://k.test"));
    assert.ok(later.includes("There are no more drops: the event ended on 1 Nov."), script.name);
  }
});

test("drop week: the ISO week of the India date, not the UTC date; across the year boundary too", () => {
  assert.equal(weekKey(T("2026-10-25T18:20:00Z")), "2026-W43"); // Sunday 23:50 India time
  assert.equal(weekKey(T("2026-10-25T18:40:00Z")), "2026-W44"); // Monday 00:10 India time, Sunday in UTC
  assert.equal(weekKey(T("2026-12-31T12:00:00Z")), "2026-W53");
  assert.equal(weekKey(T("2027-01-04T12:00:00Z")), "2027-W01");
});

test("drop time in another zone, across a DST change: the wall-clock time stays 19:00", () => {
  const cfg = { weekday: 3, hour: 19, minute: 0, timeZone: "Europe/London" };
  assert.equal(dropAt(T("2026-10-21T12:00:00Z"), cfg).toISOString(), "2026-10-21T18:00:00.000Z"); // BST
  assert.equal(dropAt(T("2026-10-28T12:00:00Z"), cfg).toISOString(), "2026-10-28T19:00:00.000Z"); // GMT
});

test("event end: extra drops on the last days (the last on Saturday 10 am), nothing after the event, nothing held after the last drop", () => {
  assert.deepEqual(EXTRA_DROPS, ["2026-10-29T21:30", "2026-10-30T16:00", "2026-10-30T19:00", "2026-10-31T10:00"]);
  assert.equal(EVENT_END, "2026-11-01");
  assert.equal(eventEndAt().toISOString(), "2026-11-01T18:30:00.000Z"); // midnight after 1 Nov, India time
  // The Friday cron acts only on the extra drop.
  assert.equal(extraDropDue(T("2026-10-30T13:00:00Z")), true);
  assert.equal(currentDrop(T("2026-10-30T13:00:00Z")).key, "2026-10-30T13:30:00.000Z");
  assert.equal(extraDropDue(T("2026-10-23T13:00:00Z")), false); // an ordinary Friday
  assert.equal(extraDropDue(T("2026-10-28T13:00:00Z")), false); // Wednesday's drop
  assert.equal(currentDrop(T("2026-10-29T03:00:00Z")).key, "2026-10-28T13:30:00.000Z"); // daily catch-up
  // Friday's drop is caught up until Saturday's cutoff (09:00 India time), then Saturday's until the event ends; then
  // there is none (no drop on 4 Nov).
  assert.equal(currentDrop(T("2026-10-31T03:00:00Z")).key, "2026-10-30T13:30:00.000Z");
  assert.equal(currentDrop(T("2026-10-31T03:29:00Z")).key, "2026-10-30T13:30:00.000Z");
  assert.equal(currentDrop(T("2026-10-31T03:30:00Z")).key, "2026-10-31T04:30:00.000Z");
  assert.equal(currentDrop(T("2026-11-01T18:29:00Z")).key, "2026-10-31T04:30:00.000Z");
  assert.equal(currentDrop(T("2026-11-01T19:00:00Z")), null);
  assert.equal(currentDrop(T("2026-11-04T13:30:00Z")), null);
  assert.ok(dropTimes(T("2026-11-04T13:30:00Z")).every((d) => d.getTime() <= eventEndAt().getTime()));
  // Holding stops once the last drop's cron hour is over: the event's last two days are not silent.
  assert.equal(holding(T("2026-10-20T06:00:00Z")), true);
  assert.equal(holding(T("2026-10-30T14:31:00Z")), true); // after Friday's drop: held for Saturday's
  assert.equal(holding(T("2026-10-31T05:29:00Z")), true); // the last drop is going out
  assert.equal(holding(T("2026-10-31T05:30:00Z")), false);
  assert.equal(nextDropAt(T("2026-10-30T14:00:00Z")).toISOString(), "2026-10-31T04:30:00.000Z");
  assert.equal(nextDropAt(T("2026-10-31T04:00:00Z")), null);
  // Generic: without an event end the weekly drop goes on and keeps holding.
  assert.equal(holding(T("2026-11-10T00:00:00Z"), NO_EVENT), true);
  assert.equal(currentDrop(T("2026-11-04T13:00:00Z"), NO_EVENT).key, "2026-11-04T13:30:00.000Z");
});

test("un-hold push: due only right after the last drop stops holding, and vercel.json's Saturday crons land in their windows", async () => {
  const { readFileSync } = await import("node:fs");
  const { crons } = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const cron = (path) => crons.find((c) => c.path === path)?.schedule;
  assert.equal(cron("/api/text/unheld"), "0 6 * * 6");
  assert.equal(cron("/api/text/drop-extra"), "0 5 * * 6");
  // Hobby fires a cron anywhere in its hour.
  const hour = (iso) => Array.from({ length: 60 }, (_, m) => new Date(T(iso).getTime() + m * 60_000));
  // drop-extra, Sat 31 Oct 05:00-05:59 UTC (10:30-11:29 India time): the backup for the 10:00 call by hand, never
  // before the drop's time, and the Saturday drop is due all hour.
  for (const at of hour("2026-10-31T05:00:00Z")) {
    assert.equal(extraDropDue(at), true, at.toISOString());
    assert.equal(currentDrop(at).key, "2026-10-31T04:30:00.000Z");
  }
  // unheld, Sat 31 Oct 06:00-06:59 UTC (11:30-12:29 India time): after holding stopped (11:00), so the un-held dates go
  // out before lunch, not at Sunday's 08:30 push.
  for (const at of hour("2026-10-31T06:00:00Z")) {
    assert.equal(holding(at), false);
    assert.equal(unheldPushDue(at), true, at.toISOString());
  }
  // Friday night is still holding (for Saturday's drop): the un-hold push is not due then, nor in the drop's own hours.
  for (const at of [...hour("2026-10-30T15:00:00Z"), ...hour("2026-10-31T04:00:00Z"), ...hour("2026-10-31T05:00:00Z").slice(0, 30)]) {
    assert.equal(unheldPushDue(at), false, at.toISOString());
  }
  // Edges: holding stops at Sat 05:30Z (11:00 India time), the push stays due for UNHELD_PUSH_MS.
  assert.equal(UNHELD_PUSH_MS, 3 * 60 * 60_000);
  assert.equal(unheldPushDue(T("2026-10-31T05:29:59Z")), false);
  assert.equal(unheldPushDue(T("2026-10-31T05:30:00Z")), true);
  assert.equal(unheldPushDue(T("2026-10-31T08:29:59Z")), true);
  assert.equal(unheldPushDue(T("2026-10-31T08:30:00Z")), false);
  // Every other Saturday the crons do nothing: before the event's last drop (holding) and after it (long un-held).
  for (const iso of ["2026-10-17T06:30:00Z", "2026-10-24T06:30:00Z", "2026-11-07T06:30:00Z", "2026-11-14T06:30:00Z"]) {
    assert.equal(unheldPushDue(T(iso)), false, iso);
  }
  for (const iso of ["2026-10-17T05:30:00Z", "2026-10-24T05:30:00Z", "2026-11-07T05:30:00Z"]) assert.equal(extraDropDue(T(iso)), false, iso);
  // Nothing un-held, nothing to push: without an event end, or with weekly mode off.
  assert.equal(unheldPushDue(T("2026-10-31T06:30:00Z"), NO_EVENT), false);
  assert.equal(unheldPushDue(T("2026-10-31T06:30:00Z"), SCHEDULE, { KISMET_WEEKLY_DROP: "off" }), false);
});

test("Saturday 31 Oct 10:00 drop: due from its 09:00 cutoff, the call at 10:00-10:05 releases it, pool up to the cutoff", () => {
  const sat = T("2026-10-31T04:30:00Z");
  for (let m = 0; m <= 5; m++) {
    const at = new Date(sat.getTime() + m * 60_000); // 10:00-10:05 India time
    assert.equal(extraDropDue(at), true);
    const d = currentDrop(at);
    assert.equal(d.key, "2026-10-31T04:30:00.000Z");
    assert.equal(d.to.toISOString(), "2026-10-31T03:30:00.000Z"); // dates finished by 09:00 India time
    assert.equal(d.from.toISOString(), new Date(d.to.getTime() - POOL_DAYS * 86_400_000).toISOString());
    assert.equal(catchUpDrop(at).key, d.key);
  }
  // The late joiners' dates (finished after Friday's 18:00 cutoff, before Saturday's) are in it; Friday's pool ended at 18:00.
  const d = currentDrop(sat);
  const lateJoiner = date("late", { finishedAt: "2026-10-30T13:45:00.000Z", held: false, shownAAt: "2026-10-30T15:00:00.000Z" });
  assert.equal(pickDrop(A, [{ date: lateJoiner, score: 0.5, visible: true }], d).id, "late", "already visible: the drop adds its plan");
  assert.equal(pickDrop(A, [{ date: lateJoiner, score: 0.5, visible: true }], currentDrop(T("2026-10-30T13:30:00Z"))), null, "not in Friday's");
  assert.equal(pickDrop(A, [{ date: date("after-cutoff", { finishedAt: "2026-10-31T03:31:00.000Z" }), score: 1, visible: true }], d), null);
  // Someone who got a person at an earlier drop gets a new one only from a date not released to them yet.
  const fri = date("fri", { finishedAt: "2026-10-29T10:00:00.000Z", dropAAt: "2026-10-30T13:30:00.000Z" });
  assert.equal(pickDrop(A, [{ date: fri, score: 1, visible: true }], d), null);
  assert.equal(pickDrop(A, [{ date: fri, score: 1, visible: true }, { date: date("new", { bId: C, finishedAt: "2026-10-30T20:00:00.000Z" }), score: 0.2, visible: true }], d).id, "new");
  // Quiet hours (23:00-08:00 India time) never hold back the 10:00 pushes, nor the 10:30-11:29 backup or the un-hold push.
  for (const iso of ["2026-10-31T04:30:00Z", "2026-10-31T04:35:00Z", "2026-10-31T05:00:00Z", "2026-10-31T06:59:00Z"]) assert.equal(isQuietHours(T(iso)), false, iso);
  assert.equal(isQuietHours(T("2026-10-31T02:29:00Z")), true); // 07:59
  // The 08:30 daily job fires anywhere until 09:29 India time: after 09:00 Saturday's drop is due, but the job's
  // catch-up never sends it before 10:00; until 09:00 it still catches up Friday's.
  assert.equal(catchUpDrop(T("2026-10-31T03:10:00Z")).key, "2026-10-30T13:30:00.000Z");
  for (const iso of ["2026-10-31T03:30:00Z", "2026-10-31T03:59:00Z", "2026-10-31T04:29:59Z"]) {
    assert.equal(currentDrop(T(iso)).key, "2026-10-31T04:30:00.000Z");
    assert.equal(catchUpDrop(T(iso)), null, iso);
  }
  // An ordinary weekly drop is unchanged: its catch-up comes the next morning, after its time.
  assert.equal(catchUpDrop(T("2026-10-22T03:00:00Z")).key, "2026-10-21T13:30:00.000Z");
});

test("visible recommendations stay visible: adding Saturday's drop never re-hides what was un-held after Friday's 7 pm drop", () => {
  assert.equal(HOLDS_LIFTED, "2026-10-30T20:00");
  assert.equal(HOLDS_LIFTED_AT, "2026-10-30T14:30:00.000Z"); // the minute holding stopped after Friday's drop
  // In production nothing was held from Fri 20:00 India time until this deploy (the old schedule): the gap.
  const OLD = { ...SCHEDULE, extra: ["2026-10-29T21:30", "2026-10-30T16:00", "2026-10-30T19:00"] };
  assert.equal(holding(T("2026-10-30T14:30:00Z"), OLD), false);
  assert.equal(holding(T("2026-10-30T17:30:00Z"), OLD), false);
  // Overnight (now held again for Saturday): Fri 23:30, Sat 03:00 and Sat 09:30 India time, and Sat 10:30.
  const night = ["2026-10-30T18:00:00Z", "2026-10-30T21:30:00Z", "2026-10-31T04:00:00Z", "2026-10-31T05:00:00Z"];
  for (const iso of night) assert.equal(holding(T(iso)), true, iso);
  const on = (iso) => holding(T(iso));
  // A late joiner's date that finished in Friday's 7 pm drop hour (held then, un-held at 20:00, never released or
  // marked shown, e.g. the person has not opened Kismet since): it stays a recommendation all night.
  const late = date("late", { finishedAt: "2026-10-30T13:45:00.000Z", held: true });
  // One that finished before Friday's drop and went to nobody (each person gets one per drop): the same.
  const leftover = date("leftover", { finishedAt: "2026-10-25T10:00:00.000Z", held: true });
  // One that finished in the gap: the store wrote held = false then.
  const gap = date("gap", { finishedAt: "2026-10-30T16:00:00.000Z", held: false });
  for (const iso of night) {
    for (const d of [late, leftover, gap]) {
      const seen = { ...d, held: heldNow(d.held, d.finishedAt, on(iso)) }; // as lib/db.ts toDate maps the row
      assert.equal(seen.held, false, `${d.id} ${iso}`);
      assert.equal(isRecommendation(seen, A), true, `${d.id} ${iso}`);
      assert.equal(isRecommendation(seen, B), true, `${d.id} ${iso}`);
      assert.equal(canSeePhotos([seen], A, B), true, `${d.id} ${iso}`);
    }
  }
  // Without the lift (as before this change) the late joiner's date would vanish overnight: what this guards against.
  assert.equal(isRecommendation({ ...late, held: heldNow(true, late.finishedAt, true, null) }, A), false);
  // New agent chats that finish after this deploy are held for Saturday's drop, as usual, until released or shown.
  const fresh = date("fresh", { finishedAt: "2026-10-30T19:00:00.000Z", held: true });
  for (const iso of night) {
    const seen = { ...fresh, held: heldNow(true, fresh.finishedAt, on(iso)) };
    assert.equal(seen.held, true, iso);
    assert.equal(isRecommendation(seen, A), false, iso);
    assert.equal(isRecommendation({ ...seen, dropAAt: "2026-10-31T04:31:00.000Z" }, A), true, "released to A");
    assert.equal(isRecommendation({ ...seen, dropAAt: "2026-10-31T04:31:00.000Z" }, B), false, "B waits for their own");
  }
  // After Saturday's drop hour nothing is held at all.
  assert.equal(heldNow(true, fresh.finishedAt, holding(T("2026-10-31T05:30:00Z"))), false);
  // The edge: finished at the minute holds lifted counts as lifted; a second later is held.
  assert.equal(heldNow(true, "2026-10-30T14:30:00.000Z", true), false);
  assert.equal(heldNow(true, "2026-10-30T14:30:01.000Z", true), true);
  // Not finished (no time): held while holding, as before.
  assert.equal(heldNow(true, null, true), true);
  assert.equal(heldNow(false, null, true), false);
});

test("weekly mode is on by default and off only with KISMET_WEEKLY_DROP=off (then nothing is held)", () => {
  assert.equal(weeklyDropOn({}), true);
  assert.equal(weeklyDropOn({ KISMET_WEEKLY_DROP: "on" }), true);
  assert.equal(weeklyDropOn({ KISMET_WEEKLY_DROP: " OFF " }), false);
  assert.equal(holding(T("2026-10-20T06:00:00Z"), SCHEDULE, { KISMET_WEEKLY_DROP: "off" }), false);
});

// ---- Holding recommendations until the drop -------------------------------------------------------

test("hold until the drop: a held recommendation is invisible (no card, no photos) until released to that side only", () => {
  const d = date("d1");
  assert.equal(isRecommendation(d, A), false);
  assert.equal(isRecommendation(d, B), false);
  assert.equal(canSeePhotos([d], A, B), false);
  const released = { ...d, dropAAt: "2026-10-21T13:30:00.000Z" };
  assert.equal(isRecommendation(released, A), true);
  assert.equal(canSeePhotos([released], A, B), true);
  assert.equal(isRecommendation(released, B), false, "the other side still waits for their own drop");
  assert.equal(canSeePhotos([released], B, A), false);
  // Agents polling with ?since= see the drop as new when it is released, not when its date finished.
  assert.equal(isNewSince(released, "2026-10-20T00:00:00.000Z", A), true);
  assert.equal(isNewSince(released, "2026-10-22T00:00:00.000Z", A), false);
  // Dates from before weekly mode (or with it off: the store maps held to false) keep working as before.
  assert.equal(isRecommendation({ ...d, held: false }, A), true);
  assert.equal(isRecommendation({ ...d, held: undefined, dropAAt: undefined, dropBAt: undefined }, B), true);
});

test("hold is per side: what A was shown while nothing was held never makes the date visible to B when holding resumes", () => {
  // Weekly mode off: A is shown the A-B recommendation (A's agent said meet). B's agent said meet too, but B was never
  // shown it. Weekly mode back on: A keeps seeing it; B must not (else B would learn A's agent's verdict).
  const d = date("ab", { shownAAt: "2026-10-22T10:00:00.000Z" });
  assert.equal(isRecommendation(d, A), true);
  assert.equal(isRecommendation(d, B), false);
  assert.equal(canSeePhotos([d], B, A), false);
  // B sees it only once it is released to B, or shown to B.
  assert.equal(isRecommendation({ ...d, dropBAt: "2026-10-28T13:30:00.000Z" }, B), true);
  assert.equal(isRecommendation({ ...d, shownBAt: "2026-10-22T11:00:00.000Z" }, B), true);
});

test("?since=: a drop is new when its person first saw it (released, or shown earlier as a recommendation they had)", () => {
  const legacy = date("legacy", { held: false, shownAAt: "2026-10-19T09:00:00.000Z", dropAAt: "2026-10-21T13:30:00.000Z" });
  assert.equal(isNewSince(legacy, "2026-10-20T00:00:00.000Z", A), false, "already seen on 19 Oct");
  assert.equal(isNewSince(legacy, "2026-10-18T12:00:00.000Z", A), true);
  const fresh = date("fresh", { dropAAt: "2026-10-21T13:30:00.000Z", shownAAt: "2026-10-21T13:31:00.000Z" });
  assert.equal(isNewSince(fresh, "2026-10-21T00:00:00.000Z", A), true);
  assert.equal(isNewSince(fresh, "2026-10-21T13:30:30.000Z", A), false);
});

// ---- Picking the drop -----------------------------------------------------------------------------

const W = currentDrop(T("2026-10-21T13:30:00Z")); // pool: finished in (23 Sep 12:30 UTC, 21 Oct 12:30 UTC]
const W2 = currentDrop(T("2026-10-28T13:30:00Z"));

test("drop selection: the single best eligible match from my own agent's side", () => {
  const cands = [
    { date: date("d-best", { bId: B }), score: 0.9, visible: true },
    { date: date("d-ok", { bId: C }), score: 0.7, visible: true },
  ];
  assert.equal(pickDrop(A, cands, W).id, "d-best");
  // The other side's verdict and answer never decide it: my agent said meet, theirs did not, they already said no.
  const secret = date("d-secret", { verdictB: V(false, 1), decisionB: "pass" });
  assert.equal(pickDrop(A, [{ date: secret, score: 0.6, visible: true }], W).id, "d-secret");
  // Ties: the most recent, then the id (the same pick on every retry).
  const t1 = date("d-t1", { finishedAt: "2026-10-19T10:00:00.000Z" });
  const t2 = date("d-t2", { finishedAt: "2026-10-20T10:00:00.000Z" });
  assert.equal(pickDrop(A, [{ date: t1, score: 0.5, visible: true }, { date: t2, score: 0.5, visible: true }], W).id, "d-t2");
});

test("drop selection skips decided, blocked / reported / banned (not visible), unmatched, unrecommended, released and expired dates", () => {
  const skip = [
    { date: date("decided", { decisionA: "pass" }), score: 1, visible: true },
    { date: date("blocked"), score: 1, visible: false },
    { date: date("unmatched", { chatClosedAt: "2026-10-19T00:00:00.000Z" }), score: 1, visible: true },
    { date: date("not-mine", { verdictA: V(false) }), score: 1, visible: true },
    { date: date("released", { dropAAt: "2026-10-14T13:30:00.000Z" }), score: 1, visible: true },
    { date: date("expired", { finishedAt: "2026-09-20T12:00:00.000Z" }), score: 1, visible: true }, // older than the pool
    { date: date("next-drop", { finishedAt: "2026-10-21T12:45:00.000Z" }), score: 1, visible: true }, // after the cutoff
    { date: date("running", { status: "running", finishedAt: null }), score: 1, visible: true },
  ];
  assert.equal(pickDrop(A, skip, W), null);
  const keep = { date: date("eligible", { bId: C }), score: 0.1, visible: true };
  assert.equal(pickDrop(A, [...skip, keep], W).id, "eligible");
  // The same date seen from B's side: B's own verdict and answer count.
  assert.equal(pickDrop(B, [{ date: date("b-side", { decisionB: "meet" }), score: 1, visible: true }], W), null);
});

test("rolling pool: a recommendation not picked one week comes round in the next drop (a yes is never stranded)", () => {
  // A's drop on 21 Oct is the A-B date and A says yes; B's own drop that week went to C (B's best).
  const ab = date("ab", { dropAAt: "2026-10-21T13:30:00.000Z", decisionA: "meet" });
  const cb = date("cb", { aId: C, bId: B, dropBAt: "2026-10-21T13:30:00.000Z", decisionB: "pass" });
  assert.equal(pickDrop(B, [{ date: ab, score: 0.6, visible: true }, { date: cb, score: 0.9, visible: true }], W2).id, "ab");
  // Older dates from earlier weeks stay in the pool too, within POOL_DAYS.
  assert.equal(pickDrop(A, [{ date: date("old", { finishedAt: "2026-10-01T10:00:00.000Z" }), score: 0.5, visible: true }], W).id, "old");
  // The first drop after the switch may pick a recommendation that was already showing (not held): it only adds a plan.
  assert.equal(pickDrop(A, [{ date: date("shown", { held: false }), score: 0.5, visible: true }], W).id, "shown");
});

// ---- Releasing: one drop per person per drop time -------------------------------------------------------

function fakeIO({ pick = () => "d1", failRelease = 0, failPush = 0, clock = null, modelMs = 0, onPlan = null } = {}) {
  const claims = new Map();
  const released = new Set();
  const gone = new Set();
  const decided = new Set(); // "<user>:<date>": answered by that person
  const events = [];
  const calls = { pick: 0, plan: 0, log: 0 };
  let releaseFails = failRelease;
  let pushFails = failPush;
  const io = {
    claim: async (u, key) => claims.get(`${u}:${key}`),
    insertClaim: async (u, key, dateId) => {
      await new Promise((r) => setTimeout(r, 1)); // concurrent runs overlap here
      if (!claims.has(`${u}:${key}`)) claims.set(`${u}:${key}`, { dateId });
      return claims.get(`${u}:${key}`);
    },
    replaceClaim: async (u, key, old, dateId) => {
      if (claims.get(`${u}:${key}`)?.dateId === old) claims.set(`${u}:${key}`, { dateId });
      return claims.get(`${u}:${key}`);
    },
    pick: async (u) => (calls.pick++, pick(u)),
    state: async (u, d) => (released.has(`${u}:${d}`) ? "released" : gone.has(d) || decided.has(`${u}:${d}`) ? "gone" : "releasable"),
    plan: async (id, users, after, model, key) => {
      calls.plan++;
      events.push(["plan", id, model, users.join("+"), key]);
      if (model && clock) clock.t += modelMs; // a slow model call
      onPlan?.(id, users);
      return { source: model ? "model" : "template", dropKey: key };
    },
    release: async (u, d) => {
      if (releaseFails > 0) {
        releaseFails--;
        throw new Error("function killed");
      }
      // Like the SQL: only an unreleased, unanswered side.
      if (released.has(`${u}:${d}`) || decided.has(`${u}:${d}`)) return false;
      released.add(`${u}:${d}`);
      events.push(["release", u, clock?.t ?? null]);
      return true;
    },
    push: async (u) => {
      if (pushFails > 0) {
        pushFails--;
        throw new Error("send failed");
      }
      events.push(["push", u]);
    },
    log: async () => void calls.log++,
  };
  return { io, claims, released, gone, decided, events, calls };
}

const NOW = T("2026-10-21T13:31:00Z").getTime();
const opts = (over = {}) => ({ clock: () => NOW, deadline: NOW + 240_000, concurrency: 3, planTimeoutMs: 20_000, pushMs: 2_000, ...over });

test("idempotent: one drop per person per drop time, whatever the retries or double cron fires", async () => {
  const f = fakeIO();
  const runs = await Promise.all([runDrop(f.io, [A], W, opts()), runDrop(f.io, [A], W, opts()), runDrop(f.io, [A], W, opts())]);
  assert.equal(runs.reduce((n, r) => n + r.released, 0), 1);
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 0); // a later retry (the daily catch-up)
  assert.equal(f.released.size, 1);
  assert.equal(f.claims.size, 1);
  assert.equal(f.calls.log, 1);
  // The next drop is a new claim.
  f.io.pick = async () => "d2";
  assert.equal((await runDrop(f.io, [A], W2, opts())).released, 1);
  assert.equal(f.claims.size, 2);
});

test("idempotent: a run killed after the claim is finished by the next run, with the same pick", async () => {
  const f = fakeIO({ failRelease: 1 });
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 0);
  f.io.pick = async () => "a-different-date"; // the claim holds: the pick never changes on a retry
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 1);
  assert.deepEqual([...f.released], [`${A}:d1`]);
});

test("no eligible match this time: the empty claim is recorded and nothing is sent, also on retries", async () => {
  const f = fakeIO({ pick: () => null });
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 0);
  assert.equal((await runDrop(f.io, [A], W, opts({ clock: () => NOW + 3_600_000 }))).released, 0);
  assert.equal(f.calls.pick, 1);
  assert.equal(f.calls.plan, 0);
  assert.deepEqual(f.claims.get(`${A}:${W.key}`), { dateId: null });
});

test("a stale claim (answered, unmatched or blocked before it went out) is re-picked, so nobody loses the drop", async () => {
  const f = fakeIO();
  // The first run claims d1 but runs out of time before releasing it.
  assert.equal((await runDrop(f.io, [A], W, opts({ deadline: NOW - 1 }))).released, 0);
  assert.deepEqual(f.claims.get(`${A}:${W.key}`), { dateId: "d1" });
  f.gone.add("d1");
  f.io.pick = async () => "d2";
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 1);
  assert.deepEqual(f.claims.get(`${A}:${W.key}`), { dateId: "d2" });
  assert.deepEqual([...f.released], [`${A}:d2`]);
  // A claim that already went out is never re-picked.
  f.io.pick = async () => "d3";
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 0);
  assert.deepEqual(f.claims.get(`${A}:${W.key}`), { dateId: "d2" });
});

test("push: each person is pushed right after their own release; a failed push is not retried by the drop run", async () => {
  const f = fakeIO({ pick: (u) => `date-${u.slice(0, 1)}`, failPush: 1 });
  const r = await runDrop(f.io, [A, B, C], W, opts({ concurrency: 1 }));
  assert.deepEqual([r.released, r.pushed], [3, 2]);
  const steps = f.events.filter((e) => e[0] !== "plan").map((e) => e.slice(0, 2).join(":"));
  assert.deepEqual(steps, [`release:${A}`, `release:${B}`, `push:${B}`, `release:${C}`, `push:${C}`]); // A's push failed
  // A is released: the drop is now an open recommendation, which the daily job's push (or opening the chat) sends.
  assert.equal(await f.io.state(A, "date-a"), "released");
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 0, "never released or sent twice");
});

test("plans: written before any release, one per date and drop (both claimants of a pair share it in one drop)", async () => {
  const f = fakeIO({ pick: (u) => (u === A || u === B ? "d-pair" : `d-${u.slice(0, 1)}`) });
  await runDrop(f.io, [A, B, C], W, opts({ concurrency: 1 }));
  const plans = f.events.filter((e) => e[0] === "plan");
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.find((e) => e[1] === "d-pair").slice(3), [`${A}+${B}`, W.key]);
  assert.ok(f.events.findIndex((e) => e[0] === "release") > f.events.findLastIndex((e) => e[0] === "plan"));
});

test("time budget: a model plan starts only if it ends (at its timeout) before the time kept for the pushes", async () => {
  // 4 pushes at 2 s over 2 workers = 4 s kept. 10 s left: a 20 s call would not fit, so templates only.
  const g = fakeIO({ pick: (u) => ({ [A]: "d4", [B]: "d1", [C]: "d3", x: "d2" })[u] });
  const r = await runDrop(g.io, [A, B, C, "x"], W, opts({ concurrency: 2, deadline: NOW + 10_000 }));
  assert.deepEqual([r.modelPlans, r.released], [0, 4]);
  const h = fakeIO({ pick: (u) => ({ [A]: "d4", [B]: "d1", [C]: "d3", x: "d2" })[u] });
  assert.equal((await runDrop(h.io, [A, B, C, "x"], W, opts({ concurrency: 2, deadline: NOW + 30_000 }))).modelPlans, 4);
  // No time left at all: templates only, and nothing released (the next run does it).
  const late = await runDrop(fakeIO().io, [A], W, opts({ deadline: NOW - 1 }));
  assert.deepEqual([late.modelPlans, late.released], [0, 0]);
});

test("time budget: with a slow model (every call takes its full 20 s timeout) the releases still happen before the deadline", async () => {
  const clock = { t: NOW };
  const users = Array.from({ length: 20 }, (_, i) => `user-${String(i).padStart(2, "0")}`);
  const f = fakeIO({ pick: (u) => `date-${u}`, clock, modelMs: 20_000 });
  const deadline = NOW + 240_000;
  const r = await runDrop(f.io, users, W, opts({ clock: () => clock.t, deadline, concurrency: 1, pushMs: 1_000 }));
  // 20 pushes at 1 s kept free: model calls only while one still ends by 220 s, i.e. 10 of them; then templates.
  assert.equal(r.modelPlans, 10);
  assert.equal(r.released, 20);
  const at = f.events.filter((e) => e[0] === "release").map((e) => e[2]);
  assert.ok(Math.max(...at) <= deadline, `last release at +${(Math.max(...at) - NOW) / 1000} s`);
});

test("a person who answers between the claim and the release never gets an answered date as their drop", async () => {
  // A answers d1 while the plans are being written; the release skips it, and the next run re-picks.
  let answering = true;
  const f = fakeIO({ onPlan: (id) => answering && f.decided.add(`${A}:${id}`) });
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 0);
  answering = false;
  f.io.pick = async () => "d2";
  assert.equal((await runDrop(f.io, [A], W, opts())).released, 1);
  assert.deepEqual([...f.released], [`${A}:d2`]);
});

// ---- The plan --------------------------------------------------------------------------------------

const dropMoment = new Date("2026-10-21T13:30:00Z");

test("plan time: from both people's availability, after the drop, in India time", () => {
  const sat = planSlot("flexible", "flexible", dropMoment);
  assert.deepEqual([sat.day, sat.time, sat.part, sat.at], ["Sat 24 Oct", "5:30 pm", "sunset", "2026-10-24T12:00:00.000Z"]);
  assert.equal(planSlot("weekends", "flexible", dropMoment).day, "Sat 24 Oct");
  const thu = planSlot("weekday_evenings", "flexible", dropMoment);
  assert.deepEqual([thu.day, thu.time, thu.part], ["Thu 22 Oct", "6:30 pm", "evening"]);
  assert.equal(planSlot("weekday_evenings", "weekends", dropMoment).day, "Fri 23 Oct"); // halfway
  assert.ok(Date.parse(planSlot("weekends", "weekends", dropMoment).at) > dropMoment.getTime());
});

const input = (over = {}) => {
  const slot = planSlot("flexible", "flexible", dropMoment);
  return {
    slot, venues: venuesFor(["", "Mandrem"], slot.part),
    one: { interests: ["Climbing", "Science"], about: "Builds reef drones" },
    two: { interests: ["Climbing", "Books"], about: "Writes bad sci-fi" },
    shared: ["Climbing"], ...over,
  };
};

test("plan venues: real named places near the hub (or generic ones elsewhere), fitting the time", () => {
  const named = new Set(["Riva Beach Resort", "Mandrem Beach", "Ashvem Beach", "The Circle.Work"]);
  for (const v of EDGE_CITY_VENUES) assert.ok(named.has(v.place) || /^a /.test(v.place), v.place);
  assert.ok(venuesFor(["Mandrem", ""], "sunset").every((v) => v.parts.includes("sunset")));
  assert.deepEqual(venuesFor(["Bangalore", "Mandrem"], "evening").map((v) => v.id), ["cafe", "dinner"]);
});

test("plan validation: a good model plan is used as written; the activity always comes from the venue list", () => {
  const p = parsePlan(JSON.stringify({ venueId: "mandrem-sunset", why: "You both love climbing and swapping strange science stories." }), input());
  assert.equal(p.source, "model");
  assert.equal(p.place, "Mandrem Beach");
  assert.equal(planText(p), "Sat 24 Oct, 5:30 pm: a sunset walk on Mandrem Beach");
  assert.ok(`${planText(p)}. ${p.why}`.split(/\s+/).length <= 60, "text-message friendly");
  assert.equal(parsePlan("```json\n" + JSON.stringify({ venueId: "riva-chai", why: "Your agents bonded over climbing." }) + "\n```", input()).venueId, "riva-chai");
});

test("plan validation: unusable or unsafe model output is rejected (the template is used instead)", () => {
  const bad = [
    "not json",
    JSON.stringify({ venue: "mandrem-sunset" }),
    JSON.stringify({ venueId: "made-up-bar", why: "You both love climbing." }), // not in the list
    JSON.stringify({ venueId: "riva-dinner", why: "You both love climbing." }), // in the list, not at sunset
    JSON.stringify({ venueId: "mandrem-sunset", why: "Two single people who love climbing." }), // relationship status
    JSON.stringify({ venueId: "mandrem-sunset", why: "She is poly and he loves climbing." }), // gender, openness
    JSON.stringify({ venueId: "mandrem-sunset", why: "A romantic sunset for two climbers." }), // romance (the date's kind is secret)
    JSON.stringify({ venueId: "mandrem-sunset", why: "You both love climbing, text @asha_k on telegram: asha_k." }), // contact
    JSON.stringify({ venueId: "mandrem-sunset", why: "You both love Joe's Climbing Bar near Morjim Point." }), // invented place
    JSON.stringify({ venueId: "mandrem-sunset", why: "Asha and Ben both love climbing." }), // names (none are given to the model)
    JSON.stringify({ venueId: "mandrem-sunset", why: "" }),
  ];
  for (const b of bad) assert.equal(parsePlan(b, input()), null, b);
  const long = parsePlan(JSON.stringify({ venueId: "mandrem-sunset", why: "You both love climbing and science and books and the sea and long talks about everything under the sun at dusk." }), input());
  assert.ok(long.why.split(" ").length <= WHY_WORDS, "capped");
});

test("plan fallback: the template is safe on its own and never carries a private interest", () => {
  const t = templatePlan(input({ shared: ["Surfing/beach", "AI"] }));
  assert.equal(t.source, "template");
  assert.equal(t.why, "You both love surfing and AI.");
  assert.equal(t.activity, "a sunset walk on Mandrem Beach");
  assert.equal(templatePlan(input({ shared: [] })).why, "Your agents had a really good chat.");
  assert.equal(templatePlan(input({ shared: ["Polyamory"] })).why, "Your agents had a really good chat.");
  assert.equal(safeLine("You both love Mandrem sunsets."), "You both love Mandrem sunsets.");
});

test("plan rotation: the template's venue and the time rotate by the date id, so they depend on the date only", () => {
  const sun = planSlot("flexible", "flexible", dropMoment, undefined, 1);
  assert.deepEqual([sun.day, sun.time, sun.part], ["Sun 25 Oct", "10 am", "morning"]);
  assert.equal(planSlot("flexible", "flexible", dropMoment, undefined, 2).day, "Thu 22 Oct");
  assert.equal(planSlot("weekday_evenings", "weekday_evenings", dropMoment, undefined, 1).day, "Fri 23 Oct");
  assert.equal(planSlot("weekday_evenings", "weekends", dropMoment, undefined, 7).day, "Fri 23 Oct"); // only one fit
  const venues = input().venues;
  assert.ok(venues.length > 1);
  assert.equal(templatePlan(input({ seed: 1 })).venueId, venues[1].id);
  assert.equal(templatePlan(input({ seed: venues.length })).venueId, venues[0].id);
  assert.equal(seedOf("11111111-2222-4333-8444-555555555555"), seedOf("11111111-2222-4333-8444-555555555555"));
  const seeds = new Set(["a", "b", "c", "d", "e", "f"].map((x) => seedOf(`date-${x}`) % 3));
  assert.ok(seeds.size > 1, "different dates get different plans");
});

test("plan prompt: only public lines (interests, the one-line bio): never status, openness, gender, orientation or names", () => {
  const prompt = planPrompt(input());
  for (const word of ["single", "married", "mono", "poly", "romance", "gender", "man", "woman", "interestedIn", "Asha", "Ben", "telegram"]) {
    assert.ok(!new RegExp(`\\b${word}\\b`, "i").test(prompt), word);
  }
  assert.match(prompt, /Shared interests: Climbing/);
});

// ---- Proposal and confirmation ----------------------------------------------------------------------

const plan = templatePlan(input());

// A fixed "now" for plans that would otherwise move with the real clock (and past the event end).
const T0 = new Date("2026-10-22T00:00:00Z");
const K1 = "2026-10-21T13:30:00.000Z";
const K2 = "2026-10-28T13:30:00.000Z";

test("the plan is a proposal with my own drop, and confirmed only after a mutual yes", () => {
  const d = date("d1", { planA: { ...plan, dropKey: K1 }, dropAAt: K1 });
  assert.equal(planFor(d, A, T0).confirmed, false);
  assert.equal(planFor(d, B, T0), null, "never with the other side's drop");
  // One yes: nothing to confirm, and B still learns nothing.
  const oneYes = { ...d, decisionA: "meet" };
  assert.equal(confirmPlan(oneYes, new Date("2026-10-22T00:00:00Z")), null);
  assert.equal(planFor(oneYes, B, T0), null);
  // A no: nothing either.
  assert.equal(confirmPlan({ ...d, decisionA: "meet", decisionB: "pass", dropBAt: d.dropAAt }, new Date()), null);
  // Both yes: confirmed, and both see the confirmed plan.
  const both = { ...d, decisionA: "meet", decisionB: "meet", dropBAt: K1, planB: { ...plan, dropKey: K1 }, matchedAt: "2026-10-22T00:00:00.000Z" };
  const confirmed = confirmPlan(both, new Date("2026-10-22T00:00:00Z"));
  assert.equal(confirmed.at, plan.at);
  const matched = { ...both, plan: confirmed, planConfirmedAt: "2026-10-22T00:00:00.000Z" };
  assert.deepEqual([planFor(matched, A, T0).confirmed, planFor(matched, B, T0).confirmed], [true, true]);
  assert.equal(confirmPlan(matched, new Date()), null, "confirmed once");
  // An unmatch closes it for both.
  assert.equal(planFor({ ...matched, chatClosedAt: "2026-10-23T00:00:00.000Z" }, A, T0), null);
});

test("a plan whose time passed before the second yes moves to the same weekday and time ahead", () => {
  const later = new Date("2026-11-02T00:00:00Z"); // after Sat 24 Oct and Sat 31 Oct
  const moved = rollForward(plan, later, undefined, null); // no event end
  assert.deepEqual([moved.day, moved.time, moved.at], ["Sat 7 Nov", "5:30 pm", "2026-11-07T12:00:00.000Z"]);
  assert.equal(rollForward(plan, new Date("2026-10-23T00:00:00Z")), plan, "still ahead: unchanged");
  assert.equal(rollForward(plan, new Date("2026-10-26T00:00:00Z")).day, "Sat 31 Oct", "moves within the event");
});

// The event ends at the midnight after Sun 1 Nov (India time); the last drop is Fri 30 Oct 19:00.
const lastDrop = new Date("2026-10-30T13:30:00Z");

test("plan time never after the event: the Fri 30 Oct drop plans for Sat 31 Oct or Sun 1 Nov, never 5 or 6 Nov", () => {
  for (const [a, b] of [["weekday_evenings", "weekday_evenings"], ["weekday_evenings", "flexible"], ["weekday_evenings", "weekends"], ["weekends", "flexible"], ["flexible", "flexible"]]) {
    for (let seed = 0; seed < 6; seed++) {
      const s = planSlot(a, b, lastDrop, undefined, seed);
      assert.ok(s, `${a}/${b}/${seed}`);
      assert.ok(Date.parse(s.at) < eventEndAt().getTime(), `${a}/${b}/${seed}: ${s.day}`);
      assert.ok(Date.parse(s.at) > lastDrop.getTime());
    }
  }
  // Was Thu 5 Nov (weekday evenings both) and Thu 5 Nov (flexible, seed % 3 == 2): now the earliest slot left.
  assert.equal(planSlot("weekday_evenings", "weekday_evenings", lastDrop).day, "Sat 31 Oct");
  assert.equal(planSlot("flexible", "flexible", lastDrop, undefined, 2).day, "Sat 31 Oct");
  assert.equal(planSlot("flexible", "flexible", lastDrop, undefined, 1).day, "Sun 1 Nov", "a choice that fits is kept");
  // Nothing left before the end: no plan. Without an end: the old rule.
  assert.equal(planSlot("flexible", "flexible", new Date("2026-11-01T06:00:00Z")), null);
  assert.equal(planSlot("weekday_evenings", "weekday_evenings", lastDrop, undefined, 0, null).day, "Thu 5 Nov");
});

test("plan time for the Saturday 31 Oct 10:00 drop: Sun 1 Nov 10 am for every pair (before the event ends), with a morning venue", () => {
  for (const after of [new Date("2026-10-31T04:30:00Z"), new Date("2026-10-31T04:35:00Z"), new Date("2026-10-31T05:59:00Z")]) {
    for (const a of ["weekday_evenings", "weekends", "flexible"]) {
      for (const b of ["weekday_evenings", "weekends", "flexible"]) {
        for (let seed = 0; seed < 6; seed++) {
          const s = planSlot(a, b, after, undefined, seed);
          assert.ok(s, `${a}/${b}/${seed}`);
          assert.deepEqual([s.day, s.time, s.part, s.at], ["Sun 1 Nov", "10 am", "morning", "2026-11-01T04:30:00.000Z"], `${a}/${b}/${seed}`);
          assert.ok(Date.parse(s.at) < eventEndAt().getTime());
        }
      }
    }
  }
  assert.ok(venuesFor(["Mandrem"], "morning").length >= 3);
});

test("a stored plan never rolls past the event's end, and one already after it is never shown or confirmed", () => {
  const thu = { ...templatePlan(input({ slot: planSlot("weekday_evenings", "flexible", dropMoment) })), dropKey: K1 }; // Thu 22 Oct
  assert.equal(thu.day, "Thu 22 Oct");
  assert.equal(rollForward(thu, new Date("2026-10-23T00:00:00Z")).day, "Thu 29 Oct");
  assert.equal(rollForward(thu, new Date("2026-10-30T00:00:00Z")), null, "was Thu 5 Nov");
  const d = date("d1", { planA: thu, dropAAt: K1 });
  assert.equal(planFor(d, A, new Date("2026-10-30T00:00:00Z")), null);
  assert.equal(confirmPlan({ ...d, decisionA: "meet", decisionB: "meet", dropBAt: K1 }, new Date("2026-10-30T00:00:00Z")), null);
  // A plan written for after the end (by the old rule) is dropped wherever it shows.
  const late = { ...thu, at: "2026-11-05T13:00:00.000Z", day: "Thu 5 Nov" };
  assert.equal(rollForward(late, new Date("2026-10-30T00:00:00Z")), null);
  assert.equal(planFor(date("d1", { planA: late, dropAAt: K1 }), A, new Date("2026-10-30T00:00:00Z")), null);
  const matched = date("d1", { decisionA: "meet", decisionB: "meet", matchedAt: K1, plan: late, planConfirmedAt: K1 });
  assert.equal(planFor(matched, A, T0), null);
});

test("a match confirms the other side's plan when the earlier one would land after the event", () => {
  // A got it in the 21 Oct drop (Thu 22 Oct), B in the Fri 30 Oct extra drop (Sat 31 Oct); both say yes on 30 Oct.
  const thu = { ...templatePlan(input({ slot: planSlot("weekday_evenings", "flexible", dropMoment) })), dropKey: K1 };
  const sat = { ...templatePlan(input({ slot: planSlot("flexible", "flexible", lastDrop) })), dropKey: "2026-10-30T13:30:00.000Z" };
  const d = date("d1", { planA: thu, planB: sat, dropAAt: K1, dropBAt: "2026-10-30T13:30:00.000Z", decisionA: "meet", decisionB: "meet" });
  const confirmed = confirmPlan(d, new Date("2026-10-30T15:00:00Z"));
  assert.equal(confirmed?.day, "Sat 31 Oct");
  assert.equal(confirmPlan(d, new Date("2026-10-23T00:00:00Z")).day, "Thu 29 Oct", "the earlier one while it still fits");
});

test("plans per side: B's drop in a later week gets its own plan, never A's; the match confirms the earlier one", () => {
  const planB = { ...templatePlan(input({ seed: 1 })), dropKey: K2, why: "Your agents bonded over climbing." };
  const d = date("d1", { planA: { ...plan, dropKey: K1 }, dropAAt: K1, dropBAt: K2 });
  assert.equal(planFor(d, B, T0), null, "A's plan is never shown with B's drop");
  const both = { ...d, planB };
  assert.equal(planFor(both, B, T0).why, planB.why);
  assert.equal(planFor(both, A, T0).why, plan.why);
  const confirmed = confirmPlan({ ...both, decisionA: "meet", decisionB: "meet" }, new Date("2026-10-22T00:00:00Z"));
  assert.equal(confirmed.dropKey, K1);
  assert.equal(confirmPlan({ ...both, planA: null, decisionA: "meet", decisionB: "meet" }, new Date("2026-10-29T00:00:00Z")).dropKey, K2);
});

test("a proposed plan never shows a time that has passed: it moves a week ahead too", () => {
  const d = date("d1", { planA: { ...plan, dropKey: K1 }, dropAAt: K1 });
  assert.equal(planFor(d, A, new Date("2026-10-22T00:00:00Z")).day, "Sat 24 Oct");
  assert.equal(planFor(d, A, new Date("2026-10-26T00:00:00Z")).day, "Sat 31 Oct");
  assert.equal(planFor(d, A, new Date("2026-10-26T00:00:00Z")).text, "Sat 31 Oct, 5:30 pm: a sunset walk on Mandrem Beach");
});

// ---- Delivery by text -------------------------------------------------------------------------------

test("delivery: the drop goes out with its plan; outside WhatsApp's 24 h window the existing template carries the plan", async () => {
  const store = memoryStore();
  const adapter = memoryAdapter();
  const now = new Date("2026-10-21T13:31:00Z"); // 19:01 IST, not quiet hours
  const rec = { dateId: "11111111-2222-4333-8444-555555555555", name: "Priya", why: "Fellow climber.", meetup: "",
    drop: { plan: planText(plan), why: "Your agents hit it off over climbing and bad sci-fi." } };
  const app = { pending: async () => [rec], suspended: async () => false, log: async () => {} };
  const deps = { store, adapter, model: {}, app, now: () => now, site: "https://kismet.test" };
  const open = await store.createThread("whatsapp", "+15550000001");
  await store.save({ ...open, userId: "u1", state: "active", lastInboundAt: new Date(now.getTime() - 3600_000).toISOString() });
  assert.equal(await pushNext(deps, await store.thread("whatsapp", "+15550000001")), "pushed");
  const sent = adapter.sent.at(-1);
  assert.equal(sent.kind, "buttons");
  assert.match(sent.text, /^Your Kismet for this week: Priya\. Your agents hit it off over climbing and bad sci-fi\. Plan: Sat 24 Oct, 5:30 pm: a sunset walk on Mandrem Beach\. Up for it\? Reply YES or NO\./);
  assert.ok(sent.text.split(/\s+/).length <= 70);
  // The transcript keeps the placeholder only, never the name or plan.
  assert.deepEqual(store.msgs.get(open.id).map((m) => m.text), [`[recommendation date:${rec.dateId}]`]);

  const closed = await store.createThread("whatsapp", "+15550000002");
  await store.save({ ...closed, userId: "u2", state: "active", lastInboundAt: "2026-10-01T00:00:00.000Z" });
  assert.equal(await pushNext(deps, await store.thread("whatsapp", "+15550000002")), "pushed:template");
  assert.match(adapter.sent.at(-1).text, /^Priya: Plan: Sat 24 Oct, 5:30 pm: a sunset walk on Mandrem Beach\. Your agents hit it off over climbing and bad sci-fi\.$/);

  // A long why line is clipped after the plan: the template's 200-character parameter never cuts the plan.
  rec.drop.why = `Your agents ${"really ".repeat(40)}hit it off.`;
  const third = await store.createThread("whatsapp", "+15550000003");
  await store.save({ ...third, userId: "u3", state: "active", lastInboundAt: "2026-10-01T00:00:00.000Z" });
  assert.equal(await pushNext(deps, await store.thread("whatsapp", "+15550000003")), "pushed:template");
  const why = adapter.sent.at(-1).text.slice("Priya: ".length);
  assert.ok(why.length <= 200, `${why.length}`);
  assert.ok(why.startsWith("Plan: Sat 24 Oct, 5:30 pm: a sunset walk on Mandrem Beach. Your agents"));
});

test("availability: optional, aliases only on that field ('both' never turns interestedIn into 'flexible')", () => {
  const base = { name: "Asha", lookingFor: ["romance"], interests: ["AI"], telegram: "asha_k", gender: "woman", interestedIn: "everyone" };
  assert.equal(parseProfile(base).profile.availability, undefined); // left out: an edit keeps what they had
  assert.equal(parseProfile({ ...base, availability: "both" }).profile.availability, "flexible");
  assert.equal(parseProfile({ ...base, free: "weekend" }).profile.availability, "weekends");
  assert.equal(parseProfile({ ...base, availability: "Weekday evenings" }).profile.availability, "weekday_evenings");
  assert.ok("error" in parseProfile({ ...base, interestedIn: "both" }));
  assert.ok("error" in parseProfile({ ...base, interestedIn: "any" }));
  assert.ok("error" in parseProfile({ ...base, availability: "never" }));
});
