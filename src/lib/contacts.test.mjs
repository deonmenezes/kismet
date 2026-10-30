// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripContacts, withoutNames } from "./contacts.ts";

const leaks = [
  ["email", "mail me at dee@gmail.com please", "dee@gmail.com"],
  ["obfuscated email [at] [dot]", "write to dee [at] gmail [dot] com", "gmail"],
  ["obfuscated email (at) (dot)", "dee(at)gmail(dot)com", "gmail"],
  ["obfuscated email (at) with real dot", "dee (at) proton.me", "proton"],
  ["email spelled out", "dee at gmail dot com", "gmail"],
  ["telegram label", "telegram: dee_handle99", "dee_handle99"],
  ["tg label", "tg: deehandle", "deehandle"],
  ["ig label", "ig - dee.makes", "dee.makes"],
  ["insta label", "Insta: deecodes", "deecodes"],
  ["x label", "x: @dee_x", "dee_x"],
  ["twitter label", "twitter = deetweets", "deetweets"],
  ["label + is", "my telegram is dee_99", "dee_99"],
  ["handle", "ping @dee_x on tg", "dee_x"],
  ["handle with a space", "find me @ dee_x", "dee_x"],
  ["t.me link", "t.me/deehandle", "deehandle"],
  ["t.me with spaces", "t . me / deehandle", "deehandle"],
  ["t dot me", "t dot me/deehandle", "deehandle"],
  ["url", "see https://dee.dev/about", "dee.dev"],
  ["bare domain", "my site is deemenezes.com.", "deemenezes"],
  ["phone", "call +91 98765 43210", "98765"],
  // A label then a handle with no ":" or "is" (QA 2026-10-28 M3)
  ["app then handle", "find me on insta deex_99", "deex_99"],
  ["tg then handle", "tg deex99", "deex99"],
  ["handle word then handle", "my telegram handle deex_99", "deex_99"],
  ["handle word, plain name", "my telegram handle deexmenezes", "deexmenezes"],
  ["username word with is", "insta username is deexmenezes", "deexmenezes"],
  ["on telegram at", "ping me on telegram at deex_99", "deex_99"],
  ["handle then on telegram", "deex_99 on telegram", "deex_99"],
  ["handle then via tg", "or deex99 via TG", "deex99"],
  ["ig then handle", "dm me on IG dee.x99", "dee.x99"],
];

for (const [name, input, secret] of leaks) {
  test(`strips ${name}`, () => {
    const out = stripContacts(input);
    assert.ok(!out.includes(secret), `${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    assert.ok(out.includes("[removed]"));
  });
}

const keeps = [
  "I love Telegram bots and Instagram reels",
  "Instagram is my favourite app",
  "Meet @ the circle at 6pm",
  "I worked at Google. Then I surfed.",
  "Building Next.js apps since 2019-2024",
  "AI x crypto x surfing",
  "Lunch at Riva, then a walk on Mandrem beach",
  // Normal bios next to an app name stay as written
  "Building AI x web3 tools",
  "I post on Instagram 3x a week",
  "Telegram bots and Discord servers are my thing",
  "Ask me about my Telegram channel or the GitHub repo",
  "On Instagram at sunset, mostly photos",
  "I met my cofounder on Twitter in 2019",
  "Into web3 on weekends, surfing on Telegram stickers",
  "Love my insta reels and tiktok dances",
  "Find me on the beach at 6pm",
  "Shipping llama3 on GitHub",
  "Building web3.0 on Twitter",
  "The x handle is great",
  "my phone handle works",
];

for (const input of keeps) {
  test(`keeps normal text: ${input}`, () => assert.equal(stripContacts(input), input));
}

test("board quotes lose every name word, any case, and keep the rest", () => {
  const names = ["Asha Patel", "Sunny's agent", "Deon", ""];
  assert.equal(withoutNames("Asha and DEON should surf; Sunny's agent agrees with patel", names), "someone and someone should surf; someone's agent agrees with someone");
  assert.equal(withoutNames("Deonte is not Deon", names), "Deonte is not someone");
  assert.equal(withoutNames("no names here", [null, undefined, "Al"]), "no names here");
});

test("a match's name in Kismet's reply becomes your match, capitalized at a sentence start", () => {
  assert.equal(withoutNames("Linda is fun. I like linda, and Linda's art.", ["Linda"], "your match"), "Your match is fun. I like your match, and your match's art.");
});

// QA2 M3: the 96 forms that leaked (backend/fuzz-contacts.log), and the fuzz's ordinary bios.
const { QA2_LEAKS, QA2_BENIGN } = await import("./contacts-qa2.fixture.mjs");

test("QA2 M3: all 96 leaked forms are removed (label + handle, separators, lookalikes, emoji labels, spelled-out numbers)", () => {
  assert.equal(QA2_LEAKS.length, 96);
  const left = QA2_LEAKS.filter(([input, secret]) => stripContacts(input).includes(secret)).map(([i]) => `${JSON.stringify(i)} -> ${JSON.stringify(stripContacts(i))}`);
  assert.deepEqual(left, []);
});

test("QA2 M3: the fuzz's ordinary bios stay exactly as written", () => {
  const changed = QA2_BENIGN.filter((b) => stripContacts(b) !== b).map((b) => `${JSON.stringify(b)} -> ${JSON.stringify(stripContacts(b))}`);
  assert.deepEqual(changed, []);
});

test("QA2 M3: only the contact goes; the rest of the original text (any script, case or emoji) is kept as written", () => {
  assert.equal(stripContacts("Surfer 🌊 from Goa. Telegram: Deexy. Say hi!"), "Surfer 🌊 from Goa. [removed]. Say hi!");
  assert.equal(stripContacts("ＴＥＬＥＧＲＡＭ：deexy und Café ☕"), "[removed] und Café ☕");
  assert.equal(stripContacts("📸 deex_99 · loves chai"), "[removed] · loves chai");
  assert.equal(stripContacts("call nine eight seven six five four three two one zero now"), "call [removed] now");
  assert.equal(stripContacts("I have two cats and one dog"), "I have two cats and one dog");
});

test("QA2 M3: no slow inputs (every pattern starts once per word)", () => {
  for (const s of ["x".repeat(200_000) + " deex_99", "a_".repeat(100_000), "1 ".repeat(50_000), "a.".repeat(100_000), "telegram ".repeat(20_000), "@ a1".repeat(30_000)]) {
    const t = performance.now();
    stripContacts(s);
    assert.ok(performance.now() - t < 3000, `${s.slice(0, 12)}...: ${Math.round(performance.now() - t)} ms`);
  }
});

// Code review of the M3 rewrite: handles mid-sentence, ordinary words that are also app names, and the old coverage.
test("review: a handle followed by more words is still removed", () => {
  for (const [input, secret] of [
    ["Hit me up on tg deex_99 anytime", "deex_99"], ["telegram deex_99 for collabs", "deex_99"], ["my telegram is deex_99 btw", "deex_99"],
    ["insta is deex_99 dm me", "deex_99"], ["ig dee99 lol", "dee99"], ["my tg id is dee_x thanks", "dee_x"], ["telegram is d33x hmu", "d33x"],
    ["Find me @deex_99 everywhere", "deex_99"],
  ]) assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  assert.equal(stripContacts("Find me @deex_99 everywhere"), "Find me [removed] everywhere", "only the handle goes");
});

test("review: ordinary words that are also app names stay as written", () => {
  for (const bio of [
    "Mostly on X, building agents.", "Engineer working on mobile, backend and infra", "Researcher in cell/gene therapy", "I work in tele-health",
    "Signal, noise and everything between.", "phone/laptop free weekends", "My mail-order bride jokes", "Ask me about Gen-X, music",
    "Pulling twitter drama.", "Snapchat streaks.", "Make snap decisions.", "linkedin lunatics.", "I sew threads together.",
    "Doodles on insta.", "Art on insta, mostly", "I'm node.js dev",
  ]) assert.equal(stripContacts(bio), bio);
});

test("review: no \"[removed]]\" leftovers, and long whitespace runs stay fast", () => {
  assert.ok(!/deex|\]\]/.test(stripContacts("my insta handle is deex.y")), stripContacts("my insta handle is deex.y"));
  assert.ok(!stripContacts("📸com99@2.handle").includes("]]"));
  for (const s of ["-" + " ".repeat(32_000) + "x", "\t".repeat(32_000) + ", x"]) {
    const t = performance.now();
    stripContacts(s);
    assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms`);
  }
});

