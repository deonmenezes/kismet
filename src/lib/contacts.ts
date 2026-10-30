// Remove contact details (emails, links, phone numbers, handles) so they never reach other users.
//
// Matching runs on a folded copy of the text (QA2 M3: 96 forms got past the old patterns): NFKC (full-width letters,
// digits, "＠" and "："), Cyrillic and Greek lookalike letters as Latin (lib/fold.ts), other scripts' digits as 0-9,
// zero-width characters and emoji variation selectors gone, spaced-out letters joined ("t e l e g r a m", "d-e-e-x-y")
// and spelled-out digits in a long run ("nine eight seven ...") as digits. Every folded character remembers where it
// came from, so what is removed is the original text, and everything else stays exactly as written.
import { isChatWord, isCommonWord, isDescribing, isNameWord, isRole, isWord } from "./common-words.ts";
import { LOOKALIKE_MAP } from "./fold.ts";
import { INTEREST_CHIPS } from "./options.ts";

const R = "[removed]";
// While the patterns run, a removed span is one private-use character (no pattern matches it), so a later pattern never
// takes part of an earlier "[removed]" ("my [removed]]"); it becomes "[removed]" at the end.
const MARK = "\uE000";

// ---- Folding ----------------------------------------------------------------------------------------------------

type Folded = { f: string; s: number[]; e: number[] };
const DROP = /[­͏؜ᅟᅠ឴឵᠋-᠏\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-⁯ㅤ︀-️\ufeffﾠ]/;
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x1040, 0xff10];
const digitOf = (c: number) => {
  for (const b of DIGIT_BLOCKS) if (c >= b && c <= b + 9) return String(c - b);
  return null;
};
const NUMBER_WORDS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
// Small capitals, which NFKC leaves alone (QA4: "ɪɢ deexy").
const SMALL_CAPS: Record<string, string> = Object.fromEntries([..."ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ"].map((c, k) => [c, "abcdefghijklmnopqrstuvwxyz"[k]]));
// Dotted app abbreviations (QA4: "I.G. deexy"): "i.g.", "t. g.", "w.a." fold to the label.
const DOTTED = /(?<![a-z0-9.])([itw])\.\s?([ga])\.?(?![a-z0-9])/g;
const DOTTED_LABELS = new Set(["ig", "tg", "wa"]);

