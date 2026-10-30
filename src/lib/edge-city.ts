// Kismet is for Edge City India residents only (Deon, 2026-10-28): dating and friends for the people at the pop-up
// village, not an official Edge City product. Membership is self-attested ("Are you at Edge City India?"), asked once
// at sign-up (web chat, quiz, API, WhatsApp, apps) and once on the next visit for accounts from before; Agent Village
// sign-ups are residents by definition. Only members are dated, recommended, dropped or shown on the board; a "no"
// gets the waitlist. users.edge_city: true = member, false = said no, null = not asked yet (out of the pool).
// Pure and dependency-free (unit-tested directly).

export const EDGE_CITY = {
  name: "Edge City India",
  place: "Mandrem, Goa",
  dates: "Oct 11 - Nov 1 2026",
} as const;

/** The event's weeks (optional answer, informational only: matching never uses them). */
export const EDGE_WEEKS = [
  { id: "week1", label: "Week 1 (Oct 11-17)" },
  { id: "week2", label: "Week 2 (Oct 18-24)" },
  { id: "week3", label: "Week 3 (Oct 25 - Nov 1)" },
] as const;
export type EdgeWeek = (typeof EDGE_WEEKS)[number]["id"];
const WEEK_IDS = EDGE_WEEKS.map((w) => w.id) as string[];

/** In the pool: an Edge City member. Not asked yet (null) and "no" (false) are both out. */
export const inPool = (u: { edgeCity: boolean | null | undefined }) => u.edgeCity === true;

/** The question, for a new sign-up (the website's chat, WhatsApp). */
export const EDGE_QUESTION = `Are you at ${EDGE_CITY.name} (${EDGE_CITY.place}, ${EDGE_CITY.dates})? Kismet is only for residents right now. Reply YES or NO, and which weeks if you like (week 1, 2 or 3).`;
/** The same question, once, for an account from before Kismet became Edge City only. */
export const EDGE_QUESTION_EXISTING = `Quick one: Kismet is now just for ${EDGE_CITY.name} residents (${EDGE_CITY.place}). Are you at Edge City India? Reply YES or NO (and which weeks if you like: week 1, 2 or 3). Until you answer, your agent takes a break from meeting people.`;

/** The question for apps and agents (no "reply" wording: they show a card or ask in their own words). */
export const EDGE_QUESTION_PLAIN = `Are you at ${EDGE_CITY.name} (${EDGE_CITY.place}, ${EDGE_CITY.dates})? Kismet is only for its residents right now, so your agent takes a break from meeting people until you answer.`;
/** Why no dates start for an account that has not answered yet (every channel), with where to answer it. */
export const edgePendingText = (site: string) =>
  `Kismet is now just for ${EDGE_CITY.name} residents: answer "Are you at Edge City India?" first (at ${site}/home), and your agent gets back to meeting people.`;

/** The store apps (X-Kismet-Client "ios/…", "imessage/…", "android/…"). */
export const APP_CHANNELS: readonly string[] = ["ios", "imessage", "android"];

/**
 * users.edge_city for a new /api/signup account. An answer always wins (a "no" never gets this far: it is refused).
 * Left out: a member when it comes from a store app or is a real demo account (the server's demo key), else null (not
 * asked yet). App Store build 2 and App Review's fresh sign-ups never send the question and have nowhere to answer it
 * (the app has no card for it yet), so they would never be dated; the app is listed for Edge City residents, so a
 * sign-up from it counts as a yes, like Agent Village's. Agents and the website are still asked.
 */
export function signupEdgeCity(answer: boolean | undefined, channel: string, demo = false): boolean | null {
  if (answer !== undefined) return answer;
  return demo || APP_CHANNELS.includes(channel) ? true : null;
}

/** What someone who is not at Edge City hears: friendly, with the waitlist. */
export const edgeOnlyText = (site: string) =>
  `Thanks for telling me! Kismet is Edge City only for now: it makes intros between the people at ${EDGE_CITY.name} in ${EDGE_CITY.place}. Join the waitlist and we'll let you know when it opens up: ${site}/waitlist`;
/** The same, with a way back for someone who answered no by mistake. */
export const edgeOnlyAgainText = (site: string) => `${edgeOnlyText(site)} If you are at Edge City India after all, reply YES.`;