test("review: everything the old patterns removed from label + handle phrases is still removed", async () => {
  const old = (await import("./test-support/contacts-9e793ac.ts")).stripContacts;
  const labels = ["telegram", "tg", "insta", "instagram", "ig", "snapchat", "twitter", "whatsapp", "discord", "github", "x", "signal", "email", "phone"];
  const handles = ["deex_99", "dee99x", "deex.99", "dee_x", "deexmenezes99"];
  const shapes = (l, h) => [`${l}: ${h}`, `${l} - ${h}`, `${l} = ${h}`, `my ${l} is ${h}`, `${l} ${h}`, `${l} ${h} ok`, `${l}: ${h} hmu`, `my ${l} is ${h} btw`,
    `find me on ${l} ${h}`, `${h} on ${l}`, `${h} via ${l}`, `my ${l} handle ${h}`, `${l} username is ${h}`];
  const lost = [];
  for (const l of labels) for (const h of handles) for (const s of shapes(l, h)) {
    if (!old(s).includes(h) && stripContacts(s).includes(h)) lost.push(s);
  }
  assert.deepEqual(lost, []);
});

// QA3 N3-M1: plain handles (no digit or "_") in the middle of a bio, and app-name + handle interest chips.
const { QA3_LEAKS, QA3_BIOS, QA3_BIOS_HELDOUT } = await import("./contacts-qa3.fixture.mjs");

test("QA3 N3-M1: the 13 forms from the report and the same shapes in other bios are removed", () => {
  assert.ok(QA3_LEAKS.length >= 13);
  const left = QA3_LEAKS.filter(([input, secret]) => stripContacts(input).includes(secret)).map(([i]) => `${JSON.stringify(i)} -> ${JSON.stringify(stripContacts(i))}`);
  assert.deepEqual(left, []);
});

test("QA3 N3-M1: only the handle part goes, the rest of the bio stays", () => {
  assert.equal(stripContacts("Surfer. Hit me up deexy on insta, tg deexy"), "Surfer. Hit me up [removed], [removed]");
  assert.equal(stripContacts("I'm on tg as deexy"), "I'm on tg as [removed]");
  assert.equal(stripContacts("on telegram I'm deexy"), "on telegram I'm [removed]");
  assert.equal(stripContacts("Mostly offline. DM deexy!"), "Mostly offline. DM [removed]!");
  assert.equal(stripContacts("my handle everywhere is deexy"), "my handle everywhere is [removed]");
  assert.equal(stripContacts("Painter, deexy (insta)"), "Painter, [removed]");
});

test("QA3 N3-M1: 114 realistic Goa / Edge City bios (many naming an app) stay exactly as written", () => {
  assert.ok(QA3_BIOS.length >= 100);
  const changed = QA3_BIOS.filter((b) => stripContacts(b) !== b).map((b) => `${JSON.stringify(b)} -> ${JSON.stringify(stripContacts(b))}`);
  assert.deepEqual(changed, []);
});

test("QA3 N3-M1: held-out bios (never tuned on) change no more often than with 2989f6e (2 of the 7 it changed are new-shape)", async () => {
  const old = (await import("./test-support/contacts-2989f6e.ts")).stripContacts;
  const now = QA3_BIOS_HELDOUT.filter((b) => stripContacts(b) !== b);
  const before = QA3_BIOS_HELDOUT.filter((b) => old(b) !== b);
  assert.ok(now.length <= before.length, `now ${now.length}, 2989f6e ${before.length}:\n${now.map((b) => `${b} -> ${stripContacts(b)}`).join("\n")}`);
  assert.ok(now.length <= 6, now.map((b) => `${b} -> ${stripContacts(b)}`).join("\n"));
});