function fold(text: string): Folded {
  let chars: { c: string; s: number; e: number }[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const end = i + ch.length;
    if (!DROP.test(ch)) {
      const d = digitOf(cp);
      const out = d ?? [...ch.normalize("NFKC")].map((x) => LOOKALIKE_MAP[x] ?? SMALL_CAPS[x] ?? x).join("").toLowerCase();
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
  for (const m of f.matchAll(DOTTED)) {
    if (!DOTTED_LABELS.has(m[1] + m[2])) continue;
    // Initials stay initials after a title ("Dr. T. G. Krishnan", "Prof. I.G. Patel") and, for T.G. / W.A., before a
    // capitalised name ("my dad T.G. Menon"); "I.G. Deexy" is Instagram (QA4 review).
    if (/\b(?:dr|prof|mr|mrs|ms|shri|sri|smt|sir|justice)\.?\s*$/.test(f.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    let after = m.index! + m[0].length;
    while (after < f.length && /\s/.test(f[after])) after++;
    if (m[1] !== "i" && after < f.length && /\p{Lu}/u.test(text[chars[after].s])) continue;
    for (let k = m.index! + 1; k < m.index! + m[0].length; k++) if (/[ .]/.test(f[k])) keep[k] = false;
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
// (Never part of a word with accented letters, checked once where it starts and only 64 letters ahead, so runs stay linear:
// "insta: andré", "tg: rohän" stay whole.)
const TOKEN = String.raw`@?(?![a-z0-9_.#\-]{0,64}[\u00c0-\u024f\u0300-\u036f\u1e00-\u1eff])[a-z0-9_][a-z0-9_.#\-]*[a-z0-9_#]`;
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
  drama streaks lunatics node js ts py next react vue deno edge city pizza agent agents builder builders status`.split(/\s+/).filter(Boolean));
/** A strong-looking token made of ordinary words and numbers ("reels_2024", "bots_and_agents", "node.js"): not a handle. */
const compound = (t: string) => t.replace(/^@/, "").split(/[_.\-]+/).filter(Boolean).every((w) => COMMON.has(w) || /^\d+$/.test(w));
const common = (t: string) => COMMON.has(t.replace(/^@/, "")) || /^(?:\d+|\d+(?:st|nd|rd|th|x|k|am|pm|s)|\d+x\d+)$/.test(t.replace(/^@/, ""));

// QA3 N3-M1: a handle with no digit or "_" ("deexy") in the middle of a sentence looks like any other word, so a plain
// word before "on insta" / "(tg)" counts only when it isn't an ordinary bio word: a role, an activity, a place, an
// adverb (BIO_WORDS), a plural or a word with a common ending (WORDY), the object of a verb or of "a/my/the ..." (NOT_AFTER).
const BIO_WORDS = new Set(`engineer engineers designer developer devs founder ceo cto coo cmo cpo vp pm pms swe sde sre eng intern lead head
  manager mod moderator admin ambassador researcher scientist teacher coach chef cook writer poet artist painter photographer
  dj mc host maker hacker creator yogi nomad hippie hippy foodie techie newbie nerd geek junkie fan lover addict mom mum dad
  parent human soul introvert extrovert ambivert surfer climber runner diver skater rider student phd doctor nurse lawyer
  banker trader investor vc angel consultant volunteer organiser organizer curator dancer singer drummer musician producer
  yoga surf art music food chess poetry dance tech crypto ai web3 coffee chai travel film comedy standup design fashion
  nature wildlife meditation breathwork kirtan bjj boxing football cricket club life rsvp booking order delivery pickup info
  contact support news merch jewellery jewelry pottery ceramics meetup hackathon dinner lunch breakfast coworking
  india mandrem anjuna vagator arambol morjim ashwem assagao panjim panaji mapusa siolim candolim calangute baga palolem
  agonda chapora parra aldona pernem hampi bangalore bengaluru mumbai delhi pune berlin london lisbon bali
  barely hardly rarely mostly mainly occasionally constantly usually formerly previously currently actually literally
  basically daily weekly monthly nightly lately really totally early likely well anytime anywhere whenever maybe
  quiet shy lurker slow available reachable around offline online myself yourself himself herself themselves usual
  same identical similar simple easy obvious long short real ex irl asleep awake there out back away tennis focus status campus genius
  welcome taken pending painting sketch recipe meme vlog essay print clip reel rant come go say hit send drop ask see meet join
  check catch grab joke vibe game tune ride bike hike wave smile tale quote line place idea coder baker reader thinker dreamer
  tinkerer gardener listener question`.split(/\s+/).filter(Boolean));
// A plural: a consonant then "s" ("details", "comics", "prints") or "-ies" ("veggies"). Not a vowel then "s", which names
// end in too (james, jules, lucas, carlos, chris, marcus, menezes); plurals like that are mostly in the word lists.
const PLURAL = /(?:[^aeiou's]s|ies)$/;
const WORDY = new RegExp(String.raw`(?:ing|ed|er|ers|or|ors|ist|ists|ian|ians|ous|ive|ness|ment|ism|ity|ics|ogy)$|${PLURAL.source}`);
const TECH = /^(?:web\d|gpt-?\d\w*|llama\d|f1|m\d|ps\d|b2[bc]|p2p|3d|4k|mp[34]|covid-?19|y2k|h2o|k8s|s3|ec2|e2e)$/;
// Technical words and chips that look like handles: "d3.js", "socket.io", "a11y", "i18n".
const TECH_CHIP = /\.(?:js|io|ts|py|rs|go|net)$|^[a-z]\d{1,2}[a-z]$/;
const listed = (w: string) => COMMON.has(w) || BIO_WORDS.has(w);
const bioWord = (w: string) => listed(w) || (/s$/.test(w) && listed(w.slice(0, -1))) || (/es$/.test(w) && listed(w.slice(0, -2)));
/** An ordinary word or a compound of them ("ex-snap", "node.js", "reels_2024"): never a handle. */
const ordinary = (t: string) => {
  const w = t.replace(/^@/, "");
  return TECH.test(w) || w.split(/[_.\-]+/).filter(Boolean).every((x) => bioWord(x) || /^\d+$/.test(x));
};
/** A plain word that may be a handle: not common, not an ordinary bio word (a role, a place, a plural...). */
const weakWord = (t: string, ok = wordOk) => {
  const w = t.replace(/^@/, "");
  if (!ok(w) || ordinary(w)) return false;
  // (A name that ends like a past form, "ahmed", "javed", is no word of the language: QA4 review.)
  return /\d/.test(w) || !WORDY.test(w) || (/ed$/.test(w) && !isCommonWord(w));
};
/**
 * Looser, where the words around already ask for a handle: only listed words and gerunds or past forms are ordinary
 * there. A plural is not ruled out by its ending ("williams", "lars" are names); a listed word's plural is ("sunsets").
 */
const askedWord = (t: string) => {
  const w = t.replace(/^@/, "");
  return tokenOk(w) && !ordinary(w) && (/\d/.test(w) || !/(?:ing|ings|ed)$/.test(w) || !isCommonWord(w)); // "ping mohammed on insta"
};
// The patterns below that look back (lead-ins, NOT_AFTER) only look this far: the longest phrase is under 50 characters,
// and a bounded window keeps every pattern linear on long texts (a whole-prefix lookback made 200k characters take 7 s).
const BACK = 60;
const before = (f: string, at: number) => f.slice(Math.max(0, at - BACK), at);
// Words asking for a handle: a word after them is a handle whatever it looks like ("hit me up deexy on insta").
const LEAD_IN = String.raw`\b(?:hit\s+me\s+up|hmu|msg|message|text|say\s+(?:hi|hello|hey)(?:\s+to)?|dms?|ping|search(?:\s+for)?|add|find|catch|reach|follow|look\s+(?:me\s+)?up|check\s+out)(?:\s+me)?(?:\s+(?:at|on|as|@|up))?\s*[:\-,]?\s*$`;
const leadIn = new RegExp(LEAD_IN);
// A word right after these, or after "a/my/the" and up to two more words, is the object of a sentence, not a handle
// ("I sell jewellery on insta", "running a web3 meetup on telegram", "photos of Anjuna on insta").
const NOT_AFTER = new RegExp(String.raw`(?:\b(?:a|an|the|my|our|your|his|her|their|some|more|few|many|lots\s+of|daily|weekly|new|old|best|latest)\s+(?:[a-z0-9'’\-]+\s+){0,2}|\b(?:of|in|from|about|for|with|into|to|by|ex|formerly|previously|worked|work|works|was|were|am|is|are|be|sell|sells|post|posts|share|shares|run|runs|make|makes|do|does|host|hosts|write|writes|teach|teaches|build|builds|organi[sz]e|organi[sz]es|start|starts|started|launch|launched|create|creates|created|document|stream|streams|upload|uploads|publish|publishes|read|reads|watch|watches|love|loves|like|likes|hate|hates|also|just|only|mostly)\s+)$`);
/** A plain word before "on <app>" / "(<app>)": a handle after a lead-in, else only if it looks like one where it stands. */
const weakHandleOk = (tok: string, prev: string, sure = false) =>
  leadIn.test(prev) ? askedWord(tok) : weakWord(tok, sure ? sepWordOk : wordOk) && !NOT_AFTER.test(prev);

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
const leadWord = /\b(?:me|find|add|follow|message|dm|ping|is|i'?m|as)\s+$/;
const strongRe = new RegExp(String.raw`^${STRONG}$`);
const isStrong = (t: string) => strongRe.test(t) && !compound(t);
const endsRe = new RegExp(String.raw`^${ENDS}`);
const ends = (f: string, at: number) => endsRe.test(f.slice(at));
// Words that close a handle as well as punctuation does ("insta, ahmed for collabs", "deexy on insta, ted on tg").
const closerRe = /^\s+(?:(?:for|lol|or|and|on|via|btw|pls|please|hmu|anytime)\b|&)/;
const closed = (f: string, at: number) => ends(f, at) || closerRe.test(f.slice(at, at + 12));
// The same, but not "on"/"via", after which a gerund is a sentence going on ("Lurking on tg, posting on insta").
const closedHard = (f: string, at: number) => ends(f, at) || (closerRe.test(f.slice(at, at + 12)) && !/^\s+(?:on|via)\b/.test(f.slice(at, at + 6)));
// Right after "<app>," a word ending in "-ed" is the next contact in a list ("deexy on insta, ted on tg"), not a verb.
const appComma = new RegExp(String.raw`\b(?:${APPS})\s*,\s*$`);
// (Q5-L1: "ex-<word>" is a former job, never a handle: "Ex-Instagram, ex-Meta".)
const tokenOk = (t: string) => t.replace(/^@/, "").length >= 3 && !common(t) && !/^[a-z]+\d+\.\d/.test(t.replace(/^@/, "")) && !/^@?ex-/.test(t);
// QA4: how much an ordinary English word (lib/common-words.ts) counts as a word depends on how sure the text is that a
// handle comes. Where only an app name is next to it ("sends WhatsApp forwards", "Always on WhatsApp, sorry", "Pottery
// on insta"), any English word is a word: `wordOk`. Where a separator, "is" or a lead-in says "handle" ("telegram: chai",
// "my ig is sunny", "I go by ocean on tg"), only describing words are ("Telegram: muted.", "Instagram is toxic,",
// "Insta? Nah"): `sepWordOk` (isDescribing). Handles that are nouns ("chai", "ocean") stay handles there, as before QA4.
const bare = (t: string) => t.replace(/^@/, "");
const wordOk = (t: string) => tokenOk(t) && !isCommonWord(bare(t)) && !isRole(bare(t));
const sepWordOk = (t: string) => tokenOk(t) && !isDescribing(bare(t)) && !isRole(bare(t)); // "telegram enjoyer"
const englishWord = (t: string) => isCommonWord(bare(t)) || isDescribing(bare(t));
/**
 * At the start of a sentence or a field: the start of the text, or after . ! ? ; : | • ( or a line break or spaced
 * dash. Not after a comma: "insta lurker, snap avoider" is a list of words, "Surfer. ig chai." a contact line.
 */
const clauseStart = (f: string, at: number) => (at <= BACK && /^\s*$/.test(before(f, at))) || /(?:[.!?;:|•·(\[{\n]|\s[-–—])\s*$/.test(before(f, at));
// Chat and social apps (a word before "on GitHub" is usually a project: "llama3 on GitHub").
const SOCIAL = "telegram|telegrm|teleg|tele|tg|instagram|insta|ig|gram|snapchat|snap|tiktok|discord|linkedin|bluesky|bsky|twitter|whatsapp|threads";
// App names that, right after a plain word, make it a handle ("deexy on insta"); "wa" only in the shapes that say so.
const STRONG_APPS = "telegram|telegrm|tg|instagram|insta|ig|snapchat|snap|whatsapp";
// What follows an app name when it is the app, not where a handle lives ("photos on insta stories", "deexy's tg bots").
const APP_NOUN = String.raw`\s*['’]s\b|\s+(?:bots?|reels?|stories|story|channels?|groups?|stickers?|posts?|feeds?|pages?|lives?|ads?|filters?|dms?|chats?|calls?|videos?|vids?|photos?|pics?|accounts?|handles?|famous|influencers?|creators?|community|communities|dances?|trends?|is|was|are|mini|apps?|inc|team|office|hq)\b`;

const PATTERNS: Pattern[] = [
  // Emails: a@b.com, "a @ b . com", a [at] b [dot] com, a <at> b <dot> com, a at b dot com, "dee at gmail".
  // Each starts at the start of a word only (?<!...): a long run of letters is tried once, never at every position.
  { re: /(?<![\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+/g },
  { re: new RegExp(String.raw`(?<![\w.+-])[\w.+-]+\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)*\s*\.\s*(?:${TLD})\b`, "g") },
  { re: new RegExp(String.raw`(?<![\w.+-])[\w.+-]+${AT}[\w-]+(?:(?:${DOT}|\.)[\w-]+)+`, "g") },
  { re: new RegExp(String.raw`(?<![\w.+-])[\w.+-]+\s+at\s+[\w-]+(?:${DOT}[\w-]+)+`, "g") },
  { re: new RegExp(String.raw`(?<![\w.+@-])([\w.+-]+)\s+(?:at|on|@)\s+(?:${MAIL_HOSTS})\b(?:\s*(?:\.|dot)\s*com)?`, "g"), ok: (m) => tokenOk(m[1]) },
  // t.me links, also with spaces, "dot" and "slash"; "instagram dot com slash deexy".
  { re: new RegExp(String.raw`\b(?:t|telegram)\s*(?:\.|${DOT})\s*me\s*(?:/|slash)\s*@?\w+`, "g") },
  { re: new RegExp(String.raw`\b(?:${APPS}|x|linktr)\s*(?:\.|${DOT})\s*(?:com|me|ee)\s*(?:/|slash)\s*(?:in\s*/\s*)?@?[\w.\-]+`, "g") },
  // URLs and bare domains (also several levels: deexy.bsky.social, deexy.carrd.co), and "deexy dot com" / "deexy . com".
  { re: /\b(?:https?:\/\/|www\.)\S+/g },
  // (These start only where a word does, never inside a run of "-" or "+": QA4 review, "ab-".repeat(66667) took 62 s.)
  { re: new RegExp(String.raw`(?<![\w.-])[\w-]+(?:\.[\w-]+)*\.(?:${TLD})(?:/\S*)?(?=\s|$|[),.!?])`, "g") },
  { re: new RegExp(String.raw`(?<![\w.-])([\w-]{3,})(?:\s+dot\s+|\s+\.\s*|\s*\.\s+)(?:com|net|org|io|xyz)\b`, "g"), ok: (m) => tokenOk(m[1]) },
  // Handle words: "my handle everywhere is deex_99", "same handle as my name, deex_99 everywhere".
  { re: new RegExp(String.raw`\b(?:handle|username|user\s?name|user\s?id|tag)s?\b[^.!?\n]{0,40}?(?:\bis\b|:|,|=)\s*${STRONG}`, "g") },
  // A plain word, then the app, at the start of a clause ("deexy on insta"; never "my cofounder on Twitter").
  // There, any word but a gerund, a past form or an ordinary bio word, as 2989f6e did plus the word lists ("Barely on
  // insta", "Engineer at WhatsApp", "Bookings via whatsapp"): names stay handles ("dexter on insta", "williams on ig").
  { re: new RegExp(String.raw`(?<=${startOfClause})(?<![a-z0-9_.#\-])(${TOKEN})\s+(?:on|at|via)\s+(?:the\s+)?(?:${SOCIAL})\b(?!${APP_NOUN})`, "g"),
    ok: (m, f) => (leadWord.test(before(f, m.index)) ? sepWordOk : wordOk)(m[1]) && !ordinary(m[1]) && !/(?:ing|ings)$/.test(m[1]) && (!/ed$/.test(m[1]) || !isCommonWord(m[1]) || appComma.test(before(f, m.index))) },
  // QA3 N3-M1, anywhere in a sentence: "hit me up deexy on insta", "yoga & deexy on ig", "msg me at deexy on telegram",
  // "deexy @ telegram", "deexy (telegram)", "deexy [tg]". Only strong app names; "wa" only after on/via/@ ("Seattle (WA)").
  { re: new RegExp(String.raw`(?<![\w.@#\-])(${TOKEN})\s*(?:(?:\b(on|via|at)\b|(@))\s*(?:the\s+)?(${STRONG_APPS}|wa)\b(?!${APP_NOUN})|[(\[]\s*(${STRONG_APPS})\s*[)\]])`, "g"),
    ok: (m, f) => (m[4] !== "wa" || m[2] !== "at") && weakHandleOk(m[1], before(f, m.index), m[5] !== undefined) },
  // (These two run before the label patterns below, so "deexy on insta, ted on tg" loses both handles: a label pattern
  // taking "insta, ted" first would leave "deexy on" with no app after it.)
  // A label, a separator, then a handle: "telegram: deexy", "tg → deexy", "telegram, deex_99", "insta - deexy",
  // "telegram (deexy)", "telegram 'deex_99'", "x: @dee", "📸: deexy". Never an ordinary word ("phone: always on silent").
  // A comma or full stop alone is also how a sentence goes on ("on insta, weekly essays"; "Designer at Instagram, ex-Snap"):
  // after one, an ordinary bio word never counts, and a gerund, past form or plural ("posting", "prints") only where the
  // sentence ends ("dm me on ig, deexy", "tg, alexander", "insta, dexter for collabs").
  { re: new RegExp(String.raw`(?:\b(?:${CLEAR})\b|${EMOJI})(?:'s)?\s*(?:handle|username|user\s?name|user|id|account|acc)?(${SEP})(${TOKEN})`, "g"),
    // (A comma, a full stop or a hyphen with no spaces, "insta-perfect", says less than ":" does: any English word is a word.
    // A remark in brackets before a separator is no handle: "Insta (studio): goa_pottery" is left to the word pass.)
    ok: (m, f) => !(/\(/.test(m[1]) && /^[^()]{0,40}\)\s*[:=\-–—→]/.test(f.slice(m.index + m[0].length, m.index + m[0].length + 50)))
      && (/^(?:[\s,.]+|-)$/.test(m[1]) ? wordOk : sepWordOk)(m[2]) && (!/^[\s,.]+$/.test(m[1]) || isStrong(m[2])
      || (!ordinary(m[2]) && (closedHard(f, m.index + m[0].length) || (closed(f, m.index + m[0].length) && !/ing$/.test(m[2]))
        || (askedWord(m[2]) && !PLURAL.test(m[2]))))) },
  { re: new RegExp(String.raw`\b(?:${AMBIG})\b(?:'s)?\s*(?:handle|username|user\s?name|user|id|account|acc)?${SEP_STRICT}(${TOKEN})`, "g"), ok: (m) => sepWordOk(m[1]) && !ordinary(m[1]) }, // "Spokane WA → Bangalore"
  // A label then a strong handle, wherever the sentence goes on: "telegram deex_99 for collabs", "my tg id is dee_x
  // thanks", "telegram. deex_99", "telegram @ deex_99", "on x as deex_99", "signal me deex_99", "📸 deex_99". Never
  // ordinary words joined up ("ig reels_2024 fan").
  { re: new RegExp(String.raw`(?:\b(?:${LABELS})\b|${EMOJI})(?:'s)?(?:\s+(?:handle|username|user\s?name|id|account))?(?:\s+is\b|${SEP}|\s*\.|\s+at\b|\s*@|\s+as\b|\s+me\b(?:\s+on\b)?)?\s*(${STRONG})`, "g"),
    ok: (m) => !compound(m[1]) },
  // "add me on snap deexy": an ambiguous app name with a word that ends there, right after "on".
  { re: new RegExp(String.raw`\bon\s+(?:the\s+)?(?:${AMBIG})\s+(${TOKEN})${ENDS}`, "g"), ok: (m) => sepWordOk(m[1]) },
  // After "@" a handle is sure; after the word "at" any English word is a word ("check WhatsApp at dinner": Q5-L1).
  { re: new RegExp(String.raw`\b(?:${APPS})\b\s*(?:\bat\b|(@))\s*(${TOKEN})`, "g"), ok: (m) => (m[1] ? sepWordOk : wordOk)(m[2]) },
  // "my ig is deexy", "ig is deexy", "insta's deexy", "insta username is deexy": label + is + a word that ends there.
  { re: new RegExp(String.raw`\b(?:${LABELS})\b(?:'s|\s+(?:handle|username|user\s?name|id|account)?\s*is)\s+(${TOKEN})${ENDS}`, "g"),
    // "Instagram's world" is a possessive (any English word is a word), "my insta's sunny" is "is".
    ok: (m, f) => (/^[^\s]+'s\s/.test(m[0]) && !/\bmy\s+$/.test(before(f, m.index)) ? wordOk : sepWordOk)(m[1]) },
  { re: new RegExp(String.raw`\b(?:${APPS})\b\s+(?:handle|username|user\s?name)\s+(?:is\s+)?(${TOKEN})`, "g"), ok: (m) => tokenOk(m[1]) },
  // An app name then a word that ends there: "tg deexy", "insta deexmenezes", "add me on snap deexy", "insta deexy (dm me)".
  // A clause that is only "<app> <word>" ("Surfer. ig chai.") is a contact line; mid-sentence ("sends WhatsApp forwards",
  // "their Instagram presence") any English word is a word.
  // A question ("Instagram couple? No.") is no contact line either.
  { re: new RegExp(String.raw`\b(?:${APPS})\b\s+(${TOKEN})${ENDS}`, "g"),
    ok: (m, f) => ((clauseStart(f, m.index) || leadIn.test(before(f, m.index))) && !/^\s?\?/.test(f.slice(m.index + m[0].length, m.index + m[0].length + 2)) ? sepWordOk : wordOk)(m[1]) },
  // A handle, then the app: "deex_99 on telegram", "deex_99 (tg)", "deex_99 - telegram", "deex#1234 on discord".
  { re: new RegExp(String.raw`(?<![\w.@#\-])(${STRONG})\s*(?:\(|\bon\b|\bat\b|\bvia\b|@|[-–—|])\s*(?:the\s+)?(?:${APPS}|gram|snap|tele|threads)\b\)?`, "g"),
    ok: (m) => !compound(m[1]) },
  // "I'm on tg as deexy", "on telegram I'm deexy", "on insta, I’m deexy": only the handle goes.
  { re: new RegExp(String.raw`(?<=\bon\s+(?:${STRONG_APPS}|wa)\s*,?\s*(?:as|i['’]?m|i\s+am)\s+)(${TOKEN})(?!\s+(?:on|at|in|and|for|but|when|if|because)\b)`, "g"),
    ok: (m) => weakWord(m[1], sepWordOk) },
  // "DM deexy", "Mostly offline. DM deexy!": "dm" asking for a word that ends the sentence.
  { re: new RegExp(String.raw`(?<=(?:^|[.!?;,:(]\s*|\b(?:and|or|just|pls|please|then|so)\s+)dms?\s+(?:me\s+)?(?:(?:at|@|on)\s+)?)(${TOKEN})${ENDS}`, "g"),
    ok: (m) => askedWord(m[1]) },
  // "my handle everywhere is deexy", "username on most apps is deexy" (a plain word; strong handles are caught above).
  { re: new RegExp(String.raw`(?<=\b(?:handle|username|user\s?name)s?(?:\s+(?:everywhere|on\s+[a-z]+(?:\s+[a-z]+)?|across\s+[a-z]+(?:\s+[a-z]+)?|for\s+[a-z]+))?\s+is\s+)(${TOKEN})`, "g"),
    ok: (m) => askedWord(m[1]) },
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

// ---- Words next to an app name (QA4 Q4-M1) ------------------------------------------------------------------------
//
// Three rounds of phrase patterns kept missing wordings ("tg deex9 anytime", "deexy is my insta", "Insta? deexy",
// "I go by deexy on insta"), so after the patterns above, one more pass looks at words, not phrases: for every app name
// it takes the nearest word after it (past filler like "me", "is", ":", "?", "➜", emoji) and, in a few shapes, the word
// before it, and removes that word, with the app name, unless it is an ordinary word (lib/common-words.ts, the lists
// above, the quiz's interests). How ordinary depends on how sure the words around are that a handle follows (see
// wordOk): with nothing but the app name, any English word is a word; after ":", "is", "?" or "go by", only
// describing words are; after "handle:" or "username is", almost nothing is. A word with "_", a digit or a dot inside
// (deex9, dee_x, dee.x) goes wherever it stands in the window, unless it is technical (web3, node.js, 3x) or made of
// ordinary words (reels_2024). Nothing it adds can undo what the patterns removed.

// App names that make the next word a handle, with the misspellings people use to get past filters.
const WINDOW_APPS = new Set(["tg", "telegram", "telegrm", "telgram", "telegarm", "teligram", "insta", "instagram", "instgram", "instagarm",
  "instagrm", "ig", "snap", "snapchat", "snapchats", "snapcht", "whatsapp", "whatsap", "watsapp", "whatsaap", "whatapp", "watsap"]);
// Short forms that are app names only where the words around say so ("on wa", "sc: ...", "tele ➡️ ..."), not
// Washington, "Supreme Court" or "tele-health".
const CONTEXT_APPS = new Set(["wa", "tele", "sc"]);
// Words that name a handle. After an app name ("ig handle: ocean") they make the text sure; alone they are a label
// only at the start of a field or after "my" ("username: lohitaa", "ojasvee is my username"; not "can't handle: mornings").
const HANDLE_WORDS = new Set(["handle", "handles", "username", "usernames"]);
// Filler between an app name and its handle. SURE words and signs say a handle follows ("snap me deexy", "my ig is
// deexy", "Insta? deexy", "IG ➜ deexy"); the others are neutral ("IG dm slides", "insta & tg deexy", "tg 🙂 deexy",
// "insta pe kavya").
const SURE_WORDS = new Set(["me", "is", "its", "it's", "it’s", "i'm", "i’m", "im", "am", "as", "name's", "name’s"]);
const NEUTRAL_WORDS = new Set(["my", "at", "on", "under", "user", "name", "id", "account", "acc", "dm", "dms", "open", "also", "just",
  "literally", "basically", "simply", "still", "instead", "only", "here", "fyi", "btw", "pls", "plz",
  // Verbs that ask for the handle ("Telegram pe add karo: x", "insta follow x"), Hinglish ("whatsapp id hai mera: x").
  "add", "follow", "message", "msg", "text", "ping", "karo", "kar", "kijiye", "pe", "par", "pr", "mein", "hai", "mera", "meri", "mere",
  // An answer before the handle ("snap? sure — x", "IG? ok fine, it's x").
  "sure", "ok", "okay", "fine", "yes", "yeah", "yep", "yup", "alright", ...HANDLE_WORDS]);
const SURE_SIGNS = new Set([":", "=", "?", "-", "–", "—", ">", "»", "«", "→", "➜", "➡", "⇒", "|", "~", "(", "[", "{", '"', "'", "‘", "’", "“", "”"]);
const NEUTRAL_SIGNS = new Set(["/", "&", "+", "*", "#", ")", "]", "}", "@", "<", "•", "·", "…"]);
// Signs that close a quoted or bracketed handle before "on <app>" ('"hrisaa" on insta', "(deexy) on ig").
const CLOSING = new Set(['"', "'", "’", "”", "»", ")", "]"]);
const OPENING = new Set(['"', "'", "‘", "“", "«", "(", "["]);
const MAX_FILLER = 5;
// How many words past the first one a handle-shaped word is still looked for ("tg mostly deex99").
const SHAPED_REACH = 2;
// Interest options in the quiz (lib/options.ts), word by word: "IG Photography", "insta travel".
const INTEREST_WORDS = new Set(INTEREST_CHIPS.flatMap((c) => c.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
// Words that are never handles, even after "ig handle:" ("my ig handle is the same everywhere").
const FUNCTION_WORDS = new Set(`a an the and or but if so is are was were be been am do does i me my you your it its this that here there
  same everywhere nowhere not no yes all any some every on off in at for to of with from also too`.split(/\s+/).filter(Boolean));
// The app as a thing, right after its name ("zorvik on insta reels", "photos on tg channels"); unlike APP_NOUN, not
// "is" ("norvik on tg is how you find me").
const APP_THING = /^\s+(?:bots?|reels?|stories|story|channels?|groups?|stickers?|posts?|feeds?|pages?|lives?|ads?|filters?|chats?|calls?|videos?|vids?|photos?|pics?|famous|influencers?|creators?|community|communities|dances?|trends?|mini|apps?)\b/;

// App names misspelt to get past filters ("insata", "teIegram", "telegrammm", "instgram"): one letter off, or letters
// repeated, from the long names. Never a word of the language ("instant", "telegrams" is fine either way).
const FUZZY_APPS: [string, string][] = [["telegram", "telegram"], ["instagram", "instagram"], ["snapchat", "snapchat"], ["whatsap", "whatsapp"], ["insta", "insta"]];
const squeeze = (w: string) => w.replace(/([a-z])\1+/g, "$1");
/** a and b differ in one letter at most (changed, added, dropped, or two neighbours swapped: "isnta"). */
function oneOff(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
// Words and brands one letter off an app name: "Whatsup?", "Telegraf configs", "instax", "kinsta".
const NOT_APPS = new Set(["whatsup", "whatsupp", "wassup", "telegraf", "telegrams", "instax", "instal", "instar", "kinsta", "insts", "instat"]);
// Digits and letters written for others in a misspelt app name ("1nsta", "inst4", "lnsta").
const LOOKALIKE_DIGITS: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" };
const fuzzyApp = (t: string) => {
  const w = t.replace(/-/g, "").replace(/[013457]/g, (d) => LOOKALIKE_DIGITS[d]).replace(/^l(?=nsta)/, "i"); // "snap-chat", "1nsta"
  if (w.length < 5 || w.length > 11 || !/^[a-z]+$/.test(w) || NOT_APPS.has(w) || isCommonWord(w)) return null;
  const s = squeeze(w);
  const sameLetters = (k: string) => [...s].sort().join("") === [...k].sort().join("");
  // Long names may be one letter off. "insta" is close to too much: only a letter added ("insata") or two letters
  // swapped ("isnta"), not one changed ("insts").
  const near = (k: string) => s === k || (oneOff(s, k) && (k.length >= 7 || s.length === k.length + 1 || sameLetters(k)));
  return FUZZY_APPS.find(([k]) => near(k))?.[1] ?? null;
};

/** How sure the words around are that a handle follows: 0 only an app name, 1 a separator or "is", 2 "handle:". */
type Sure = 0 | 1 | 2;
/** A word anyone might write there (see Sure): not a handle. */
const plainWord = (w: string, sure: Sure) => sure === 2 ? isDescribing(w) || FUNCTION_WORDS.has(w)
  : (sure === 1 ? isDescribing(w) || isChatWord(w) : isWord(w)) || COMMON.has(w) || INTEREST_WORDS.has(w) || bioWord(w) || common(w);
// A token with "_", a digit or a letter.letter dot: handle-shaped ("deex9", "dee_x", "tej.0", "chai_lover").
const HANDLE_SHAPED = /_|[a-z]\d|\d[a-z]|[a-z]\.[a-z0-9]/;
/** Handle-shaped but ordinary: technical, a number with a unit ("3x", "24x7", "5g"), "e.g.", or ordinary words joined. */
const shapedButOrdinary = (w: string) => TECH.test(w) || TECH_CHIP.test(w) || /^[a-z]+\d+\.\d/.test(w) || /^\d+(?:x\d+|[a-z]{1,3})$/.test(w)
  || /^\d+(?:\.\d+)?[kmb]\+?$|^\d+k\d+$/.test(w) || /^(?:[a-z]\.)+[a-z]?$/.test(w) || compound(w) || isChatWord(w); // 4.5k, 2k24, gr8
/** A word that, next to an app name, is a handle (at least 3 characters, ASCII: handles are). */
function handleNearApp(t: string, sure: Sure): boolean {
  let w = t.replace(/^@/, "").replace(/['’]s$/, "");
  // Accented letters: a word ("Insta café vibes") where only an app name is next to it; where the text says a handle
  // follows, the word without its accents is judged ("tg: rohän" goes, "Insta: café et croissants" stays).
  if (/[^\x00-\x7f]/.test(w)) {
    const plain = w.normalize("NFD").replace(/\p{M}/gu, "");
    if (!sure || /[^\x00-\x7f]/.test(plain)) return false;
    w = plain;
  }
  if (w.length < 3 || w.startsWith("#") || (w.startsWith("ex-") && sure < 2)) return false; // hashtags; "ex-Meta" (Q5-L1)
  if (HANDLE_SHAPED.test(w)) return !shapedButOrdinary(w);
  if (/^\d+$/.test(w) || plainWord(w, sure) || plainWord(w.replace(/['’](?:re|ve|ll|d|m|t)$/, ""), sure)) return false;
  // Compounds of ordinary words ("insta-worthy", "ex-snap") are words, unless the text is sure.
  return sure === 2 || !w.split(/[\-'’]+/).filter(Boolean).every((x) => plainWord(x, sure));
}

type Tok = { t: string; from: number; to: number; kind: "word" | "sign" | "mark" };
// A word: letters, digits and _ . # ' - inside (never at the end: "deexy." is "deexy"), or "@" + a word. Any script's
// letters belong to the word ("café" is one word, not "caf" and "é").
const TOKENS = new RegExp(String.raw`@?[\p{L}\p{N}_#][\p{L}\p{M}\p{N}_.#'’\-]*[\p{L}\p{M}\p{N}_#]|@?[\p{L}\p{N}_#]|${MARK}|\s+|[\s\S]`, "gu");
function tokens(f: string): Tok[] {
  const out: Tok[] = [];
  for (const m of f.matchAll(TOKENS)) {
    const t = m[0];
    if (/^\s/.test(t)) continue;
    out.push({ t, from: m.index!, to: m.index! + t.length, kind: t === MARK ? "mark" : /[\p{L}\p{N}]/u.test(t) ? "word" : "sign" });
  }
  return out;
}
const word = (x: Tok | undefined, ...ws: string[]) => x?.kind === "word" && ws.includes(x.t);
const sign = (x: Tok | undefined, set: ReadonlySet<string>) => x?.kind === "sign" && set.has(x.t);
// Emoji and other symbols between an app name and a handle ("insta 👉 deexy", "tg 🙂 deexy").
const symbol = (x: Tok | undefined) => x?.kind === "sign" && /^[\p{S}\p{Extended_Pictographic}]$/u.test(x.t);
const strongApp = (x: Tok | undefined) => x?.kind === "word" && WINDOW_APPS.has(x.t.replace(/['’]s$/, ""));
// After these, the word before "on <app>" is the object of the sentence, not a handle ("I post sketches on insta").
const OBJECT_BEFORE = new Set(["a", "an", "the", "my", "our", "your", "his", "her", "their", "some", "more", "of", "in", "from", "about",
  "for", "with", "to", "by", "ex", "post", "posts", "posting", "share", "shares", "sharing", "sell", "sells", "selling", "run", "runs",
  "make", "makes", "do", "does", "love", "loves", "like", "likes", "hate", "hates", "watch", "watches", "upload", "uploads", "only", "just", "mostly", "also"]);
// "-ing" words are a sentence going on ("Lurking on tg", "Kitesurfing on insta"), and so are "-ed" words of the
// language; names that end like them are not ("ahmed on insta").
const verbForm = (w: string) => /ing$/.test(w) || (/ed$/.test(w) && isCommonWord(w));

/** The app name ending at toks[i], if it is one there: its name and the index of its first token ("whats app"). */
function appAt(toks: Tok[], i: number): [string, number] | null {
  const x = toks[i];
  if (x.kind !== "word") return null;
  if (strongApp(x)) return [x.t.replace(/['’]s$/, ""), i];
  if (word(x, "gram") && word(toks[i - 1], "the")) return ["gram", i]; // "On the gram as ixora"; a lone "gram" is a weight
  if (word(x, "app") && word(toks[i - 1], "whats")) return ["whatsapp", i - 1];
  if (word(x, "chat") && word(toks[i - 1], "snap")) return ["snapchat", i - 1];
  if (word(x, "gram") && word(toks[i - 1], "insta", "tele")) return [toks[i - 1].t === "insta" ? "instagram" : "telegram", i - 1]; // "insta gram"
  const fuzzy = fuzzyApp(x.t);
  if (fuzzy) return [fuzzy, i];
  if (!CONTEXT_APPS.has(x.t)) return null;
  // "wa", "tele", "sc": after on/via/my/@, before a separator, emoji or "username", or in a list of contacts
  // ("tg deexy / wa deexy", "sc deexy, tg deexy").
  const prev = toks[i - 1], next = toks[i + 1];
  const listSign = (t: Tok | undefined) => sign(t, NEUTRAL_SIGNS) || t?.t === ",";
  const inList = (listSign(prev) && (toks[i - 2]?.kind === "mark" || strongApp(toks[i - 2]) || strongApp(toks[i - 3])))
    || (listSign(toks[i + 2]) && (strongApp(toks[i + 3]) || toks[i + 3]?.kind === "mark"));
  const asApp = word(prev, "on", "via", "my") || prev?.t === "@" || inList || sign(next, SURE_SIGNS) || symbol(next)
    || word(next, ...HANDLE_WORDS, "id") || (x.t === "wa" && word(next, "me"));
  return asApp ? [x.t, i] : null;
}

/** The index of the ")" that closes the "(" at toks[j] within a few words and is followed by a separator, or -1. */
function closeAt(toks: Tok[], j: number): number {
  for (let k = j + 1; k < Math.min(toks.length, j + 10); k++) {
    if (toks[k].t === ")") return /^[:=\-–—→➜➡]$/.test(toks[k + 1]?.t ?? "") ? k : -1;
    if (toks[k].t === "(" || toks[k].kind === "mark") return -1;
  }
  return -1;
}

type After = { lead: boolean; label: boolean; contextApp: boolean; upper: (x: Tok) => boolean };
/** The index of the handle after the app name (or label) at toks[i], past the filler, or -1. */
function handleAfter(toks: Tok[], i: number, o: After): number {
  let sure: Sure = o.lead ? 1 : 0;
  let my = false, handleWord = false, question = false;
  // "<app> is my X" / "<app>'s my X" (Q5-L1): people write "X is my insta", not "insta is my X", so only a handle-shaped
  // X right after "my" counts there ("Telegram is my therapist"; not "insta is my id: x", "its my name x").
  let is =/['’]s$/.test(toks[i].t), isMy = false;
  let bracketed = -1; // the one word of a skipped remark in brackets ("Insta (deexy): dms open")
  let j = i + 1;
  for (let n = 0; j < toks.length && n < MAX_FILLER; j++, n++) {
    const x = toks[j];
    const possessive = x.kind === "word" ? /^(handle|username|name)['’]s$/.exec(x.t) : null; // "my insta handle's x"
    const close = x.t === "(" ? closeAt(toks, j) : -1;
    if (possessive) {
      if (possessive[1] !== "name") handleWord = true;
      sure = 1;
    } else if (x.kind === "word" && (SURE_WORDS.has(x.t) || NEUTRAL_WORDS.has(x.t) || strongApp(x))) {
      if (x.t === "my") {
        my = true;
        isMy ||= is;
      }
      if (word(x, "is", "its", "it's", "it’s")) is = true;
      if (HANDLE_WORDS.has(x.t)) handleWord = true;
      if (SURE_WORDS.has(x.t)) sure = 1;
    } else if (close > 0) {
      // A remark in brackets, then a separator: "Insta (private, request away): x", "telegram (not whatsapp): x".
      if (close === j + 2 && toks[j + 1].kind === "word") bracketed = j + 1;
      j = close;
    } else if (sign(x, SURE_SIGNS)) {
      sure = 1;
      if (x.t === "?") question = true;
    } else if (!(sign(x, NEUTRAL_SIGNS) || symbol(x) || (x.t === "," && (o.lead || word(toks[j + 1], ...SURE_WORDS)))
      || (x.t === "." && (toks[j + 1]?.t === "." || toks[j - 1]?.t === ".")))) break;
    // (Neutral: "/", "&", "•", emoji..., an ellipsis ("…" folds to "..."), and a comma after a lead-in or before "its":
    // "ping me on insta, x", "find me on snap, its x".)
  }
  // A handle word alone names a handle only before ":" / "is", and then any English word is still a word ("Username:
  // forgot it"). After an app name it makes the text surest ("ig handle: ocean"). "my" after the app name means the
  // sentence is about the app ("Insta is my portfolio"), and after "?" comes an answer ("insta? used to").
  if (o.label && !sure) return -1;
  const level: Sure = o.label ? 0 : handleWord && sure ? 2 : my || question ? 0 : sure;
  const next = toks[j];
  // "Insta (studio): goa_pottery" is the word after the remark; "Insta (deexy): dms open" the one in it.
  const inBracket = () => (bracketed >= 0 && handleNearApp(toks[bracketed].t, 0) ? bracketed : -1);
  if (next?.kind !== "word") return inBracket();
  // A capitalised English word after a short form is a sentence ("SC: Supreme Court advocate", "WA - Seattle"). A word
  // that is a name as often ("koi", "kam", "diya") is a word when the sentence goes on in words ("tg me koi nahi hai").
  const sentence = (o.contextApp && o.upper(next) && isWord(next.t))
    || (isNameWord(next.t) && toks[j + 1]?.kind === "word" && isWord(toks[j + 1].t) && !/^(?:for|on|via|lol|pls|please|anytime|btw|hmu|and|or)$/.test(toks[j + 1].t));
  const isMyX = isMy && !handleWord && !o.lead && word(toks[j - 1], "my");
  // A word followed by "than" is a comparison (Q5-L1): any English word where only the app name is next to it, a
  // describing word or "-er" form after ":" / "is" ("tg: faster than email"), nothing after "handle:". A noun or a word
  // that is no English word stays a handle there ("insta: mango than dm", "insta kabirsurfs than DM": "than" for "then").
  const compared = word(toks[j + 1], "than") && (level === 0 ? englishWord(next.t) : level === 1 && isDescribing(next.t));
  if (!sentence && handleNearApp(next.t, level) && (!(isMyX || compared) || HANDLE_SHAPED.test(next.t))) return j;
  if (inBracket() >= 0) return bracketed;
  // An ordinary word first: a handle-shaped word may still follow ("tg mostly deex99").
  for (let k = j + 1; k <= j + SHAPED_REACH && k < toks.length && toks[k].kind === "word" && !strongApp(toks[k]); k++) {
    if (HANDLE_SHAPED.test(toks[k].t) && handleNearApp(toks[k].t, 0)) return k;
  }
  return -1;
}

// Signs between a handle and the app name after it, at the end of a clause ("kavya - insta", "kavya | ig").
const BEFORE_SEPARATORS = new Set(["-", "–", "—", "|", "=", "/", ":", "→", "➜", "➡"]);
/**
 * The index of the handle before the app name (or label) whose tokens are toks[a..i], or -1: "<x> is my <app>",
 * "<x> = my <app>", "<x> is also my <app>", "<x>'s my <app>", "go(es) by <x> on <app>", "ask for <x> on <app>",
 * '"<x>" on <app>', "<x> - <app>", "<x> on/via <app>".
 */
function handleBefore(toks: Tok[], a: number, i: number, f: string, label: boolean): number {
  let b = a - 1;
  if (word(toks[b], "my")) {
    b--;
    if (word(toks[b], "also")) b--;
    let xi = word(toks[b], "is") || toks[b]?.t === "=" ? b - 1 : /['’]s$/.test(toks[b]?.t ?? "") ? b : -1;
    // "x 👈 that's my ig", "x → this is my insta": the handle is the word before "that's" / "this is", past an arrow or
    // emoji but never past the end of a sentence ("Sunsets and dogs. That's my insta.").
    if (xi >= 0 && (word(toks[xi], "that's", "that’s", "thats") || (word(toks[xi], "that", "this") && word(toks[xi + 1], "is")))) {
      xi--;
      while (xi >= 0 && toks[xi].kind === "sign" && (symbol(toks[xi]) || /^[\-–—→➜➡=:|]$/.test(toks[xi].t))) xi--;
    }
    // Any English word is a word here ("Sarcasm is my insta", "Love dogs 🐶 that's my insta"); names go ("kavya is my tg").
    return xi >= 0 && toks[xi].kind === "word" && handleNearApp(toks[xi].t, 0) ? xi : -1;
  }
  if (toks[i].kind === "mark") return -1; // (a removed app name counts only in "<x> is my [removed]")
  if (label) return -1;
  const end = toks[i + 1] === undefined || (toks[i + 1].kind === "sign" && /^[.,;!?)\]|•·]$/.test(toks[i + 1].t));
  if (sign(toks[b], BEFORE_SEPARATORS) && toks[b - 1]?.kind === "word" && end) return handleNearApp(toks[b - 1].t, 0) ? b - 1 : -1;
  if (!(word(toks[b], "on", "via", "at") || toks[b]?.t === "@")) return -1;
  // One quoted or bracketed word: '"hrisaa" on insta', "(deexy) on ig". Not the object of a sentence ('Watch "Monsoon"
  // on insta', "Recipes (vegan) on insta"), and any English word is a word.
  const quoted = sign(toks[b - 1], CLOSING) && toks[b - 2]?.kind === "word" && sign(toks[b - 3], OPENING);
  if (quoted) {
    const open = toks[b - 3];
    const object = NOT_AFTER.test(before(f, open.from)) || (toks[b - 4]?.kind === "word" && OBJECT_BEFORE.has(toks[b - 4].t));
    return !object && handleNearApp(toks[b - 2].t, 0) ? b - 2 : -1;
  }
  const xi = b - 1;
  const x = toks[xi], x1 = toks[xi - 1], x2 = toks[xi - 2];
  if (x?.kind !== "word") return -1;
  const asked = (word(x1, "by") && word(x2, "go", "goes", "going", "went", "gone")) || (word(x1, "for") && word(x2, "ask", "asking", "look", "looking", "search"))
    || (word(x1, "as") && word(x2, "known")) || word(x1, "called", "named", "ask");
  if (asked) return handleNearApp(x.t, 1) ? xi : -1;
  // Plain "<x> on <app>": only "on"/"via", not the object of the sentence ("my Kathakali troupe on insta", "best momos
  // on insta"), not a verb form, and not where the app is a thing ("zorvik on insta reels").
  const plain = word(toks[b], "on", "via") && !(x1?.kind === "word" && OBJECT_BEFORE.has(x1.t)) && !NOT_AFTER.test(before(f, x.from))
    && !verbForm(x.t) && !APP_THING.test(f.slice(toks[i].to, toks[i].to + 40));
  return plain && handleNearApp(x.t, 0) ? xi : -1;
}

/** Spans (folded positions) of "<app> <handle>" and "<handle> ... <app>" that the patterns above left in place. */
function nearAppSpans({ f, s }: Folded, original: string): [number, number][] {
  const toks = tokens(f);
  const out: [number, number][] = [];
  const upper = (x: Tok) => /\p{Lu}/u.test(String.fromCodePoint(original.codePointAt(s[x.from]) ?? 32));
  for (let i = 0; i < toks.length; i++) {
    // An app name a pattern above already took with something else ("x is my [removed]", from "x is my tg, x ..."):
    // only the "is my" shape before it.
    if (toks[i].kind === "mark") {
      const pre = handleBefore(toks, i, i, f, false);
      if (pre >= 0) out.push([toks[pre].from, toks[pre].to]);
      continue;
    }
    const app = appAt(toks, i);
    // A handle word alone ("username: ...") at the start of a field, after a comma or "my"/"the"; not "I can't handle: mornings".
    const label = !app && word(toks[i], ...HANDLE_WORDS) && (clauseStart(f, toks[i].from) || toks[i - 1]?.t === "," || word(toks[i - 1], "my", "the", "same", "your"));
    if (!app && !label) continue;
    if (app?.[0] === "ig" && word(toks[i + 1], "i", "im", "i'm", "i’m", "ill", "i'll", "i’ll")) continue; // "ig im chill": "I guess"
    const a = app ? app[1] : i;
    const from = toks[a].from;
    const hit = handleAfter(toks, i, { lead: leadIn.test(before(f, from)), label: !!label, contextApp: !!app && CONTEXT_APPS.has(app[0]), upper });
    if (hit >= 0) out.push([from, toks[hit].to]);
    const pre = handleBefore(toks, a, i, f, !!label);
    if (pre >= 0) out.push([toks[pre].from, toks[i].to]);
  }
  // Merge overlaps ("tg deexy is my insta"): spans come in order of their app name, not of their start.
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const sp of out) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  return merged;
}

// Q5-L1: a describing word or "-er" form followed by "than" is a comparison, never a handle ("on insta faster than
// email", "on WhatsApp longer than 2 minutes"). Nouns, other words ("kabirsurfs than DM": "than" for "then") and the word
// after "handle" still go: a pattern may be one where the text says a handle follows.
const thanNext = (f: string, at: number) => /^\s+than\b/.test(f.slice(at, at + 7));
/** The handle a pattern took (its last group, where the match ends) is a describing word followed by "than". */
const comparedAt = (m: RegExpExecArray, f: string) => {
  const g = m.slice(1).findLast((x) => x !== undefined);
  return !!g && m[0].endsWith(g) && isDescribing(bare(g)) && !/\b(?:handle|user\s?name)s?\b/.test(m[0]) && thanNext(f, m.index + m[0].length);
};

/** Every span of the text (original positions) that `p` matches on its folded copy. */
function spans({ f, s, e }: Folded, p: Pattern) {
  const out: [number, number][] = [];
  p.re.lastIndex = 0;
  for (let m = p.re.exec(f); m; m = p.re.exec(f)) {
    if (!m[0].length) {
      p.re.lastIndex++;
      continue;
    }
    if ((p.ok && !p.ok(m, f)) || comparedAt(m, f)) {
      p.re.lastIndex = m.index + 1; // try the next start (a later, real handle on the same line)
      continue;
    }
    out.push([s[m.index], e[m.index + m[0].length - 1]]);
  }
  return out;
}

// Words of removed contacts that are no handle ("deexy@gmail.com" keeps "gmail" and "com" out of the repeats).
const NOT_REPEATED = new Set([MAIL_HOSTS, TLD, APPS, AMBIG, SOCIAL, "dot|slash|http|https|www|linktr|email"].flatMap((s) => s.split("|")));

/**
 * The handle of each removed contact, to remove where it comes again: the first or last word of what was removed (a
 * handle starts "kavya on insta" and ends "telegram: kavya"; "Arjun" in "username for Arjun's events is deex_99" is
 * neither), when it is no word of the language (lib/common-words.ts), no app name, and 4+ characters. Leading and
 * trailing "_" / "." go ("adhvelin_").
 */
const handleKey = (t: string) => t.replace(/^@/, "").replace(/['’]s$/, "").replace(/^[_.]+|[_.]+$/g, "");
function removedHandles(removed: string[]): Set<string> {
  const out = new Set<string>();
  for (const part of removed) {
    const toks = tokens(fold(part).f);
    // Past app names and filler at either end ("tg deexy is my insta" gives "deexy").
    const content = (t: Tok, k: number) => t.kind === "word" && !appAt(toks, k) && !SURE_WORDS.has(t.t) && !NEUTRAL_WORDS.has(t.t);
    const ends = [toks.findIndex(content), toks.findLastIndex(content)].filter((k) => k >= 0);
    for (const k of new Set(ends)) {
      const w = handleKey(toks[k].t);
      if (w.length >= 4 && /^[a-z0-9_.]+$/.test(w) && /[a-z]/.test(w) && !/^\d/.test(w) && !NOT_REPEATED.has(w) && !appAt(toks, k)
        && handleNearApp(w, 0)) out.add(w);
    }
  }
  return out;
}

export function stripContacts(text: string): string {
  let out = text.replaceAll(MARK, "");
  let folded = fold(out);
  const removed: string[] = [];
  const cut = (found: [number, number][]) => {
    // One pass (spans come in order and never overlap): a text with thousands of contacts is rebuilt once, not per span.
    const parts: string[] = [];
    let at = 0;
    for (const [from, to] of found) {
      parts.push(out.slice(at, from), MARK);
      removed.push(out.slice(from, to));
      at = to;
    }
    out = parts.join("") + out.slice(at);
    folded = fold(out); // folded again only when something went
  };
  // The patterns, then the words left next to an app name (nearAppSpans, on what the patterns kept).
  const finders = [...PATTERNS.map((p) => (x: Folded) => spans(x, p)), (x: Folded) => nearAppSpans(x, out).map(([a, b]): [number, number] => [x.s[a], x.e[b - 1]])];
  for (const find of finders) {
    const found = find(folded);
    if (found.length) cut(found);
  }
  // A handle given once is given everywhere it comes again ("kavya on insta, kavya on tg, kavya irl"), "_"/"." around it
  // or not ("adhvelin, not adhvelin_"). Only words that are no English word: "pickle on insta ... a pickle" keeps the second.
  const again = removedHandles(removed);
  if (again.size) {
    const found = tokens(folded.f).filter((t) => t.kind === "word" && again.has(handleKey(t.t))).map((t): [number, number] => [folded.s[t.from], folded.e[t.to - 1]]);
    if (found.length) cut(found);
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

// ---- Interests ---------------------------------------------------------------------------------------------------

// An interest chip that is only an app name ("telegram", "on insta", "my tg"): next to a handle chip it rebuilds a contact
// on a card (QA3 N3-M1: ["telegram", "deex_99"]), so it goes.
const LABEL_CHIP = new RegExp(String.raw`^(?:(?:on|via|my|at|@)\s+)?(?:${APPS}|whats\s?app|wa|x|snap|threads|signal|email|e-mail|phone|mobile)(?:\s*(?:handle|id|username|account|dm|me))?\s*[:\-]?$`);
// A chip that looks like a handle: "@deexy", "deex_99", "dee.x", "deex99".
const HANDLE_CHIP = /^@|^[a-z0-9]+(?:[_.#][a-z0-9_.#]*|\d[a-z0-9]*)$/;

/**
 * Interests as other people may see them: no chip that held a contact (QA5 Q5-L4: "whatsapp 9876543210" would show as
 * "whatsapp [removed]" on cards), no chip that is only an app name, and, when a chip was an app name, no chip that looks
 * like a handle either. Used on save (lib/validate.ts) and on read, so chips stored before go too.
 */
export function publicInterests(list: readonly string[]): string[] {
  const out = list.map((s) => stripContacts(s)).filter((s) => s && !s.includes(R));
  const folded = out.map((s) => fold(s).f.trim());
  const hadLabel = folded.some((f) => LABEL_CHIP.test(f));
  return out.filter((_, k) => !LABEL_CHIP.test(folded[k]) && !(hadLabel && HANDLE_CHIP.test(folded[k]) && !/^\d+$/.test(folded[k]) && !TECH.test(folded[k])
    && !TECH_CHIP.test(folded[k]) && !compound(folded[k])));
}
