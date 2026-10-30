// Edge City India's public village calendar (EdgeOS, the platform behind Agent Village): the anonymous iCal feed
// of published, public events. Kismet uses it to ground meetup ideas in real events ("Morning Run Club, Tue 7:30 AM
// at Riva Beach") and to answer "what's on?". Public data only: nothing about any resident is sent or stored.
// Pure parsing and picking (unit-tested in village-events.test.mjs); villageEvents() below does the fetch.

export type VillageEvent = { uid: string; title: string; start: Date; end: Date; location: string };

const TZ = "Asia/Kolkata";
const DAY = 86_400_000;
const ICS_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

const toDate = (v: string) => {
  const m = ICS_DATE.exec(v.trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
};
/** UNTIL may be a plain date: the end of that day in the village. */
const untilDate = (v: string) => {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v.trim());
  return d ? new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], 18, 29, 59)) : toDate(v);
};
const IST_MS = 5.5 * 3600_000;
const unescape = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

type Raw = Record<string, string[]>;

function blocks(ics: string): Raw[] {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/); // unfold continuation lines
  const out: Raw[] = [];
  let cur: Raw | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 1) continue;
      const key = line.slice(0, i).split(";")[0].toUpperCase();
      (cur[key] ??= []).push(line.slice(i + 1));
    }
  }
  return out;
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Occurrence starts of one event between `from` and `to` (DAILY / WEEKLY rules with COUNT, UNTIL, BYDAY; EXDATEs skipped). */
function occurrences(start: Date, rrule: string | undefined, exdates: Set<number>, from: Date, to: Date): Date[] {
  if (!rrule) return start >= from && start < to && !exdates.has(start.getTime()) ? [start] : [];
  const r = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
  const until = r.UNTIL ? untilDate(r.UNTIL) : null;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1));
  const days = r.BYDAY ? new Set(r.BYDAY.split(",").map((d) => BYDAY.indexOf(d.slice(-2)))) : null;
  if (r.FREQ !== "DAILY" && r.FREQ !== "WEEKLY") return [];
  const out: Date[] = [];
  let n = 0;
  // Walk day by day (the village lasts three weeks); weekly rules keep their BYDAY days (or the start's weekday).
  for (let t = start.getTime(), i = 0; i < 400; t += DAY, i++) {
    const d = new Date(t);
    if (until && d > until) break;
    if (d >= to) break;
    const dayIndex = Math.round((t - start.getTime()) / DAY);
    const weekday = new Date(d.getTime() + IST_MS).getUTCDay(); // the weekday in Goa
    // The first start always counts (RFC 5545), whatever BYDAY says.
    const hit = dayIndex === 0 || (r.FREQ === "DAILY"
      ? dayIndex % interval === 0 && (!days || days.has(weekday))
      : Math.floor(dayIndex / 7) % interval === 0 && (days ? days.has(weekday) : dayIndex % 7 === 0));
    if (!hit) continue;
    if (++n > count) break;
    // EdgeOS sometimes writes an EXDATE as village time marked Z: match that too.
    if (d >= from && !exdates.has(t) && !exdates.has(t + IST_MS)) out.push(d);
  }
  return out;
}

/** Every occurrence between `from` and `to`, soonest first. Moved occurrences (RECURRENCE-ID) replace the series' own. */
export function parseIcs(ics: string, from: Date, to: Date): VillageEvent[] {
  const raw = blocks(ics);
  const moved = new Map<string, Set<number>>();
  for (const b of raw) {
    const rid = b["RECURRENCE-ID"]?.[0] && toDate(b["RECURRENCE-ID"][0]);
    if (rid && b.UID?.[0]) (moved.get(b.UID[0]) ?? moved.set(b.UID[0], new Set()).get(b.UID[0])!).add(rid.getTime());
  }
  const out: VillageEvent[] = [];
  for (const b of raw) {
    const start = toDate(b.DTSTART?.[0] ?? "");
    const end = toDate(b.DTEND?.[0] ?? "") ?? start;
    const title = unescape(b.SUMMARY?.[0] ?? "");
    if (!start || !end || !title || (b.STATUS?.[0] ?? "").toUpperCase() === "CANCELLED") continue;
    const uid = b.UID?.[0] ?? title;
    const isOverride = Boolean(b["RECURRENCE-ID"]);
    const ex = new Set<number>([...(b.EXDATE ?? []).flatMap((v) => v.split(",")).map((v) => toDate(v)?.getTime() ?? 0), ...(isOverride ? [] : moved.get(uid) ?? [])]);
    const length = end.getTime() - start.getTime();
    for (const s of occurrences(start, isOverride ? undefined : b.RRULE?.[0], ex, from, to)) {
      out.push({ uid, title, start: s, end: new Date(s.getTime() + length), location: unescape(b.LOCATION?.[0] ?? "") });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// surfing -> surf, running -> run, books -> book, startups -> startup (enough for interest words vs event titles).
const stem = (w: string) => w.toLowerCase().replace(/(ing|ers|er|es|s)$/, "").replace(/([a-z])\1$/, "$1");
const STOP = new Set(["the", "and", "for", "with", "from", "your", "our", "into", "about", "edge", "city", "india", "session", "club", "day", "night", "talk", "open"]);
const words = (s: string) => s.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w.toLowerCase())).map(stem).filter((w) => w.length >= 2);
const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));

/** Events whose title shares a word with these interests ("surfing" finds "Surf club"), soonest first. */
export function forInterests(events: VillageEvent[], interests: string[], n = 3) {
  const want = interests.flatMap(words);
  if (!want.length) return [];
  const seen = new Set<string>(); // a repeating (or split-off) event once, at its next time
  const key = (e: VillageEvent) => e.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return events.filter((e) => words(e.title).some((w) => want.some((x) => same(w, x))) && !seen.has(key(e)) && seen.add(key(e))).slice(0, n);
}

/** "Morning Run Club, Tue 20 Oct, 7:30 AM IST at Riva Beach Resort" */
export function formatEvent(e: VillageEvent) {
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(e.start);
  const where = e.location && !/^remote/i.test(e.location) ? ` at ${e.location}` : e.location ? " (remote)" : "";
  return `${e.title}, ${when.replace(/\bam\b/i, "AM").replace(/\bpm\b/i, "PM")} IST${where}`;
}

/** For the chat model's prompt: titles and places are written by event hosts, so clipped, without links or brackets. */
export function briefEvent(e: VillageEvent) {
  const clean = (s: string, n: number) => s.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/[<>[\]{}`]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  return formatEvent({ ...e, title: clean(e.title, 80), location: clean(e.location, 60) });
}

/** The village's local day (Asia/Kolkata) of a time, as YYYY-MM-DD. */
export const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// ---- Fetch ------------------------------------------------------------------------------------------

const POPUP = process.env.VILLAGE_POPUP_ID || "7ef75c6f-1673-4d52-926b-53452b1b6515"; // Edge City India 2026
const FEED = `https://api.edgeos.world/api/v1/events/public/calendar.ics?popup_id=${POPUP}`;

/** Upcoming public events (now .. +days), cached 15 minutes. Empty when the feed is unreachable: never an error. */
export async function villageEvents(days = 3, now = new Date()): Promise<VillageEvent[]> {
  try {
    const res = await fetch(FEED, { next: { revalidate: 900 }, signal: AbortSignal.timeout(5000) } as RequestInit);
    if (!res.ok) return [];
    return parseIcs(await res.text(), new Date(now.getTime() - 30 * 60_000), new Date(now.getTime() + days * DAY));
  } catch {
    return [];
  }
}