test("QA3 N3-M1: \"wa\" counts only as an app (on/via/@ wa), never Washington", () => {
  assert.ok(!stripContacts("Hiker. msg me at deexy on wa").includes("deexy"));
  for (const bio of ["Seattle (WA) native", "From Perth, WA.", "Engineer at WA state parks"]) assert.equal(stripContacts(bio), bio);
});

test("QA3 N3-M1: an interest chip that is only an app name goes, and so does a handle-like chip next to one", async () => {
  const { publicInterests } = await import("./contacts.ts");
  assert.deepEqual(publicInterests(["telegram", "deex_99"]), []);
  assert.deepEqual(publicInterests(["Telegram", "surfing", "deex99"]), ["surfing"]);
  assert.deepEqual(publicInterests(["on insta", "dee.x", "chess"]), ["chess"]);
  assert.deepEqual(publicInterests(["ＴＧ", "@deexy", "yoga"]), ["yoga"]);
  // Without an app-name chip, ordinary chips that look technical stay; with one, ordinary compounds still stay.
  assert.deepEqual(publicInterests(["AI", "web3", "node.js", "surfing"]), ["AI", "web3", "node.js", "surfing"]);
  assert.deepEqual(publicInterests(["tg", "node.js", "gpt4", "3d printing"]), ["node.js", "gpt4", "3d printing"]);
  assert.deepEqual(publicInterests(["Telegram bots", "Instagram reels"]), ["Telegram bots", "Instagram reels"]);
});

test("QA3 N3-M1: sign-up drops the app-name chip and its handle (validate.ts)", async () => {
  const { parseProfile } = await import("./validate.ts");
  const r = parseProfile({ name: "Dee", lookingFor: ["friends"], interests: ["telegram", "deex_99", "surfing"], telegram: "deexy_tg", bio: "yoga & deexy on ig" });
  assert.ok("profile" in r, JSON.stringify(r));
  assert.deepEqual(r.profile.interests, ["surfing"]);
  assert.ok(!r.profile.bio.includes("deexy"), r.profile.bio);
});

// Code review of N3-M1: nothing 2989f6e removed with a plain handle may come back, the new patterns stay linear, and
// the review's false positives stay as written.
test("review: every plain-handle form 2989f6e removed is still removed (names that end like words too)", async () => {
  const old = (await import("./test-support/contacts-2989f6e.ts")).stripContacts;
  const names = ["deexy", "dexter", "james", "oliver", "peter", "victor", "taylor", "connor", "harper", "sebastian", "lucas", "trevor",
    "alexander", "christopher", "jules", "vivian", "agnes", "priya", "rahul", "miles", "chris", "marcus", "carlos", "anders", "williams",
    "roberts", "edwards", "evans", "lars", "hans", "jens", "nils", "mats", "ahmed", "mohammed", "ted", "fred", "jared", "alfred",
    "dev", "king", "sterling", "aditi", "kabir", "zoya", "olga", "sven"];
  const shapes = (h) => [`${h} on insta`, `I'm ${h} on ig`, `Yoga, ${h} on ig`, `Surfer | ${h} on insta`, `Coffee, ${h} via whatsapp`,
    `it is ${h} on ig`, `Name is ${h} on tg`, `insta, ${h} for collabs`, `telegram, ${h} lol`, `tg, ${h}`, `Insta, ${h}.`,
    `Insta, ${h} & tg, ${h}`, `Builder (${h} on insta)`, `Surfer. ${h} at telegram`, `Builder - ${h} on snapchat`, `ping ${h} on tg`,
    `follow ${h} on ig`, `Me: ${h} on ig`, `tg, ${h} or whatsapp`, `on insta, ${h} lol`, `deexy on insta, ${h} on tg`];
  const lost = [];
  for (const h of names) for (const s of shapes(h)) if (!old(s).includes(h) && stripContacts(s).includes(h)) lost.push(`${s} -> ${stripContacts(s)}`);
  // The one known trade-off: after "<app>, " a word ending in "-ing" followed by "on <app>" reads as a gerund
  // ("Lurking on tg, posting on insta"), so "deexy on insta, king on tg" keeps "king" (2989f6e removed it).
  assert.deepEqual(lost, ["deexy on insta, king on tg -> [removed], king on tg", "deexy on insta, sterling on tg -> [removed], sterling on tg"]);
});

test("review: lookbacks are bounded, so many candidates stay fast", () => {
  for (const s of ["a zork on ig ", "word at ig ", "xxxx on wa ", "the zork (tg) ", "hit me up deexy on insta, "]) {
    const x = s.repeat(Math.ceil(200_000 / s.length));
    const t = performance.now();
    stripContacts(x);
    assert.ok(performance.now() - t < 3000, `${JSON.stringify(s)}: ${Math.round(performance.now() - t)} ms`);
  }
});

test("review: DM, handle-is and lead-in shapes leave ordinary words alone", () => {
  for (const bio of ["DMs welcome", "DMs appreciated", "DMs preferred", "DM questions", "Founders: DM ideas", "handle is pending",
    "my handle everywhere is taken", "Catch sunsets on insta", "Search for meaning on insta", "Dad jokes on whatsapp, real jokes in person"]) {
    assert.equal(stripContacts(bio), bio);
  }
  assert.equal(stripContacts("DM deexy"), "DM [removed]");
});

test("review: technical chips next to an app chip stay", async () => {
  const { publicInterests } = await import("./contacts.ts");
  assert.deepEqual(publicInterests(["GitHub", "d3.js"]), ["d3.js"]);
  assert.deepEqual(publicInterests(["TikTok", "a11y", "i18n"]), ["a11y", "i18n"]);
  assert.deepEqual(publicInterests(["telegram", "deex_99", "dee.x"]), []);
});