export const edgeWelcomeText = "Lovely, welcome! Your agent only meets other Edge City residents' agents.";

export type EdgeAnswer = { answer: "yes" | "no" | null; weeks: EdgeWeek[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
// A reply counts only when it is short and made of answer words alone: "Yes, weeks 2 and 3", "I'm here", "No, not this
// time". Anything else ("I am in Bangalore", "sure, what is it?", "I'm not sure", "I was there but left") is unclear,
// and is asked again: a wrong yes would let someone outside Edge City into the pool, a wrong no would take a resident out.
const YES_WORD = /^(y|yes|yeah|yea|yep|yup|ya|yas|sure|definitely|absolutely|certainly|correct|indeed)$/;
// "I'm in Mandrem" (or Goa) alone is unclear and asked again: being nearby is not being at Edge City India.
const PRESENT = /\b(i'm|i am|im)\s+(here|at edge|at edge city|a resident)\b|^(here|at edge city|at edge)\b/;
// Emoji answers: a thumbs up or a tick is a yes, a cross or a thumbs down a no (skin tones and variation selectors go
// with the other symbols). Both in one reply reads "yes no", which is unclear.
const EMOJI_YES = /\u{1F44D}|✅|✔|☑|\u{1F44C}|\u{1F64B}/gu;
const EMOJI_NO = /❌|❎|\u{1F44E}|✖|\u{1F6AB}/gu;
const NO_WORD = /^(n|no|nope|nah|not|never)$/;
const UNSURE = /\b(not sure|unsure|no idea|don't know|dont know|dunno|maybe|perhaps|not yet|soon|tomorrow|arriving|was there|were there|left|leaving|used to)\b/;
// Words a short answer may hold besides yes / no (weeks, "I'm here at Edge City India", "not this time, thanks").
const ANSWER_WORDS = new Set(("y yes yeah yea yep yup ya yas sure definitely absolutely certainly correct indeed of course n no nope nah not never " +
  "i i'm im am here at edge city india in mandrem goa a resident for the this that week weeks wk all three 3 two 2 one 1 " +
  "and to both whole entire full time event first 1st second 2nd third 3rd last final too also currently right now " +
  "thanks thank you sorry please only thing just").split(" "));
const ORDINAL: Record<string, string> = { first: "1", "1st": "1", one: "1", second: "2", "2nd": "2", two: "2", third: "3", "3rd": "3", three: "3", last: "3", final: "3" };

/** Weeks named in a reply: "week 2", "weeks 2 and 3", "the last week", "all three weeks", "the whole time". */
export function parseWeeks(text: string): EdgeWeek[] {
  const l = norm(text);
  if (/\b(all|every)\s+(the\s+)?((three|3)\s+)?weeks\b|\ball\s+(three|3)\b|\b(whole|entire|full)\s+(time|event|thing|(three|3)\s+weeks)\b/.test(l)) return [...WEEK_IDS] as EdgeWeek[];
  const found = new Set<string>();
  for (const m of l.matchAll(/\b(?:weeks?|wk)\s*((?:(?:[1-3]|one|two|three)\s*(?:,|&|\+|and|-|to)?\s*)+)/g)) {
    const nums = m[1].match(/[1-3]|one|two|three/g) ?? [];
    const range = /(?:-|to)/.test(m[1]) && nums.length === 2;
    const vals = nums.map((n) => ORDINAL[n] ?? n);
    if (range) for (let i = Number(vals[0]); i <= Number(vals[1]); i++) found.add(String(i));
    else vals.forEach((v) => found.add(v));
  }
  for (const m of l.matchAll(/\b(first|1st|second|2nd|third|3rd|last|final)\b(?:\s*(?:,|&|and)\s*(?:the\s*)?(first|1st|second|2nd|third|3rd|last|final))*\s*(?:(?:two|2)\s*)?weeks?\b/g)) {
    // A bare "last week" may mean the week before this one ("I came last week"): only "the last week" is week 3.
    if (m[0] === "last week" && !/\bthe\s*$/.test(l.slice(0, m.index))) continue;
    for (const w of m[0].match(/first|1st|second|2nd|third|3rd|last|final/g) ?? []) found.add(ORDINAL[w]);
    if (/\blast (?:two|2) weeks\b/.test(m[0])) ["2", "3"].forEach((v) => found.add(v));
    if (/\bfirst (?:two|2) weeks\b/.test(m[0])) ["1", "2"].forEach((v) => found.add(v));
  }
  // Digits right after a yes: "yes 2 and 3", "yep, 1 & 2".
  const after = /^(?:y|yes|yeah|yea|yep|yup|ya|sure)\b[\s,:-]*((?:[1-3]\s*(?:,|&|\+|and)?\s*)+)$/.exec(l);
  if (after) for (const n of after[1].match(/[1-3]/g) ?? []) found.add(n);
  return WEEK_IDS.filter((id) => found.has(id.slice(-1))) as EdgeWeek[];
}

/** A reply to "Are you at Edge City India?": yes, no or unclear (null), plus any weeks it names. */
export function parseEdgeAnswer(text: string): EdgeAnswer {
  const unclear: EdgeAnswer = { answer: null, weeks: [] };
  const l = norm(text.replace(EMOJI_YES, " yes ").replace(EMOJI_NO, " no ")).replace(/[^\p{L}\p{N}\s'?,&+;:()/.!-]/gu, " ").replace(/\s+/g, " ").trim().replace(/^[^a-z0-9]+/, "").replace(/[.!]+$/, "");
  if (!l || l.length > 80 || l.includes("?") || UNSURE.test(l)) return unclear;
  // "Definitely not", "absolutely not": the intensifier belongs to the no.
  const words = l.replace(/\b(definitely|absolutely|certainly) not\b/g, "not").replace(/[,&+;:()/.!-]/g, " ").split(" ").filter(Boolean);
  if (!words.every((w) => ANSWER_WORDS.has(w))) return unclear;
  const weeks = parseWeeks(l);
  // A no word anywhere is a no, unless the reply also says yes, "I'm here" or names weeks ("yes no", "I'm here, not all
  // weeks"): then it is unclear.
  // Also unclear: a no next to being here that is not itself negated ("no, at edge city", "not only here"); "no, not at
  // Edge City" and "I'm not here" stay a no.
  const here = /\b(here|at edge|edge city)\b/.test(l) && !/\b(not|no|never)\s+(?:i'm\s+|im\s+|i am\s+)?(?:at\s+|in\s+)?(?:here|edge)\b/.test(l);
  if (words.some((w) => NO_WORD.test(w))) return words.some((w) => YES_WORD.test(w)) || PRESENT.test(l) || here || weeks.length ? unclear : { answer: "no", weeks: [] };
  // A yes word first, "I'm here / at Edge City", or the weeks on their own ("week 2 and 3", "all three weeks").
  if (YES_WORD.test(words[0]) || /^of course\b/.test(l) || PRESENT.test(l)) return { answer: "yes", weeks };
  // Weeks alone are a yes ("week 2 and 3"), but not next to just a place ("I am in Mandrem for week 2": nearby, not said).
  if (weeks.length && !words.some((w) => w === "mandrem" || w === "goa")) return { answer: "yes", weeks };
  return unclear;
}

/** Weeks from an API body: ids or labels ("week2", "Week 2", 2); unknown values are dropped, never an error. */
export function normalizeWeeks(v: unknown): EdgeWeek[] | undefined {
  if (v === undefined || v === null) return undefined;
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [v];
  const out = new Set<string>();
  for (const x of list) {
    // A full label ("Week 2 (Oct 18-24)") counts by its week: dates in brackets after the week number go first.
    const s = String(x).toLowerCase().replace(/([1-3])\s*\(.*\)/g, "$1").replace(/[^a-z0-9]/g, "");
    const n = /^(?:week|wk|w)?([1-3])$/.exec(s)?.[1];
    if (n) out.add(`week${n}`);
  }
  return WEEK_IDS.filter((id) => out.has(id)) as EdgeWeek[];
}

/** edgeCity from an API body: true / false / "yes" / "no"; undefined when left out (or unreadable). */
export function normalizeEdgeCity(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return undefined;
  const a = parseEdgeAnswer(v).answer;
  return a === "yes" ? true : a === "no" ? false : /^true$/i.test(v.trim()) ? true : /^false$/i.test(v.trim()) ? false : undefined;
}

export const weeksText = (weeks: readonly string[]) =>
  weeks.length === 3 ? "all three weeks" : weeks.map((w) => `week ${w.slice(-1)}`).join(" and ");
