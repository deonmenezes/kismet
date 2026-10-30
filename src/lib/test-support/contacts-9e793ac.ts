// The stripContacts of 9e793ac (before the QA2 M3 rewrite), kept only for the differential test in contacts.test.mjs.
// Remove contact details (emails, links, phone numbers, handles) so they never reach other users.
const R = "[removed]";
const LABELS =
  "telegram|tg|instagram|insta|ig|twitter|x|whatsapp|wa|signal|discord|linkedin|snapchat|snap|tiktok|threads|bluesky|github|email|e-mail|phone|mobile|cell";
// Labels that almost never stand next to a handle-like word by chance ("x", "wa", "signal", "phone" do).
const APPS = "telegram|tg|instagram|insta|ig|twitter|whatsapp|discord|linkedin|snapchat|tiktok|github|bluesky";
// A handle-like word: starts with a letter or _, has an _ or two digits in a row, 5+ characters ("deex_99", "dee99"),
// and no version number like ".0", so "web3", "llama3", "web3.0", "3x" or "2019" never count.
const HANDLE = String.raw`(?=[A-Za-z_][\w.]*(?:_|\d\d))(?![\w.]*\.\d)[\w.]{5,}`;
const DOT = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*|\s+dot\s+)`;
const AT = String.raw`(?:\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*)`;

const PATTERNS: [RegExp, string][] = [
  // plain and lightly obfuscated emails: a@b.com, a [at] b [dot] com, a (at) b.com, a at b dot com
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, R],
  [new RegExp(String.raw`[\w.+-]+${AT}[\w-]+(?:(?:${DOT}|\.)[\w-]+)+`, "gi"), R],
  [new RegExp(String.raw`[\w.+-]+\s+at\s+[\w-]+(?:${DOT}[\w-]+)+`, "gi"), R],
  // t.me links, also written with spaces or "dot"
  [new RegExp(String.raw`\b(?:t|telegram)\s*(?:\.|${DOT})\s*me\s*/\s*@?\w+`, "gi"), R],
  // URLs and bare domains
  [/\b(?:https?:\/\/|www\.)\S+/gi, R],
  [/\b[\w-]+\.(?:com|io|xyz|me|org|net|co|in|app|dev|link|ly|so|gg|sh)(?:\/\S*)?(?=\s|$|[),.!?])/gi, R],
  // "telegram: dee_99", "tg - dee", "insta is dee.x", "x: @dee"
  [new RegExp(String.raw`\b(?:${LABELS})\b\s*(?:handle|username|user|id|account)?\s*(?::|=|-|–|—)\s*@?\s*[\w.]{2,}`, "gi"), R],
  [new RegExp(String.raw`\b(?:${LABELS})\b\s*(?:handle|username|user|id|account)?\s+is\s+(?:@\s*[\w.]{2,}|(?=[\w.]*[_0-9])[\w.]{3,})`, "gi"), R],
  // "my telegram handle deexmenezes", "insta username is deex": an explicit handle word, then any word
  [new RegExp(String.raw`\b(?:${APPS})\b\s+(?:handle|username|user\s?name)\s+(?:is\s+)?@?\s*[\w.]{3,}`, "gi"), R],
  // "insta deex_99", "tg deex99", "telegram at deex_99", "ping me on telegram @ deex_99": no punctuation, a handle-like word
  [new RegExp(String.raw`\b(?:${APPS})\b(?:\s+(?:on|at|@))?\s+@?${HANDLE}`, "gi"), R],
  // "deex_99 on telegram", "dee99 at insta", "deex_99 via tg"
  [new RegExp(String.raw`(?<![\w.@])${HANDLE}\s+(?:on|at|via)\s+(?:${APPS})\b`, "gi"), R],
  // phone numbers (9+ digits with separators)
  [/\+?\d(?:[\s().-]*\d){8,}/g, R],
  // @handles, also "@ dee_x" with a space when the handle looks like one (has _ or a digit)
  [/(^|[\s(])@[A-Za-z0-9_.]{3,}/g, `$1${R}`],
  [/(^|[\s(])@\s+(?=[A-Za-z][A-Za-z0-9_.]*[_0-9])[A-Za-z][A-Za-z0-9_.]{2,}/g, `$1${R}`],
];

export function stripContacts(text: string): string {
  return PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), text);
}

// Words that appear in agent names ("Asha's agent") but are not names.
const COMMON = new Set(["agent", "the", "and", "bot", "her", "his", "their", "mrs"]);

/** Anonymizes a public line: every word (3+ characters) of the given names, any case, becomes "someone" (or `by`). */
export function withoutNames(text: string, names: (string | null | undefined)[], by = "someone"): string {
  const words = [...new Set(names.flatMap((n) => (n ?? "").split(/[^\p{L}\p{N}_]+/u)).filter((w) => w.length >= 3 && !COMMON.has(w.toLowerCase())))];
  if (!words.length) return text;
  words.sort((a, b) => b.length - a.length); // name words hold only letters, digits and _: no escaping needed
  // A custom `by` starts with a capital at the start of a sentence ("Your match sounds great"); "someone" stays as is.
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.join("|")})(?![\\p{L}\\p{N}_])`, "giu"), (_m, at: number) =>
    by !== "someone" && /(^|[.!?]\s+)$/.test(text.slice(0, at)) ? by[0].toUpperCase() + by.slice(1) : by);
}
