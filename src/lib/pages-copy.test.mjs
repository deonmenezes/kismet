// Run: npm test. The Support, Privacy, Terms and waitlist pages and the sign-up quiz (lib/pages-copy.ts), in the
// website's wording and the neutral one the store apps open under /app/* (the App Store version names no event).
// test-support/site-pages.fixture.json is the website's pages as production rendered them before the two variants
// shared one source (b40eea3): the website's wording must stay exactly that until someone means to change it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { NEUTRAL_BANNED, NEUTRAL_FOR_WHOM, pagePath, parseRich, privacy, quizCopy, support, terms, UPDATED, waitlistCopy } from "./pages-copy.ts";
import { AGENT_PROMPT } from "./options.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./test-support/site-pages.fixture.json", import.meta.url), "utf8"));
const DOCS = { support, privacy, terms };

/** A page's blocks as the browser shows them (components/legal.tsx, components/rich.tsx), markup kept. */
const rendered = (doc) => [
  ["h1", doc.title],
  ["p", `Last updated ${doc.updated}`],
  ...doc.blocks.flatMap((b) => "p" in b ? [["p", b.p]] : "h2" in b ? [["h2", b.h2]] : "ul" in b ? b.ul.map((li) => ["li", li]) : b.faq.flatMap(([q, a]) => [["p", q], ["p", a]])),
];
const everything = (neutral) => JSON.stringify([
  ...Object.values(DOCS).map((d) => d(neutral)), waitlistCopy(neutral), quizCopy(neutral), neutral ? NEUTRAL_FOR_WHOM : "",
]);
const links = (s) => [...s.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);

test("the website's pages are unchanged: Support, Privacy, Terms and the waitlist read exactly as before", () => {
  for (const [name, doc] of Object.entries(DOCS)) assert.deepEqual(rendered(doc(false)), FIXTURE[name], name);
  const w = waitlistCopy(false);
  assert.deepEqual([["p", w.kicker], ["h1", w.title], ["p", w.body]], FIXTURE.waitlist);
  // Still the website: it names Edge City India where it did.
  assert.match(support(false).blocks[2].faq[0][1], /^People at Edge City India in Mandrem, Goa \(October 11 to November 1, 2026\)/);
});

test("the website's quiz asks about Edge City India as before", () => {
  const q = quizCopy(false);
  assert.equal(q.question, "Are you at Edge City India?");
  assert.equal(q.hint, "Kismet makes intros between the people at Edge City India in Mandrem, Goa (Oct 11 - Nov 1 2026), and is only for them right now.");
  assert.equal(q.agentPrompt, AGENT_PROMPT);
  assert.equal(q.weeks, true);
  assert.equal(q.notHereTitle, "Kismet is Edge City only, for now");
  assert.equal(q.notHereBack, "Actually, I am at Edge City");
});

test("the /app pages name no event, place or partner (Edge City, Mandrem, Goa, Agent Village, EdgeOS)", () => {
  const all = everything(true);
  for (const word of [/edge city/i, /mandrem/i, /agent village/i, /\bgoa\b/i, /edgeos/i]) assert.doesNotMatch(all, word);
  assert.doesNotMatch(all, NEUTRAL_BANNED);
  assert.match(everything(false), NEUTRAL_BANNED, "the check finds them on the website's pages");
  assert.match(quizCopy(true).agentPrompt, /what I want from the village, my vibe/);
});

test("the /app pages say the same things: same sections, contact, Terms date and page length, give or take the naming", () => {
  for (const [name, doc] of Object.entries(DOCS)) {
    const site = rendered(doc(false));
    const app = rendered(doc(true));
    assert.deepEqual(app.map(([tag]) => tag), site.map(([tag]) => tag), `${name}: the same blocks`);
    assert.deepEqual(app.filter(([tag]) => tag !== "p" && tag !== "li"), site.filter(([tag]) => tag !== "p" && tag !== "li"), `${name}: the same headings`);
    assert.equal(doc(true).updated, doc(false).updated, `${name}: same date`);
    // Only the naming differs: each block is the website's, word for word, or close to it in length.
    site.forEach(([, s], n) => {
      const a = app[n][1];
      if (a !== s) assert.ok(Math.abs(a.length - s.length) < 0.35 * s.length, `${name} block ${n}: ${a}`);
    });
  }
  const all = everything(true);
  assert.ok(all.includes("[deon.menezes@virelity.com](mailto:deon.menezes@virelity.com)"));
  assert.match(all, /Virelity Inc\./);
  assert.match(JSON.stringify(privacy(true)), /12 months/);
});

