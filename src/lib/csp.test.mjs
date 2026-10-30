// Run: npm test. The pages' Content-Security-Policy (lib/csp.ts) and where the proxy applies it (src/proxy.ts matcher).
// The policy was checked in Chromium and WebKit on a local build: no violation on any page (reports/2026-10-29-qa3-fixes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentSecurityPolicy, newNonce, NON_PAGE_CSP, NON_PAGE_SOURCES, nonPagePath } from "./csp.ts";

const parse = (csp) => Object.fromEntries(csp.split(/;\s*/).map((d) => { const [k, ...v] = d.split(" "); return [k, v]; }));

test("a page's scripts run only by this request's nonce (plus what they load), never inline or eval", () => {
  const p = parse(contentSecurityPolicy("abc123==", { pathname: "/chat", https: true }));
  assert.deepEqual(p["script-src"], ["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  assert.deepEqual(p["default-src"], ["'self'"]);
  for (const [k, v] of [["object-src", ["'none'"]], ["base-uri", ["'none'"]], ["frame-ancestors", ["'none'"]], ["frame-src", ["'none'"]], ["form-action", ["'self'"]]]) {
    assert.deepEqual(p[k], v, k);
  }
  assert.deepEqual(p["connect-src"], ["'self'"], "the browser talks only to our origin (sign-in goes through /api/auth)");
  assert.deepEqual(p["img-src"], ["'self'", "data:", "blob:"]);
  assert.deepEqual(p["font-src"], ["'self'"]);
  assert.ok("upgrade-insecure-requests" in p);
  const all = Object.values(p).flat().join(" ");
  assert.ok(!/unsafe-eval|https?:\/\/\*|\*\./.test(all), "no eval, no wildcards");
  assert.ok(!p["script-src"].includes("'unsafe-inline'"));
});

test("photos load from the canonical site when the page is on another host (Preview, an alias)", () => {
  const p = parse(contentSecurityPolicy("n", { pathname: "/home", https: true, photoOrigin: "https://kismet-village.vercel.app" }));
  assert.deepEqual(p["img-src"], ["'self'", "https://kismet-village.vercel.app", "data:", "blob:"]);
  assert.deepEqual(parse(contentSecurityPolicy("n", { pathname: "/home", https: true }))["img-src"], ["'self'", "data:", "blob:"]);
});

test("only /verify/<code> may reach World ID (its widget font and bridge)", () => {
  const p = parse(contentSecurityPolicy("n", { pathname: "/verify/abc", https: true }));
  assert.deepEqual(p["font-src"], ["'self'", "https://world-id-assets.com"]);
  assert.deepEqual(p["connect-src"], ["'self'", "https://bridge.worldcoin.org"]);
  for (const path of ["/", "/home", "/verify", "/verifyx/abc"]) {
    assert.ok(!contentSecurityPolicy("n", { pathname: path, https: true }).includes("worldcoin"), path);
  }
});

test("http (a local build) is not upgraded; next dev gets eval and its websocket, never production", () => {
  assert.ok(!contentSecurityPolicy("n", { pathname: "/", https: false }).includes("upgrade-insecure-requests"));
  const dev = parse(contentSecurityPolicy("n", { pathname: "/", https: false, dev: true }));
  assert.ok(dev["script-src"].includes("'unsafe-eval'"));
  assert.ok(dev["connect-src"].includes("ws:"));
});

test("a fresh, unguessable nonce per request (128 bits, base64)", () => {
  const seen = new Set(Array.from({ length: 500 }, newNonce));
  assert.equal(seen.size, 500);
  for (const n of seen) assert.match(n, /^[A-Za-z0-9+/]{22}==$/);
});

test("responses that are not pages may run nothing", () => {
  const p = parse(NON_PAGE_CSP);
  assert.deepEqual(p["default-src"], ["'none'"]);
  assert.ok(!("script-src" in p));
  assert.deepEqual(p["frame-ancestors"], ["'none'"]);
});

test("the proxy gives every page its policy, and leaves Next's files, MCP, llms.txt and the icons alone", () => {
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const matcher = JSON.parse(src.match(/matcher: (\[".*"\])/)[1]); // the TS string literal is also valid JSON
  assert.equal(matcher.length, 1);
  const re = new RegExp(`^${matcher[0]}$`);
  for (const path of ["/", "/privacy", "/chat", "/chat/abc", "/home", "/edit", "/join", "/board", "/sign-in", "/verify/x", "/this-does-not-exist",
    "/api/me", "/api/auth/get-session", "/u/token", "/auth/done", "/mcp-docs", "/llms.txt.bak", "/brand/logo.svg", "/brand/missing.svg",
    "/opengraph-image-x", "/app/support", "/app/join"]) assert.ok(re.test(path), `runs on ${path}`);
  for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/mcp", "/llms.txt", "/llms-full.txt", "/favicon.ico", "/icon.svg", "/icon1.png",
    "/apple-icon.png", "/icon-192.png", "/opengraph-image.png", "/twitter-image.png", "/app/opengraph-image.png", "/app/twitter-image.png", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"]) {
    assert.ok(!re.test(path), `skips ${path}`);
  }
  // next.config.ts's no-scripts policy goes exactly where the proxy sets none: the routes it skips, and /api (where it
  // only checks the origin). So no response carries two policies.
  for (const source of NON_PAGE_SOURCES) {
    const sample = source.replace("/:path*", "/me");
    assert.ok(source.startsWith("/api/") || !re.test(sample), `${source}: the proxy must skip it`);
  }
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  const allPaths = config.slice(config.indexOf("const SECURITY_HEADERS = ["), config.indexOf("];", config.indexOf("const SECURITY_HEADERS = [")));
  assert.ok(allPaths.includes("X-Frame-Options") && !allPaths.includes("Content-Security-Policy"), "no policy in the every-path headers");
  assert.match(config, /NON_PAGE_SOURCES\.map\(\(source\) => \(\{ source, headers: \[\{ key: "Content-Security-Policy", value: NON_PAGE_CSP \}\] \}\)\)/);
  // Every page renders per request, so Next.js can put the nonce on its scripts (a prerendered page would have none).
  assert.match(readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8"), /await connection\(\);/);
});

test("the matcher's dots are literal dots (llms_txt is a page like any other)", () => {
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const re = new RegExp(`^${JSON.parse(src.match(/matcher: (\[".*"\])/)[1])[0]}$`);
  for (const path of ["/llms_txt", "/robotsXtxt", "/iconXsvg"]) assert.ok(re.test(path), path);
});

test("paths that get the no-scripts policy in any case (as Next matches headers()) never get a page policy too", () => {
  for (const p of ["/api", "/api/", "/API/me", "/Api", "/MCP", "/Robots.txt", "/Favicon.ico", "/llms.txt", "/LLMS-FULL.TXT", "/mcp/"]) assert.ok(nonPagePath(p), p);
  for (const p of ["/", "/apix", "/mcp-docs", "/privacy", "/chat/abc", "/brand/logo.svg", "/llms.txt.bak"]) assert.ok(!nonPagePath(p), p);
  const src = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(src, /if \(nonPagePath\(path\)\) return NextResponse\.next\(\);/);
});
