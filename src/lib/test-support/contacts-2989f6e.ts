// stripContacts as of 2989f6e (production before QA3), for the regression test in contacts.test.mjs: every form it removed
// with a plain handle must still be removed. Do not edit.
// Remove contact details (emails, links, phone numbers, handles) so they never reach other users.
//
// Matching runs on a folded copy of the text (QA2 M3: 96 forms got past the old patterns): NFKC (full-width letters,
// digits, "＠" and "："), Cyrillic and Greek lookalike letters as Latin (lib/fold.ts), other scripts' digits as 0-9,
// zero-width characters and emoji variation selectors gone, spaced-out letters joined ("t e l e g r a m", "d-e-e-x-y")
// and spelled-out digits in a long run ("nine eight seven ...") as digits. Every folded character remembers where it
// came from, so what is removed is the original text, and everything else stays exactly as written.
import { LOOKALIKE_MAP } from "../fold.ts";

const R = "[removed]";

// ---- Folding ----------------------------------------------------------------------------------------------------

type Folded = { f: string; s: number[]; e: number[] };
const DROP = /[­͏؜ᅟᅠ឴឵᠋-᠏\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-⁯ㅤ︀-️\ufeffﾠ]/;
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x1040, 0xff10];
const digitOf = (c: number) => {
  for (const b of DIGIT_BLOCKS) if (c >= b && c <= b + 9) return String(c - b);
  return null;
};
const NUMBER_WORDS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };

function fold(text: string): Folded {
  let chars: { c: string; s: number; e: number }[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const end = i + ch.length;
    if (!DROP.test(ch)) {
      const d = digitOf(cp);
      const out = d ?? [...ch.normalize("NFKC")].map((x) => LOOKALIKE_MAP[x] ?? x).join("").toLowerCase();
      for (let k = 0; k < out.length; k++) chars.push({ c: out[k], s: i, e: end }); // UTF-16 units: f and s/e stay aligned
    }
    i = end;
  }
  // A run of whitespace folds to its first character: no pattern needs more, and lookbehinds stay linear on long runs.
  chars = chars.filter((x, k) => !(/\s/.test(x.c) && k > 0 && /\s/.test(chars[k - 1].c)));
  const str = () => chars.map((x) => x.c).join("");
  // Spaced-out letters, 4 or more ("t e l e g r a m", "d-e-e-x-y", "i.n.s.t.a"): the separators go.
  let f = str();
  const keep = new Array(chars.length).fill(true);
  for (const m of f.matchAll(/(?<![a-z0-9])[a-z0-9](?:[ .\-][a-z0-9](?![a-z0-9])){3,}/g)) {
    for (let k = m.index!; k < m.index! + m[0].length; k++) if (/[ .\-]/.test(f[k])) keep[k] = false;
  }
  chars = chars.filter((_, k) => keep[k]);
  // Spelled-out digits in a run that makes a phone number (9+ digits with at least one word): words become digits.
  f = str();
  const next: typeof chars = [];
  const copy = (from: number, to: number) => {
    for (let k = from; k < to; k++) next.push(chars[k]);
  };
  let last = 0;
  const WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
  for (const m of f.matchAll(new RegExp(String.raw`(?<![a-z0-9])(?:(?:${WORD}|\d+)(?:[\s,.\-]+|$)){3,}`, "g"))) {
    const toks = [...m[0].matchAll(new RegExp(String.raw`${WORD}|\d+`, "g"))];
    const digits = toks.reduce((n, t) => n + (NUMBER_WORDS[t[0]] ? 1 : t[0].length), 0);
    if (digits < 9 || !toks.some((t) => NUMBER_WORDS[t[0]])) continue;
    copy(last, m.index!);
    let at = m.index!;
    for (const t of toks) {
      const start = m.index! + t.index!;
      copy(at, start);
      if (NUMBER_WORDS[t[0]]) next.push({ c: NUMBER_WORDS[t[0]], s: chars[start].s, e: chars[start + t[0].length - 1].e });
      else copy(start, start + t[0].length);
      at = start + t[0].length;
    }
    copy(at, m.index! + m[0].length);
    last = m.index! + m[0].length;
  }
  copy(last, chars.length);
  chars = next;
  return { f: str(), s: chars.map((x) => x.s), e: chars.map((x) => x.e) };
}