test("the /app route files and share-image texts name none of them either (code, not comments)", () => {
  const dir = new URL("../app/app/", import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => /\.(tsx?|txt)$/.test(f));
  assert.ok(files.length >= 10, files.join());
  for (const f of files) {
    const code = readFileSync(new URL(f.replaceAll("\\", "/"), dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    assert.doesNotMatch(code, NEUTRAL_BANNED, f);
    if (f.endsWith("page.tsx") && !f.includes("missing")) assert.match(code, /neutral|WaitlistRemove/, `${f}: renders the neutral variant`);
  }
});

test("the markup parses: every link and code span, no stray [, ]( or backtick left in the text", () => {
  assert.deepEqual(parseRich("See the [Privacy Policy](/privacy) (and `GET /api/me/notes`)."),
    ["See the ", { label: "Privacy Policy", href: "/privacy" }, " (and ", { code: "GET /api/me/notes" }, ")."]);
  for (const neutral of [true, false]) {
    for (const s of JSON.parse(everything(neutral)).flatMap(function strings(x) { return typeof x === "string" ? [x] : Object.values(x ?? {}).flatMap(strings); })) {
      for (const run of parseRich(s).filter((x) => typeof x === "string")) assert.doesNotMatch(run, /\]\(|`|\[[^\]]*\]\(/, s);
    }
  }
});

test("the pages' \"Last updated\" is the Terms version a sign-up agrees to (records.ts TERMS_VERSION)", () => {
  const version = readFileSync(new URL("./records.ts", import.meta.url), "utf8").match(/TERMS_VERSION = "(\d{4}-\d\d-\d\d)"/)[1];
  assert.equal(new Date(`${UPDATED} UTC`).toISOString().slice(0, 10), version);
});

test("the /app pages link only to each other (and email): never back to the website's pages", () => {
  for (const neutral of [true, false]) {
    for (const href of links(everything(neutral))) {
      if (href.startsWith("mailto:")) continue;
      assert.ok(neutral ? /^\/app\/(privacy|terms|waitlist|support)$/.test(href) : !href.startsWith("/app/"), `${neutral ? "app" : "site"}: ${href}`);
    }
  }
  assert.deepEqual(links(JSON.stringify(support(true))).filter((h) => !h.startsWith("mailto:")).sort(), ["/app/privacy", "/app/privacy", "/app/waitlist"]);
  assert.equal(pagePath(true, "/terms"), "/app/terms");
  assert.equal(pagePath(false, "/terms"), "/terms");
});

test("QA6 Q6-L3: the /app 404s have their own title (the tab read \"Kismet · Kismet\" after hydration)", () => {
  for (const f of ["[[...missing]]/page.tsx", "not-found.tsx"]) {
    const code = readFileSync(new URL(`../app/app/${f}`, import.meta.url), "utf8");
    assert.match(code, /export const metadata: Metadata = \{ title: "Page not found" \};/, f);
  }
});

test("QA8 L2: /waitlist/remove has its own title, as its /app twin (it read the site's default title)", () => {
  for (const f of ["(site)/waitlist/remove/page.tsx", "app/waitlist/remove/page.tsx"]) {
    const code = readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");
    assert.match(code, /export const metadata: Metadata = \{ title: "Leave the waitlist" \};/, f);
  }
});

test("QA6 Q6-L4: the agent docs (llms.txt, llms-full.txt, /agents) say what Support says a match reveals", async () => {
  const { agentScript, agentScriptCore } = await import("./agent-script.ts");
  const answer = JSON.stringify(support(false));
  assert.match(answer, /message each other in the Kismet app or website, or on their Telegram or WhatsApp if they shared one/);
  for (const script of [agentScriptCore, agentScript]) {
    const s = script("https://k.test").replace(/\s+/g, " ");
    assert.doesNotMatch(s, /get the other's Telegram|includes the other person's Telegram link|Telegram handle is revealed only/, script.name);
  }
  const full = agentScript("https://k.test").replace(/\s+/g, " ");
  assert.match(full, /it's a match: they can message each other in the Kismet app or website, or on the other's Telegram or WhatsApp if they shared one\./);
  assert.match(full, /their Telegram \(t\.me\/\.\.\.\) or WhatsApp \(wa\.me\/\.\.\.\) if they shared one, else a message in the Kismet app or website/);
  // The decide reply agents relay word for word: a yes waiting for the other side promises no Telegram either.
  const { decideText } = await import("./chat.ts");
  assert.equal(decideText("Priya", "meet", null), "Noted, privately. If Priya says yes too, I'll tell you and how to reach them. Otherwise you won't hear about it again.");
});
