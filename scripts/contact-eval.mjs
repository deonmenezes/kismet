// Optional live eval of the model contact check (lib/contact-check.ts); not part of npm test. Calls the real model chain
// (GMI DeepSeek V4.1 Flash first) on the QA5 evasions, a held-out set of evasions written after the prompt (never in it),
// and 100 innocent bios, each after stripContacts as in production, and prints catch and false-positive rates.
// Reads only the model keys (GMI_API_KEY, AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN) from the env file given; never a
// database URL, and it writes nothing anywhere.
//   node --experimental-strip-types --no-warnings scripts/contact-eval.mjs <path/to/.env.local> [budgetMs]
import { readFileSync } from "node:fs";

const [envPath, budgetArg] = process.argv.slice(2);
if (!envPath) throw new Error("usage: contact-eval.mjs <path/to/.env.local> [budgetMs]");
for (const k of Object.keys(process.env)) if (/^(DATABASE_URL|POSTGRES|PG)/.test(k)) delete process.env[k];
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^(GMI_API_KEY|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!process.env.GMI_API_KEY && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) throw new Error("no model key in that file");
const budgetMs = Number(budgetArg ?? 3000);

const { needsModel, screenFields } = await import("../src/lib/contact-check.ts");
const { stripContacts } = await import("../src/lib/contacts.ts");
const { QA5_LEAKS, QA5_INNOCENT } = await import("../src/lib/contacts-qa5.fixture.mjs");
const { QA4_UNTUNED_BIOS } = await import("../src/lib/contacts-qa4.fixture.mjs");
const { QA3_BIOS_HELDOUT } = await import("../src/lib/contacts-qa3.fixture.mjs");

// [text, needles]: a needle must not survive (digits compared without spaces and dashes).
const QA_EVASIONS = [
  ...QA5_LEAKS.filter(([, k]) => k === "E").map(([t, , n]) => [t, n]),
  ["snap biscuit", ["biscuit"]],
  ["insta? pickle", ["pickle"]],
];
// Written after the prompt, never shown to it: the honest catch rate.
const HELDOUT_EVASIONS = [
  ["you'll find my art if you look up r i y a d r a w s on the photo app", ["r i y a d r a w s"]],
  ["ping me on the paper plane app, I'm arjun underscore builds", ["arjun underscore builds"]],
  ["number's nine-eight-two-two, then four-four-five, then six-one-two", ["nine-eight-two-two"]],
  ["my yellow ghost app name is zoyafilms", ["zoyafilms"]],
  ["search 'tara makes pots' on youtube, that's my channel", ["tara makes pots"]],
  ["IG: m e h e r . l e n s", ["m e h e r"]],
  ["insta is the reverse of sfrusribak", ["sfrusribak"]],
  ["I'm on telegrm as nikhilbuilds", ["nikhilbuilds"]],
  ["WhatsApp nine eight seven six five, four three two one zero", ["nine eight seven six five"]],
  ["my socials all use the same name: dhruvmakes", ["dhruvmakes"]],
  ["look for dhruv makes things, all one word, on the camera app", ["dhruv makes things"]],
  ["linkedin slash in slash priya-raman", ["priya-raman"]],
  ["my handle is my name backwards, ayirp, on insta", ["ayirp"]],
  ["Tg: ka-bir-surfs", ["ka-bir-surfs"]],
  ["come say hi on the purple app, I'm surfwithkabir there", ["surfwithkabir"]],
  ["you can text my digits: 98 20 one two three 45 67", ["one two three 45"]],
  ["Potter by day. on the gram I go by clayqueen", ["clayqueen"]],
  ["drop a hi on the green chat app: plus nine one, nine eight two zero, one one two two three", ["nine eight two zero"]],
  ["my email is the obvious one, firstname dot lastname at the google one: anika dot rao", ["anika dot rao"]],
  ["Snap me, I'm under mango.tango", ["mango.tango"]],
];
const INNOCENT = [...QA4_UNTUNED_BIOS, ...QA3_BIOS_HELDOUT, ...QA5_INNOCENT.slice(0, 28)];
if (INNOCENT.length !== 100) throw new Error(`expected 100 innocent bios, got ${INNOCENT.length}`);

const gone = (text, needle) => (/^\d/.test(needle) ? !text.replace(/[\s-]/g, "").includes(needle) : !text.toLowerCase().includes(needle.toLowerCase()));
const quiet = { log: console.log, warn: console.warn };
async function run(text) {
  const scrubbed = stripContacts(text);
  const t = Date.now();
  console.log = console.warn = () => {};
  try {
    const r = await screenFields({ bio: scrubbed }, { budgetMs });
    return { scrubbed, out: r.values.bio, checked: r.checked, called: r.called, ms: Date.now() - t };
  } finally {
    console.log = quiet.log;
    console.warn = quiet.warn;
  }
}

async function evasions(name, list) {
  let regex = 0, caught = 0, unchecked = 0;
  const ms = [];
  for (const [text, needles] of list) {
    const r = await run(text);
    if (r.called) ms.push(r.ms);
    if (!r.checked) unchecked++;
    const byRegex = needles.every((n) => gone(r.scrubbed, n));
    const ok = needles.every((n) => gone(r.out, n));
    regex += byRegex;
    caught += ok;
    console.log(`${ok ? "CAUGHT" : "LEAK  "}${byRegex ? " (regex)" : ""}${r.checked ? "" : " (unchecked)"}  ${JSON.stringify(text)} -> ${JSON.stringify(r.out)}  ${r.ms} ms`);
  }
  console.log(`${name}: ${caught}/${list.length} caught after both layers (regex alone ${regex}/${list.length}); ${unchecked} unchecked\n`);
  return { caught, regex, n: list.length, unchecked, ms };
}

console.log(`budget ${budgetMs} ms, chain: ${process.env.GMI_API_KEY ? "GMI DeepSeek V4.1 Flash -> Gemini -> " : ""}gateway Haiku\n`);
const qa = await evasions("QA evasions (in the prompt's examples)", QA_EVASIONS);
const held = await evasions("Held-out evasions (never in the prompt)", HELDOUT_EVASIONS);

let triggered = 0, changed = 0, unchecked = 0;
const ms = [];
for (const bio of INNOCENT) {
  const r = await run(bio);
  if (r.called) {
    triggered++;
    ms.push(r.ms);
  }
  if (!r.checked) unchecked++;
  if (r.out !== r.scrubbed) {
    changed++;
    console.log(`FALSE POSITIVE  ${JSON.stringify(r.scrubbed)} -> ${JSON.stringify(r.out)}`);
  }
}
const all = [...qa.ms, ...held.ms, ...ms].sort((a, b) => a - b);
const pct = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
console.log(`Innocent bios: ${triggered}/100 sent to the model (pre-filter), ${changed}/100 changed by the model (false positives), ${unchecked} unchecked`);
console.log(`Latency of model calls (n=${all.length}): p50 ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${all.at(-1)} ms`);
console.log(`Pre-filter check: ${INNOCENT.filter((b) => needsModel(stripContacts(b))).length}/100 innocent bios trigger it`);