// ---- What a contact looks like -----------------------------------------------------------------------------------

// Labels of contact apps and channels. APPS: names that rarely stand right before an ordinary word that is not about the
// app ("telegram bots" is handled by COMMON below); the rest ("x", "signal", "phone"...) need a separator or a handle.
const APPS = "telegram|telegrm|teleg|tg|instagram|insta|ig|snapchat|tiktok|discord|linkedin|github|bluesky|bsky|twitter|whatsapp";
// Labels that are also ordinary words ("Mostly on X, building agents", "Signal, noise", "tele-health", "mail-order",
// "snap decisions", "I sew threads"): after them only ":", "=" or an arrow, "is", or a strong handle counts.
const AMBIG = "x|wa|signal|mail|phone|mobile|cell|tele|gram|snap|threads";
const CLEAR = `${APPS}|email|e-mail|whats\\s?app`;
const LABELS = `${CLEAR}|${AMBIG}`;
// Emoji labels: camera, plane (Telegram), phone, telephone, envelope, speech bubble.
const EMOJI = "\u{1F4F8}|\u{1F4F7}|✈|\u{1F4F1}|☎|\u{1F4DE}|✉|\u{1F4E7}|\u{1F4E9}|\u{1F4AC}";
// A handle-like token (folded): letters, digits, _ . # - ; a "strong" one has an _, a #, two digits in a row or a
// letter.letter part, and is no version number (web3.0, llama3 and 2019 never count).
const TOKEN = String.raw`@?[a-z0-9_][a-z0-9_.#\-]*[a-z0-9_#]`;
const STRONG = String.raw`@?(?=[a-z_][a-z0-9_.#\-]*(?:_|#|\d\d|[a-z]\.[a-z0-9]))(?![a-z]+\d+\.\d)[a-z_][a-z0-9_.#\-]{2,}[a-z0-9_]`;

// Ordinary words that follow an app name, "is", "@" or "on" in normal bios, never a handle.
const COMMON = new Set(`a an the and or but nor so yet for of to in on at by from with without about after before since until during
  as is are was were be been being am do does did have has had will would can could should may might must shall
  i me my mine you your yours he him his she her hers it its we us our ours they them their theirs this that these those
  who whom whose which what where when why how here there then than too very just also only even still ever never always
  not no yes all any some every each both few more most less least much many other another such same own lot lots
  one two three four five six seven eight nine ten first second third last next new old good great best better bad worse
  worst big small fun funny cool nice fine okay ok love like likes loved hate hates dead alive overrated underrated
  boring fav fave favourite favorite thing things stuff way ways time times day days week weeks year years
  bot bots channel channels group groups chat chats sticker stickers reel reels story stories post posts feed feeds
  page pages profile profiles account accounts app apps web desktop mobile version premium live video videos photo photos
  pic pics picture pictures dance dances repo repos copilot actions server servers mod mods community communities
  influencer influencers creator creators famous addict addicted addiction detox break breaks ads ad marketing growth
  content followers following follow followed likes trend trends trending meme memes filter filters link links handle
  handles username usernames name names user users id ids number numbers mail email emails message messages dm dms
  call calls voice notes note please pls thanks thank god friday weekend weekends night nights morning evening sunset
  sunrise dawn dusk noon midnight work home office school college beach sea ocean goa mandrem cafe bar party parties
  worthy always often sometimes usually mostly rarely now later soon today tonight tomorrow yesterday
  silent silence off down private public open closed full empty broken banned blocked deleted inactive active free
  someone anyone everyone nobody people person friend friends cofounder co-founder founder founders partner wife husband
  girlfriend boyfriend team teams job jobs startup startups company project projects side business clone api data
  telegram instagram insta ig gram snapchat snap tiktok discord linkedin github bluesky twitter whatsapp threads signal
  x wa phone cell facebook fb youtube reddit hackernews substack medium art arts doodles drawings sketches music food
  travel photography poetry poems writing recipes tips thoughts rants takes updates design designs code builds talks
  drama streaks lunatics node js ts py next react vue deno edge city pizza agent agents builder builders`.split(/\s+/).filter(Boolean));