// QA4 Q4-M1: an app name, then a handle, then more words ("tg deex9 anytime", "deexy is my insta", "Insta? deexy"). The
// word-window pass after the patterns, and ordinary English words (lib/common-words.ts) next to app names.
const { QA4_LEAKS, QA4_ADVERSARIAL, QA4_UNTUNED_BIOS, QA4_APP_BIOS, QA4_BLIND_LEAKS, QA4_BLIND_BIOS, QA4_BLIND2_LEAKS, QA4_BLIND2_BIOS, QA4_BLIND3_LEAKS,
  QA4_BLIND3_BIOS } =
  await import("./contacts-qa4.fixture.mjs");
const leftIn = (list) => list.filter(([input, secret]) => stripContacts(input).includes(secret)).map(([i]) => `${JSON.stringify(i)} -> ${JSON.stringify(stripContacts(i))}`);
const changedIn = (list) => list.filter((b) => stripContacts(b) !== b).map((b) => `${JSON.stringify(b)} -> ${JSON.stringify(stripContacts(b))}`);

test("QA4 Q4-M1: every form from the report and its logs is removed", () => {
  assert.ok(QA4_LEAKS.length >= 30);
  assert.deepEqual(leftIn(QA4_LEAKS), []);
});

test("QA4 Q4-M1: 150+ more forms (punctuation, emoji, word order, filler, Unicode) are removed", () => {
  assert.ok(QA4_ADVERSARIAL.length >= 150);
  assert.deepEqual(leftIn(QA4_ADVERSARIAL), []);
});

test("QA4 Q4-M1: the blind sets lose their handles, but for the known misses", () => {
  assert.deepEqual(leftIn(QA4_BLIND_LEAKS), []);
  assert.ok(QA4_BLIND2_LEAKS.length >= 170 && QA4_BLIND3_LEAKS.length >= 160);
  // After "?" comes an answer, in which any English word is a word ("insta? used to", "insta? quit last year").
  assert.deepEqual(leftIn(QA4_BLIND2_LEAKS), ['"insta? pickle" -> "insta? pickle"']);
  // The trade-off and what no word window sees: an English word with nothing but the app name next to it (biscuit,
  // pebble, seashell), an English handle used again as a word (pickle, nomad), and handles far from the app name.
  assert.deepEqual(leftIn(QA4_BLIND3_LEAKS), [
    '"Gorvandi. That\'s the telegram. That\'s the bio." -> "Gorvandi. That\'s the telegram. That\'s the bio."',
    '"Ask for my snap or just add yelvarna" -> "Ask for my snap or just add yelvarna"',
    '"Insta is the best way to reach me: kumbravel" -> "Insta is the best way to reach me: kumbravel"',
    '"insta is pickle, yes just pickle, I got in early" -> "[removed], yes just pickle, I got in early"',
    '"snap biscuit 🍪" -> "snap biscuit 🍪"',
    '"sc pebble" -> "sc pebble"',
    '"find me on telegram: nomad (I\'m not a nomad, I\'m from Pune)" -> "find me on [removed] (I\'m not a nomad, I\'m from Pune)"',
    '"insta seashell 🐚 marine biologist on sabbatical" -> "insta seashell 🐚 marine biologist on sabbatical"',
  ]);
});

test("review 2 QA4: Hinglish, \"handle:\" alone, gerunds, answers, follower counts and initials stay as written", () => {
  for (const bio of ["insta aur whatsapp dono band", "insta nahi hai mera", "insta toh dead hai", "insta mein reels", "Bas insta aur chai",
    "insta me bahut active hoon", "tg me sab crypto wale hain", "insta casi nunca", "insta und tg", "Telegram pe itne groups hain ki main pagal ho gaya",
    "Things I can't handle: mornings", "Can't handle: spicy food, small talk", "Govt ID: verified", "Student ID: expired", "Username: forgot it",
    "Usernames: hard", "Payments handle: Razorpay", "Sarcasm is my username", "Kitesurfing on insta, coding on github", "Island hopping on insta",
    "Café hopping on insta", "insta? used to", "insta? quit last year", "insta? gave up on it", "Insta? Haven't opened it in months", "Insta? Detoxing",
    "The best momos on insta are in Panjim", "my Kathakali troupe on insta", "lots of Goan susegad on insta", "Watched Diljit on insta live",
    "insta 4.5k followers", "tg mostly 1.5k members", "IG 2k24 dump", "tg gr8 for news", "SC: Supreme Court advocate", "Insta: café et croissants",
    "my dad T.G. Menon", "telegram enjoyer", "Instagram couple? No. Couple who argues about Instagram? Yes",
    "Telegram? Sure, but I'd rather talk at the beach.", "Tired of 'hey' on WhatsApp, start with a joke", "WhatsApp status: at the beach"]) {
    assert.equal(stripContacts(bio), bio);
  }
});

