// The Content-Security-Policy of every page (QA2/QA3: the old header had no default-src or script-src). The proxy
// (src/proxy.ts) makes a fresh nonce per request and sends this policy both ways: on the request, so Next.js puts the
// nonce on its own scripts while rendering, and on the response, so the browser enforces it. That needs every page
// rendered per request (the root layout awaits connection()): a page prerendered at build time has no nonce on its
// scripts and would not run. No imports (unit-tested directly).
//
// What the pages load, and so all that is allowed:
// - scripts: only ours, by nonce; 'strict-dynamic' lets them load Next.js's own chunks. No host allowlist, no eval.
// - styles: our CSS files, plus inline styles: React style={...} attributes and the World ID widget's <style>.
//   (A nonce can't cover style attributes, and with a nonce 'unsafe-inline' would be ignored; styles can't run code.)
// - images: ours, the canonical site's (photo URLs are absolute, ${SITE}/api/photos/<id>, also on Preview deployments
//   and other hosts), data: (World ID's QR code) and blob: (a photo before upload).
// - fonts: ours (next/font self-hosts Geist and Fraunces); on /verify, World ID's widget font (world-id-assets.com).
// - connections: our own API (sign-in goes through /api/auth, never to Neon Auth from the browser); on /verify, the
//   World ID bridge (bridge.worldcoin.org) the widget polls.
// - nothing framed, no plugins, no <base>, forms only to us, never framed by anyone.
// Google sign-in, WhatsApp and Telegram links are navigations, which this policy doesn't limit.

/** A fresh nonce: 128 random bits, base64. */
export const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

export type CspOptions = {
  pathname: string;
  /** The page was asked for over https (then every http:// subresource is upgraded). */
  https: boolean;
  /** next dev: React needs eval for its error overlays and stack traces. */
  dev?: boolean;
  /** The canonical site's origin, where photo URLs point (lib/photos.ts photoUrl); 'self' when it is this host. */
  photoOrigin?: string;
};

const WORLD_ID = /^\/verify\//;

export function contentSecurityPolicy(nonce: string, { pathname, https, dev = false, photoOrigin }: CspOptions) {
  const world = WORLD_ID.test(pathname);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", ...(photoOrigin ? [photoOrigin] : []), "data:", "blob:"],
    ["font-src", "'self'", ...(world ? ["https://world-id-assets.com"] : [])],
    ["connect-src", "'self'", ...(world ? ["https://bridge.worldcoin.org"] : []), ...(dev ? ["ws:"] : [])],
    ["media-src", "'self'"],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return [...directives.map((d) => d.join(" ")), ...(https ? ["upgrade-insecure-requests"] : [])].join("; ");
}

/**
 * Responses that are not pages (the API, the MCP server, llms.txt, icons, robots, the manifest) never run anything: a
 * document opened from one of them may load and run nothing. next.config.ts sends it on NON_PAGE_SOURCES only.
 */
export const NON_PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Where NON_PAGE_CSP goes (next.config.ts headers). The proxy (src/proxy.ts matcher) skips exactly these but "/api",
 * where it sets no policy, so no path gets two (csp.test.mjs checks the two lists agree).
 */
export const NON_PAGE_SOURCES = ["/api/:path*", "/mcp", "/llms.txt", "/llms-full.txt", "/favicon.ico", "/icon.svg", "/icon1.png", "/apple-icon.png",
  "/icon-192.png", "/icon-512.png", "/opengraph-image.png", "/twitter-image.png",
  "/app/opengraph-image.png", "/app/twitter-image.png", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"];

const NON_PAGE_EXACT = new Set(NON_PAGE_SOURCES.filter((p) => !p.includes(":")));
/**
 * A path next.config.ts gives NON_PAGE_CSP to. Next matches headers() without regard to case ("/API/me", "/MCP"), so
 * this does too: the proxy sets no policy of its own there (one policy per response).
 */
export const nonPagePath = (path: string) => {
  const p = path.toLowerCase().replace(/\/+$/, "") || "/";
  return p === "/api" || p.startsWith("/api/") || NON_PAGE_EXACT.has(p);
};