/** A strong-looking token made of ordinary words and numbers ("reels_2024", "bots_and_agents", "node.js"): not a handle. */
const compound = (t: string) => t.replace(/^@/, "").split(/[_.\-]+/).filter(Boolean).every((w) => COMMON.has(w) || /^\d+$/.test(w));
const common = (t: string) => COMMON.has(t.replace(/^@/, "")) || /^(?:\d+|\d+(?:st|nd|rd|th|x|k|am|pm|s))$/.test(t.replace(/^@/, ""));

// ---- The patterns ------------------------------------------------------------------------------------------------

type Pattern = { re: RegExp; ok?: (m: RegExpExecArray, f: string) => boolean };
const DOT = String.raw`(?:\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}|<\s*dot\s*>)\s*|\s+dot\s+)`;
const AT = String.raw`(?:\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}|<\s*at\s*>)\s*)`;
const MAIL_HOSTS = "gmail|googlemail|yahoo|ymail|hotmail|outlook|proton|protonmail|icloud|aol|zoho|gmx|yandex|rediffmail";
const TLD = "com|io|xyz|me|org|net|co|in|app|dev|link|ly|so|gg|sh|ee|social|page|site|bio|ai|to|cc|tv|fm|world|club";
// Where a handle is over: the end, punctuation or a line break (so "telegram groups are chaos" never counts).
const ENDS = String.raw`(?=\s*(?:$|[,.;:!?()\[\]{}"'<>|/\n·•]|\s[-–—]\s))`;
// Separators between a label and its handle: ":", "=", "-", "|", "/", "~", ">", "»", "→", "=>", "->", ",", "(", "[", quotes.
const SEP = String.raw`\s*(?:[:=|/~>»→,(\[{"'\-–—]|=>|->|-->|::)+\s*`;
const SEP_STRICT = String.raw`\s*(?:[:=→]|=>|->|-->|::)+\s*`;
// The start of a clause: the start, punctuation, or a word that asks for a handle ("find me", "is", "i'm").
const startOfClause = String.raw`(?:^|[(\[{"',.;:!?|/\-–—]\s*|\b(?:me|find|add|follow|message|dm|ping|is|i'?m|as)\s+)`;
const tokenOk = (t: string) => t.replace(/^@/, "").length >= 3 && !common(t) && !/^[a-z]+\d+\.\d/.test(t.replace(/^@/, ""));
// Chat and social apps (a word before "on GitHub" is usually a project: "llama3 on GitHub").
const SOCIAL = "telegram|telegrm|teleg|tele|tg|instagram|insta|ig|gram|snapchat|snap|tiktok|discord|linkedin|bluesky|bsky|twitter|whatsapp|threads";

