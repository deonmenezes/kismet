// Run: npm test. The public village calendar: iCal parsing, recurrence, interest matching, formatting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forInterests, formatEvent, localDay, parseIcs } from "./village-events.ts";

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT", "UID:a@edgeos", "DTSTART:20261020T020000Z", "DTEND:20261020T030000Z", "SUMMARY:21-day Challenge: Morning Run Club",
  "LOCATION:Riva Beach Resort: meet on the grass", "RRULE:FREQ=DAILY;INTERVAL=1;COUNT=3", "EXDATE:20261021T020000Z", "END:VEVENT",
  "BEGIN:VEVENT", "UID:b@edgeos", "DTSTART:20261023T123000Z", "DTEND:20261023T140000Z", "SUMMARY:Surf\\, sunsets and startups", "LOCATION:Remote", "END:VEVENT",
  "BEGIN:VEVENT", "UID:c@edgeos", "DTSTART:20261019T130000Z", "DTEND:20261019T140000Z", "SUMMARY:Friday chess", "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=FR;UNTIL=20261031T235959Z", "END:VEVENT",
  "BEGIN:VEVENT", "UID:c@edgeos", "RECURRENCE-ID:20261023T130000Z", "DTSTART:20261023T150000Z", "DTEND:20261023T160000Z", "SUMMARY:Friday chess (late)", "END:VEVENT",
  "BEGIN:VEVENT", "UID:d@edgeos", "DTSTART:20261020T090000Z", "DTEND:20261020T100000Z", "SUMMARY:Cancelled thing", "STATUS:CANCELLED", "END:VEVENT",
  "BEGIN:VEVENT", "UID:e@edgeos", "DTSTART:20261020T100000Z", "DTEND:20261020T110000Z", "SUMMARY:A very long title that", " continues on the next line", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const from = new Date("2026-10-19T00:00:00Z");
const to = new Date("2026-11-02T00:00:00Z");

test("village calendar: daily COUNT with an EXDATE, weekly BYDAY with a moved occurrence, folded lines, cancelled dropped", () => {
  const ev = parseIcs(ICS, from, to);
  const runs = ev.filter((e) => e.uid === "a@edgeos").map((e) => e.start.toISOString());
  assert.deepEqual(runs, ["2026-10-20T02:00:00.000Z", "2026-10-22T02:00:00.000Z"]); // 3 occurrences, the 21st excluded
  const chess = ev.filter((e) => e.uid === "c@edgeos").map((e) => [e.title, e.start.toISOString()]);
  assert.deepEqual(chess, [
    ["Friday chess", "2026-10-19T13:00:00.000Z"], // the first start always counts (RFC 5545), though it is a Monday
    ["Friday chess (late)", "2026-10-23T15:00:00.000Z"], // moved
    ["Friday chess", "2026-10-30T13:00:00.000Z"],
  ]); // 23 Oct's own slot is replaced by the override
  assert.ok(!ev.some((e) => e.title === "Cancelled thing"));
  assert.ok(ev.some((e) => e.title === "A very long title thatcontinues on the next line"));
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].start <= e.start));
});

test("village calendar: interests find events by word stem; formatting is in IST with the place", () => {
  const ev = parseIcs(ICS, from, to);
  assert.deepEqual(forInterests(ev, ["Surfing", "AI"]).map((e) => e.title), ["Surf, sunsets and startups"]);
  assert.deepEqual(forInterests(ev, ["running"]).map((e) => e.uid), ["a@edgeos"]); // once, at its next time
  assert.deepEqual(forInterests(ev, []), []);
  const run = ev.find((e) => e.uid === "a@edgeos");
  assert.equal(formatEvent(run), "21-day Challenge: Morning Run Club, Tue 20 Oct, 7:30 AM IST at Riva Beach Resort: meet on the grass");
  assert.match(formatEvent(ev.find((e) => e.uid === "b@edgeos")), /\(remote\)$/);
  assert.equal(localDay(new Date("2026-10-19T19:00:00Z")), "2026-10-20"); // 00:30 in Goa
});

test("village calendar: date-only UNTIL ends that day in Goa; an EXDATE written as village time with Z still skips; titles dedupe", () => {
  const ics = ["BEGIN:VEVENT", "UID:w@edgeos", "DTSTART:20261012T160000Z", "DTEND:20261012T170000Z", "SUMMARY:Wind Down Evenings",
    "RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261014", "EXDATE:20261013T213000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:x1@edgeos", "DTSTART:20261020T100000Z", "DTEND:20261020T110000Z", "SUMMARY:Surf Club", "END:VEVENT",
    "BEGIN:VEVENT", "UID:x2@edgeos", "DTSTART:20261021T100000Z", "DTEND:20261021T110000Z", "SUMMARY:Surf club!", "END:VEVENT"].join("\r\n");
  const ev = parseIcs(ics, new Date("2026-10-12T00:00:00Z"), new Date("2026-10-30T00:00:00Z"));
  assert.deepEqual(ev.filter((e) => e.uid === "w@edgeos").map((e) => e.start.toISOString().slice(0, 10)), ["2026-10-12", "2026-10-14"]);
  assert.equal(forInterests(ev, ["surfing"], 5).length, 1);
});