test("review 2 QA4: misspelt app names, brackets, answers, pointers back and repeats lose the handle", () => {
  for (const [input, secret] of [["I.G. Deexy", "Deexy"], ["insta pe kavya hai", "kavya"], ["kavya - insta", "kavya"], ["kavya | insta", "kavya"],
    ["insta • deexy", "deexy"], ["insta… deexy", "deexy"], ["insta «deexy»", "deexy"], ["(deexy) on ig", "deexy"], ["deexy on whats app", "deexy"],
    ["kavya is my whats app", "kavya"], ["ganesh on insta", "ganesh"], ["hmu on tg, name's deexy", "deexy"], ["instgram deexy", "deexy"],
    ["insata: deexy", "deexy"], ["teIegram: deexy", "deexy"], ["telegrammm: deexy", "deexy"], ["Snap chat: deexy", "deexy"],
    ["Insta (private, request away): deexy", "deexy"], ["snap? sure — deexy", "deexy"], ["IG? ok fine, it's deexy", "deexy"],
    ["deexy 👈 that's my ig", "deexy"], ["my insta handle’s deexy", "deexy"], ["WA username deexy", "deexy"], ["Telegram pe add karo: deexy", "deexy"],
    ["whatsapp id hai mera: rohit.2026", "rohit.2026"], ["ping me on instaa, deexy", "deexy"], ["sc deexy, tg deexy", "deexy"],
    ["kavya on insta, kavya on tg, kavya irl", "kavya"], ["deexy is my tg, deexy is also my D&D name", "deexy"], ["deexy@gmail.com, or just deexy", "deexy"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
  // A repeat is removed only when it is no English word: the second "pickle" is a word again, so is "gmail".
  assert.equal(stripContacts("insta is pickle, yes just pickle"), "[removed], yes just pickle");
  assert.equal(stripContacts("deexy@gmail.com. I like gmail"), "[removed]. I like gmail");
});

test("review 2 QA4: many different handles stay fast (repeats are looked up, not matched one by one)", () => {
  const x = Array.from({ length: 20_000 }, (_, k) => `tg zork${k}x`).join(" ");
  const t = performance.now();
  stripContacts(x);
  assert.ok(performance.now() - t < 3000, `${Math.round(performance.now() - t)} ms`);
});

// Third review of the word pass (QA4): Hindi words that are names, brackets before ":", look-backs, quoted words,
// repeats only of the handle itself, misspellings and accents.
test("review 3 QA4: names, bracketed remarks, misspellings and accented handles lose the handle", () => {
  for (const [input, secret] of [["ig handle: diya", "diya"], ["insta: diya", "diya"], ["diya on insta", "diya"], ["tg: raha", "raha"], ["insta: koi", "koi"],
    ["Instagram (studio): goa_pottery", "goa_pottery"], ["Insta (ask Meera): goa_pottery", "goa_pottery"], ["Insta (run by Meera): goapottery", "goapottery"],
    ["isnta deexy", "deexy"], ["intsa: deexy", "deexy"], ["snpachat: deexy", "deexy"], ["lnsta deexy", "deexy"], ["1nsta deexy", "deexy"],
    ["inst4: deexy", "deexy"], ["insta gram: deexy", "deexy"], ["tele gram: deexy", "deexy"], ["insta-gram deexy", "deexy"], ["snap-chat: deexy", "deexy"],
    ["whats-app: deexy", "deexy"], ["tg: rohän", "roh"], ["kavya is my tg", "kavya"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
  assert.equal(stripContacts("insta: andré"), "[removed]", "an accented name goes whole, never \"[removed]é\"");
});

test("review 3 QA4: look-backs, quoted words, repeats and near-misses of app names leave ordinary text alone", () => {
  for (const bio of ["Sunsets and dogs. That's my insta.", "My kids. That's my insta now", "Love dogs 🐶 that's my insta", "Sarcasm is my insta",
    "Kathakali is my insta", "Recipes (vegan) on insta", 'Watch "Monsoon" on insta', 'My series "Konkan Diaries" on insta', "My sketches (Goa series) on insta",
    "Whatsup Kavya! Kavya here", "Whatsup? Rohan here", "Telegraf configs and Grafana", "instax Rohan", "insta kam use karti hoon", "Insta: café et croissants"]) {
    assert.equal(stripContacts(bio), bio);
  }
  // Only the removed handle comes back out, never another word of what was removed.
  assert.ok(stripContacts("My username for Arjun's events is deex_99. Arjun is my cofounder.").endsWith("Arjun is my cofounder."));
  assert.ok(stripContacts("Insta (managed by Rohan): studiogoa. Rohan cooks the best vindaloo.").includes("Rohan cooks"));
  assert.ok(stripContacts("Read https://medium.com/@priya/surf . Priya surfs daily").endsWith("Priya surfs daily"));
  assert.ok(stripContacts("Mostly on bsky: deexy. bsky is nice").endsWith("bsky is nice"));
});

// Fourth review (QA4): a handle alone in brackets before a separator, and Hindi name-words in a Hindi sentence.
test("review 4 QA4: a handle in brackets before a separator goes; a name-word in a sentence of words stays", () => {
  for (const [input, secret] of [["Insta (deexy): dms open", "deexy"], ["Find me on insta (deexy) - dms open", "deexy"],
    ["Instagram (zorvik) – art and chai", "zorvik"], ["telegram (deexy) → dm anytime", "deexy"], ["Instagram (studio): goa_pottery", "goa_pottery"],
    ["tg deexy is my insta. deexy irl too", "deexy"], ["insta: diya for collabs", "diya"], ["ig handle: diya", "diya"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
  for (const bio of ["tg me koi nahi hai", "insta me kam active hoon", "whatsapp me mai available hu", "insta me diya ki photos hain", "insta is kam use",
    "Insta (studio): pottery classes"]) {
    assert.equal(stripContacts(bio), bio);
  }
});

test("review 3 QA4: a long word ending in an accent stays fast", () => {
  for (const s of ["tg " + "a".repeat(100_000) + "é", "insta: " + "a".repeat(200_000) + "é x", ("ab".repeat(20) + "é ").repeat(5000),
    "tg-".repeat(66_667) + "é", "insta-".repeat(33_334) + "é"]) {
    const t = performance.now();
    stripContacts(s);
    assert.ok(performance.now() - t < 3000, `${JSON.stringify(s.slice(0, 8))}: ${Math.round(performance.now() - t)} ms`);
  }
});

// Code review of the word pass (QA4): names the describing check took for words, handle-shaped compounds, accents,
// hashtags, initials, slang, "I guess", "-ed" names, and runs of "-" that took a minute.
test("review QA4: names and nouns stay handles where the text says one follows", () => {
  for (const [input, secret] of [["telegram: billy", "billy"], ["my ig is billy", "billy"], ["billy (insta)", "billy"], ["telegram: garlic", "garlic"],
    ["my ig is cosmic", "cosmic"], ["telegram: olive", "olive"], ["my ig is darling", "darling"], ["insta → spring", "spring"], ["telegram: seed", "seed"],
    ["my tg is manning", "manning"], ["fareed is my insta", "fareed"], ["I go by fareed on ig", "fareed"], ["snap me fareed", "fareed"],
    ["insta fareed anytime", "fareed"], ["telegram: dusty", "dusty"], ["ahmed on insta", "ahmed"], ["Surfer, javed on ig", "javed"],
    ["I'm syed on tg", "syed"], ["ping mohammed on insta", "mohammed"], ["my insta's sunny", "sunny"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
});

test("review QA4: handle-shaped words go anywhere in the window, compounds of bio words too", () => {
  for (const [input, secret] of [["Insta? chai_lover", "chai_lover"], ["chai_lover is my insta", "chai_lover"], ["insta ➜ chai_lover", "chai_lover"],
    ["Insta? yoga.life", "yoga.life"], ["insta coffee_addict for pics", "coffee_addict"], ["insta also sunny_2024", "sunny_2024"], ["tg mostly deex99", "deex99"],
    ["deexy = my insta", "deexy"], ["deexy is also my insta", "deexy"], ["insta # deexy", "deexy"], ["wa me deexy", "deexy"], ["tg deexy & wa venzo", "venzo"],
    ["sc: qobbi", "qobbi"], ["tele - m0ksh", "m0ksh"], ["whats app username trishaal", "trishaal"], ["hit me up on whatsapp, username: oombri", "oombri"],
    ["whatsapp me, ojasvee is my username", "ojasvee"], ['"hrisaa" on insta lol', "hrisaa"], ["[ig] nirvexo", "nirvexo"], ["u can find me on snap, its jivrah", "jivrah"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
  for (const bio of ["ig reels_2024 fan", "telegram bots_and_agents builder", "Insta? d3.js mostly", "tg 24x7", "insta in 4k"]) assert.equal(stripContacts(bio), bio);
});

test("review QA4: accents, hashtags, initials, slang and \"I guess\" next to an app name stay as written", () => {
  for (const bio of ["Insta café vibes", "Instagram café hopping in Goa", "my insta jalapeño phase", "Insta fiancé hunting lol",
    "IG #travel #goa", "insta #goals", "tg #crypto", "Dr. T. G. Krishnan is my uncle", "Prof. I.G. Patel fan", "my dad T.G. Menon", "Ig Nobel prize nerd",
    "I quit insta cuz it's toxic", "too many insta ppl here", "tg pfp is my cat", "insta hiatus since march", "my insta algo is all dogs", "Insta ootd queen",
    "Insta & chill", "IG + Spotify", "insta 🙃 whatever", "Insta? Quit last year", "insta? dunno", "tg? lmk", "insta me sometime", "Snap (uninstalled)",
    "insta til i die", "ig im chill", "ig im lowkey a nerd", "ig: paintings", "spokane wa → bangalore → mandrem", "uninstall insta on monday",
    "telegram bot builder, insta lurker, snap avoider, whatsapp survivor", "instagram is exhausting, i deleted it in march"]) {
    assert.equal(stripContacts(bio), bio);
  }
});

test("review QA4: runs of \"-\" and \"+\" stay fast", () => {
  for (const s of ["a" + "-".repeat(200_000), "ab-".repeat(66_667), "a" + "+".repeat(200_000), "-".repeat(200_000) + " deexy on insta"]) {
    const t = performance.now();
    stripContacts(s);
    assert.ok(performance.now() - t < 3000, `${JSON.stringify(s.slice(0, 6))}: ${Math.round(performance.now() - t)} ms`);
  }
});

test("QA4 Q4-M1: ordinary bios that name an app stay exactly as written", () => {
  assert.deepEqual(changedIn(QA4_UNTUNED_BIOS), []);
  assert.ok(QA4_APP_BIOS.length >= 150);
  assert.deepEqual(changedIn(QA4_APP_BIOS), []);
  assert.deepEqual(changedIn(QA4_BLIND_BIOS), []);
  assert.deepEqual(changedIn(QA4_BLIND2_BIOS), []);
  assert.deepEqual(changedIn(QA4_BLIND3_BIOS), []);
});

test("QA4 Q4-M1: only the app name and the handle go, the rest of the bio stays", () => {
  assert.equal(stripContacts("Coder. tg deex9 anytime"), "Coder. [removed] anytime");
  assert.equal(stripContacts("my ig is deexy if you want photos"), "my [removed] if you want photos");
  assert.equal(stripContacts("deexy is my insta"), "[removed]");
  assert.equal(stripContacts("I go by deexy on insta"), "I go by [removed]");
  assert.equal(stripContacts("Ask for deexy on telegram"), "Ask for [removed]");
  assert.equal(stripContacts("Surfer. Hit me up deexy on insta. tg deex9 anytime"), "Surfer. Hit me up [removed]. [removed] anytime");
  assert.equal(stripContacts("ɪɢ deexy, I.G. deexy"), "[removed], [removed]");
});

test("QA4 Q4-M1: a handle that is an English word still goes where the words around say \"handle\"", () => {
  for (const [input, secret] of [["telegram: chai", "chai"], ["my ig is sunny", "sunny"], ["tg → pixel anytime", "pixel"], ["Insta: mango", "mango"],
    ["snap me river", "river"], ["find me on insta bliss", "bliss"], ["Surfer. ig chai.", "chai"], ["mango (insta)", "mango"], ["I go by mango on tg", "mango"],
    ["ping river on tg", "river"], ["Insta: halwa. Obsessed with chai", "halwa"], ["I'm on tg as sunny", "sunny"], ["insta, dev for collabs", "dev"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
});

test("QA4 Q4-M1: an English word next to an app name, with nothing saying \"handle\", is a word (14 bios f9f2a48 changed)", () => {
  for (const bio of ["My mom only sends WhatsApp forwards", "Ex-Instagram engineer, now building for farmers", "Instagram is toxic, the ocean is not",
    "Helping cafes with their Instagram presence", "My Bebinca recipe went viral on Instagram once", "Feni tasting notes on my Instagram, cheers",
    "Building an AI that writes Instagram captions (ironic, I know)", "insta-perfect breakfasts at Ashwem", "Always on WhatsApp, sorry in advance",
    "Insta aesthetic, chaotic reality", "Posting my poetry on Instagram, slowly", "Pottery on insta, mud on my jeans", "Telegram: muted. Beach: unmuted.",
    "I teach breathwork, schedule on telegram", "Hosting a Friday potluck, details on whatsapp", "Telegram dev here, building mini apps",
    "Insta is my portfolio", "Instagram's world", "IG dm slides: not a love language", "WhatsApp me never lol", "IG me? Nah, find me at the beach",
    "Seattle (WA) native, Perth, WA too", "Snap peas are my favourite snack", "Telegram groups are chaos", "addicted to snap filters"]) {
    assert.equal(stripContacts(bio), bio);
  }
});

test("QA4 Q4-M1: the word pass stays linear on long texts", () => {
  for (const s of ["tg zork ", "insta: zork ", "zork is my ig ", "I go by zork on tg ", "ig ? ? ? ? zork ", "the gram as zork ", "a/wa ", "tg 👉 "]) {
    const x = s.repeat(Math.ceil(200_000 / s.length));
    const t = performance.now();
    stripContacts(x);
    assert.ok(performance.now() - t < 3000, `${JSON.stringify(s)}: ${Math.round(performance.now() - t)} ms`);
  }
});

test("QA4 Q4-M1: interest chips and every other text go through the same function", async () => {
  const { publicInterests } = await import("./contacts.ts");
  assert.deepEqual(publicInterests(["tg deex9 anytime", "surfing"]), ["surfing"]); // QA5 Q5-L4: a chip that held a contact goes whole
  assert.deepEqual(publicInterests(["Insta? deexy", "chess"]), ["chess"]);
});

test("QA4 Q4-M1: the common-word list knows inflections but not names that end like them", async () => {
  const { isCommonWord, isWord } = await import("./common-words.ts");
  for (const w of ["groups", "decided", "running", "happier", "notifications", "cleanups", "engagement", "photos", "i'm"]) assert.ok(isCommonWord(w), w);
  for (const w of ["james", "jared", "oliver", "peter", "tony", "andy", "lucas", "deexy", "zorvik", "dev", "miles", "king"]) assert.ok(!isCommonWord(w), w);
  assert.ok(isWord("dev") && !isWord("deexy"));
});

// QA5 Q5-L1: innocent bios that name an app still changed (4 of QA5's 60): words missing from the list ("villain",
// "longer"), "at" read as sure ("WhatsApp at dinner"), "<app> is my X" read as a handle shape, "ex-<word>" after "<app>,".
const { QA5_LEAKS, QA5_INNOCENT, QA5_PROBES, QA5_QA4_LEAKS, QA5_QA4_BENIGN } = await import("./contacts-qa5.fixture.mjs");
const digitsOf = (s) => s.replace(/[\s\-().+]/g, "");
const leaksIn = (list) => list.filter(([text, , needles]) => {
  const out = stripContacts(text);
  return needles.some((n) => (/^\d+$/.test(n) ? digitsOf(out).includes(n) : out.toLowerCase().includes(n.toLowerCase())));
}).map(([text]) => `${JSON.stringify(text)} -> ${JSON.stringify(stripContacts(text))}`);

test("QA5 Q5-L1: QA5's 60 innocent app bios and the probes of the four causes stay exactly as written", () => {
  assert.equal(QA5_INNOCENT.length, 60);
  assert.deepEqual(changedIn(QA5_INNOCENT), []);
  assert.ok(QA5_PROBES.length >= 40);
  assert.deepEqual(changedIn(QA5_PROBES), []);
});

test("QA5 Q5-L1: none of QA5's 50 natural leak forms leaks; the evasions that get through are the known four", () => {
  const natural = QA5_LEAKS.filter(([, kind]) => kind === "N"), evasions = QA5_LEAKS.filter(([, kind]) => kind === "E");
  assert.equal(natural.length, 50);
  assert.deepEqual(leaksIn(natural), []);
  assert.deepEqual(leaksIn(evasions), [
    '"find me on the gram, k a b i r s u r f s" -> "find me on the gram, k a b i r s u r f s"',
    '"inst@: meera.paints" -> "inst@: meera.paints"',
    '"my handle is the word saltwater on the bird app" -> "my handle is the word saltwater on the bird app"',
    '"Find me on Insta, handle starts with kabir and ends with surfs" -> "Find me on [removed] with kabir and ends with surfs"',
  ]);
});

test("QA5 Q5-L1: QA4's forms as QA5 rebuilt them leak nothing; of QA4's bios only chess.com changes (a link)", () => {
  assert.deepEqual(QA5_QA4_LEAKS.filter((t) => /deex/i.test(stripContacts(t)) || /\d{8,}/.test(digitsOf(stripContacts(t)))), []);
  assert.deepEqual(QA5_QA4_BENIGN.filter((b) => stripContacts(b) !== b).map((b) => stripContacts(b)),
    ["Building agents, mostly on X. Love [removed] puzzles and Telegram bots. Ask me about reels."]);
});

test("QA5 Q5-L1: \"than\", \"at\", \"<app> is my X\" and \"ex-\" still let handles go", () => {
  for (const [input, secret] of [["insta at deexy", "deexy"], ["telegram at kavya_99", "kavya_99"], ["ping me on telegram at deex_99", "deex_99"],
    ["WhatsApp @ chai", "chai"], ["insta @chai", "chai"], ["insta is my deex_99", "deex_99"], ["tg is my dee.x", "dee.x"], ["my insta is deexy", "deexy"],
    ["deexy is my insta", "deexy"], ["telegram: river", "river"], ["tg deex_99 than ever", "deex_99"], ["insta: deex_99 rather than whatsapp", "deex_99"],
    ["tg: deexy, faster than email", "deexy"], ["tg: my handle is deexy", "deexy"], ["insta is my handle: deexy", "deexy"],
    ["Telegram is my therapist, deexy on tg", "deexy"], ["Instagram is my diary. Insta: kabirsurfs", "kabirsurfs"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
  // QA5 review: names that are dictionary words, "my" followed by id/name/":", "than" for "then", "handle:".
  for (const [input, secret] of [["Pooja on IG", "Pooja"], ["Sameer on insta, dms open", "Sameer"], ["tg pooja anytime", "pooja"], ["Insta at sameer", "sameer"],
    ["Insta? sameer", "sameer"], ["snap username sameer", "sameer"], ["Raja on insta", "Raja"], ["shiva on tg", "shiva"], ["Pinky on IG", "Pinky"],
    ["heller on insta", "heller"], ["talbot on tg", "talbot"], ["Telegram, it's my id: kabirsurfs", "kabirsurfs"], ["IG is my ID - kabirsurfs", "kabirsurfs"],
    ["Find me on insta, its my name kabirsurfs", "kabirsurfs"], ["Telegram is my name: kabirsurfs", "kabirsurfs"], ["insta's my id: kabirsurfs", "kabirsurfs"],
    ["Insta is my user id kabirsurfs", "kabirsurfs"], ["tg is my dm: kabirsurfs", "kabirsurfs"], ["Insta is my @ kabirsurfs", "kabirsurfs"],
    ["Follow me on insta kabirsurfs than DM", "kabirsurfs"], ["Add me on snap kabirsurfs than we chat", "kabirsurfs"],
    ["Snap me at kabirsurfs than we can talk", "kabirsurfs"], ["Telegram: kabirsurfs than call", "kabirsurfs"],
    ["Insta handle: kabirsurfs than we move to whatsapp", "kabirsurfs"], ["insta handle: mango than dm", "mango"], ["snap username: ex-deexy", "ex-deexy"],
    // Review 2: names made words by forms of the list's words, and nouns before "than" after ":" / "is".
    ["Prem on insta", "Prem"], ["Shiv on tg, dms open", "Shiv"], ["Nazir on insta", "Nazir"], ["tg prem anytime", "prem"], ["Insta? shiv", "shiv"],
    ["Rashed on IG", "Rashed"], ["Hastings on insta", "Hastings"], ["Morales on ig", "Morales"], ["Surfer. ig crocker.", "crocker"],
    ["Telegram: chai than whatsapp", "chai"], ["Snap: pickle than we talk", "pickle"], ["tg: river than call", "river"],
    ["Find me on insta, mango than DM", "mango"], ["my insta is sunny than dm", "sunny"]]) {
    assert.ok(!stripContacts(input).includes(secret), `${input} -> ${stripContacts(input)}`);
  }
  // The trade-off: after the word "at" an English word is a word, as anywhere only an app name is next to it.
  assert.equal(stripContacts("insta at mango"), "insta at mango");
  assert.equal(stripContacts("insta: mango"), "[removed]");
});

test("QA5 Q5-L1: the frequency list and -er/-est forms of listed adjectives are words; names stay unknown", async () => {
  const { isCommonWord, isDescribing, isRole } = await import("./common-words.ts");
  for (const w of ["longer", "faster", "older", "nicer", "bigger", "latest", "villain", "therapist", "lifeline", "dinner", "bedtime"]) assert.ok(isCommonWord(w), w);
  for (const w of ["slower", "longest", "redder"]) assert.ok(isDescribing(w), w);
  for (const w of ["oliver", "peter", "potter", "hunter", "walker", "tyler", "dexter", "james", "jared", "tony", "andy", "lucas", "deexy", "zorvik",
    "dev", "miles", "king", "billy", "rocky", "sandy", "kabir", "tara", "saanvi", "priya", "rahul", "nils", "mats", "woody", "sameer", "pooja", "raja",
    "shiva", "ram", "baba", "pinky", "coco", "nova", "heller", "webber", "steiner", "slater", "granger", "talbot", "bowie", "wilder", "kinder",
    "prem", "shiv", "nazir", "rashed", "hastings", "morales", "chambers", "cummings", "crocker"]) {
    assert.ok(!isCommonWord(w) && !isRole(w) && !isDescribing(w), w);
  }
  assert.ok(isRole("therapist") && isRole("activists") && !isRole("list") && !isRole("mist"));
});

test("QA5 Q5-L1: the word lists stay server-only (no \"use client\" module imports lib/contacts.ts or lib/common-words.ts)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = path.resolve(import.meta.dirname, "..");
  const all = fs.readdirSync(src, { recursive: true }).map((f) => path.join(src, f)).filter((f) => /\.(?:ts|tsx)$/.test(f) && !/\.test\./.test(f));
  const resolve = (from, spec) => {
    const p = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    return p && [p, `${p}.ts`, `${p}.tsx`, path.join(p, "index.ts"), path.join(p, "index.tsx")].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  };
  const reached = [];
  for (const file of all.filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")))) {
    const seen = new Set(), stack = [file];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      // Type-only imports are erased from the bundle.
      for (const m of fs.readFileSync(x, "utf8").matchAll(/(?:import|export)\s(?!type\s)[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm)) {
        const r = resolve(x, m[1] ?? m[2] ?? m[3]);
        if (r) stack.push(r);
      }
    }
    for (const x of seen) if (/(?:^|[\\/])(?:contacts|common-words(?:-freq)?)\.ts$/.test(x)) reached.push(`${path.relative(src, file)} -> ${path.relative(src, x)}`);
  }
  assert.deepEqual(reached, []);
});

test("QA5 Q5-L4: an interest chip that held a contact goes whole, never shows \"[removed]\"", async () => {
  const { publicInterests } = await import("./contacts.ts");
  assert.deepEqual(publicInterests(["whatsapp 9876543210", "Telegram bots"]), ["Telegram bots"]);
  assert.deepEqual(publicInterests(["phone 9876543210", "surfing"]), ["surfing"]);
  assert.deepEqual(publicInterests(["ig deex_99", "mail dee@gmail.com", "see deexy.com", "chess"]), ["chess"]);
  assert.deepEqual(publicInterests(["whatsapp [removed]", "yoga"]), ["yoga"]); // stored before the fix, dropped on read
  assert.ok(publicInterests(["AI", "Telegram bots", "web3", "surfing", "Book club", "WhatsApp groups"]).every((c) => !c.includes("[removed]")));
  assert.deepEqual(publicInterests(["AI", "Telegram bots", "web3"]), ["AI", "Telegram bots", "web3"]);
});