const PATTERNS: Pattern[] = [
  // Emails: a@b.com, "a @ b . com", a [at] b [dot] com, a <at> b <dot> com, a at b dot com, "dee at gmail".
  // Each starts at the start of a word only (?<!...): a long run of letters is tried once, never at every position.
  { re: /(?<![\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+/g },
  { re: new RegExp(String.raw`(?<![\w.+-])[\w.+-]+\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)*\s*\.\s*(?:${TLD})\b`, "g") },
  { re: new RegExp(String.raw`(?<![\w.+-])[\w.+-]+${AT}[\w-]+(?:(?:${DOT}|\.)[\w-]+)+`, "g") },
  { re: new RegExp(String.raw`(?<![\w.+-])[\w.+-]+\s+at\s+[\w-]+(?:${DOT}[\w-]+)+`, "g") },
  { re: new RegExp(String.raw`(?<![\w.@])([\w.+-]+)\s+(?:at|on|@)\s+(?:${MAIL_HOSTS})\b(?:\s*(?:\.|dot)\s*com)?`, "g"), ok: (m) => tokenOk(m[1]) },
  // t.me links, also with spaces, "dot" and "slash"; "instagram dot com slash deexy".
  { re: new RegExp(String.raw`\b(?:t|telegram)\s*(?:\.|${DOT})\s*me\s*(?:/|slash)\s*@?\w+`, "g") },
  { re: new RegExp(String.raw`\b(?:${APPS}|x|linktr)\s*(?:\.|${DOT})\s*(?:com|me|ee)\s*(?:/|slash)\s*(?:in\s*/\s*)?@?[\w.\-]+`, "g") },
  // URLs and bare domains (also several levels: deexy.bsky.social, deexy.carrd.co), and "deexy dot com" / "deexy . com".
  { re: /\b(?:https?:\/\/|www\.)\S+/g },
  { re: new RegExp(String.raw`\b[\w-]+(?:\.[\w-]+)*\.(?:${TLD})(?:/\S*)?(?=\s|$|[),.!?])`, "g") },
  { re: new RegExp(String.raw`(?<![\w.])([\w-]{3,})(?:\s+dot\s+|\s+\.\s*|\s*\.\s+)(?:com|net|org|io|xyz)\b`, "g"), ok: (m) => tokenOk(m[1]) },
  // Handle words: "my handle everywhere is deex_99", "same handle as my name, deex_99 everywhere".
  { re: new RegExp(String.raw`\b(?:handle|username|user\s?name|user\s?id|tag)s?\b[^.!?\n]{0,40}?(?:\bis\b|:|,|=)\s*${STRONG}`, "g") },
  // A label, a separator, then a handle: "telegram: deexy", "tg → deexy", "telegram, deex_99", "insta - deexy",
  // "telegram (deexy)", "telegram 'deex_99'", "x: @dee", "📸: deexy". Never an ordinary word ("phone: always on silent").
  { re: new RegExp(String.raw`(?:\b(?:${CLEAR})\b|${EMOJI})(?:'s)?\s*(?:handle|username|user\s?name|user|id|account|acc)?${SEP}(${TOKEN})`, "g"), ok: (m) => tokenOk(m[1]) },
  { re: new RegExp(String.raw`\b(?:${AMBIG})\b(?:'s)?\s*(?:handle|username|user\s?name|user|id|account|acc)?${SEP_STRICT}(${TOKEN})`, "g"), ok: (m) => tokenOk(m[1]) },
  // A label then a strong handle, wherever the sentence goes on: "telegram deex_99 for collabs", "my tg id is dee_x
  // thanks", "telegram. deex_99", "telegram @ deex_99", "on x as deex_99", "signal me deex_99", "📸 deex_99". Never
  // ordinary words joined up ("ig reels_2024 fan").
  { re: new RegExp(String.raw`(?:\b(?:${LABELS})\b|${EMOJI})(?:'s)?(?:\s+(?:handle|username|user\s?name|id|account))?(?:\s+is\b|${SEP}|\s*\.|\s+at\b|\s*@|\s+as\b|\s+me\b(?:\s+on\b)?)?\s*(${STRONG})`, "g"),
    ok: (m) => !compound(m[1]) },
  // "add me on snap deexy": an ambiguous app name with a word that ends there, right after "on".
  { re: new RegExp(String.raw`\bon\s+(?:the\s+)?(?:${AMBIG})\s+(${TOKEN})${ENDS}`, "g"), ok: (m) => tokenOk(m[1]) },
  { re: new RegExp(String.raw`\b(?:${APPS})\b\s*(?:\bat\b|@)\s*(${TOKEN})`, "g"), ok: (m) => tokenOk(m[1]) },
  // "my ig is deexy", "ig is deexy", "insta's deexy", "insta username is deexy": label + is + a word that ends there.
  { re: new RegExp(String.raw`\b(?:${LABELS})\b(?:'s|\s+(?:handle|username|user\s?name|id|account)?\s*is)\s+(${TOKEN})${ENDS}`, "g"), ok: (m) => tokenOk(m[1]) },
  { re: new RegExp(String.raw`\b(?:${APPS})\b\s+(?:handle|username|user\s?name)\s+(?:is\s+)?(${TOKEN})`, "g"), ok: (m) => tokenOk(m[1]) },
  // An app name then a word that ends there: "tg deexy", "insta deexmenezes", "add me on snap deexy", "insta deexy (dm me)".
  { re: new RegExp(String.raw`\b(?:${APPS})\b\s+(${TOKEN})${ENDS}`, "g"), ok: (m) => tokenOk(m[1]) },
  // A handle, then the app: "deex_99 on telegram", "deex_99 (tg)", "deex_99 - telegram", "deex#1234 on discord".
  { re: new RegExp(String.raw`(?<![\w.@#\-])(${STRONG})\s*(?:\(|\bon\b|\bat\b|\bvia\b|@|[-–—|])\s*(?:the\s+)?(?:${APPS}|gram|snap|tele|threads)\b\)?`, "g"),
    ok: (m) => !compound(m[1]) },
  // A plain word, then the app, at the start of a clause ("deexy on insta"; never "my cofounder on Twitter").
  { re: new RegExp(String.raw`(?<=${startOfClause})(${TOKEN})\s+(?:on|at|via)\s+(?:the\s+)?(?:${SOCIAL})\b`, "g"),
    ok: (m) => tokenOk(m[1]) && !/(?:ing|ed)$/.test(m[1]) },
  // "dm me deex_99", "dms open: deex_99", "search deex_99", "I'm deex_99 on most apps", "deex_99 everywhere".
  // Only the handle goes ("Find me [removed] everywhere"), never the words before it.
  { re: new RegExp(String.raw`(?<=\b(?:dm|dms|msg|message|text|ping|add|follow|search|find|i'?m|i\s+am)\b(?:\s+me)?(?:\s+open)?\s*[:\-]?\s*)(${STRONG})`, "g"),
    ok: (m) => !compound(m[1]) },
  { re: new RegExp(String.raw`(?<![a-z0-9_.#\-@])${STRONG}(?=\s+(?:everywhere|on\s+(?:most|all|every|any)\s+(?:apps?|socials?|platforms?)))`, "g") },
  // Phone numbers: 9+ digits with separators (spaces, dots, dashes, brackets, underscores).
  { re: /\+?\d(?:[\s().\-_]*\d){8,}/g },
  // @handles, also "@ dee_x" with a space when it looks like one, and "find me @ deexy".
  { re: /(?<=^|[\s(])@[a-z0-9_.]{3,}/g },
  { re: /(?<=^|[\s(])@\s+(?=[a-z][a-z0-9_.]*[_0-9])[a-z][a-z0-9_.]{2,}/g },
  { re: new RegExp(String.raw`(?<=\bme\s+)@\s*(${TOKEN})`, "g"), ok: (m) => tokenOk(m[1]) },
];

/** Every span of the text (original positions) that `p` matches on its folded copy. */
function spans({ f, s, e }: Folded, p: Pattern) {
  const out: [number, number][] = [];
  p.re.lastIndex = 0;
  for (let m = p.re.exec(f); m; m = p.re.exec(f)) {
    if (!m[0].length) {
      p.re.lastIndex++;
      continue;
    }
    if (p.ok && !p.ok(m, f)) {
      p.re.lastIndex = m.index + 1; // try the next start (a later, real handle on the same line)
      continue;
    }
    out.push([s[m.index], e[m.index + m[0].length - 1]]);
  }
  return out;
}

// While the patterns run, a removed span is one private-use character (no pattern matches it), so a later pattern never
// takes part of an earlier "[removed]" ("my [removed]]"); it becomes "[removed]" at the end.
const MARK = "\uE000";

export function stripContacts(text: string): string {
  let out = text.replaceAll(MARK, "");
  let folded = fold(out);
  for (const p of PATTERNS) {
    const found = spans(folded, p);
    if (!found.length) continue;
    for (let k = found.length - 1; k >= 0; k--) out = out.slice(0, found[k][0]) + MARK + out.slice(found[k][1]);
    folded = fold(out); // folded again only when something went
  }
  return out.replaceAll(MARK, R);
}

// Words that appear in agent names ("Asha's agent") but are not names.
const NOT_NAMES = new Set(["agent", "the", "and", "bot", "her", "his", "their", "mrs"]);

/** Anonymizes a public line: every word (3+ characters) of the given names, any case, becomes "someone" (or `by`). */
export function withoutNames(text: string, names: (string | null | undefined)[], by = "someone"): string {
  const words = [...new Set(names.flatMap((n) => (n ?? "").split(/[^\p{L}\p{N}_]+/u)).filter((w) => w.length >= 3 && !NOT_NAMES.has(w.toLowerCase())))];
  if (!words.length) return text;
  words.sort((a, b) => b.length - a.length); // name words hold only letters, digits and _: no escaping needed
  // A custom `by` starts with a capital at the start of a sentence ("Your match sounds great"); "someone" stays as is.
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.join("|")})(?![\\p{L}\\p{N}_])`, "giu"), (_m, at: number) =>
    by !== "someone" && /(^|[.!?]\s+)$/.test(text.slice(0, at)) ? by[0].toUpperCase() + by.slice(1) : by);
}
