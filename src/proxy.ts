import { NextResponse, type NextRequest } from "next/server";
import { COOKIE } from "@/lib/auth";
import { neonAuth, SESSION_COOKIE } from "@/lib/identity";
import { contentSecurityPolicy, newNonce, nonPagePath } from "@/lib/csp";
import { SITE } from "@/lib/copy";

// "/api/*": cross-site checks below.
// "/": signed-in browsers (a private-link cookie or a Google / email session) go straight to the chat.
// "/auth/done": Google returns there with a one-time session verifier that the Neon Auth middleware swaps for session
// cookies.
// Every page: its Content-Security-Policy with a fresh nonce (lib/csp.ts).
const mw = neonAuth?.middleware({ loginUrl: "/sign-in" });

// Cookie-authenticated changes must come from our own pages: a POST/PUT/PATCH/DELETE to /api that carries a session
// cookie and no Bearer token needs a same-origin Origin (or Sec-Fetch-Site). Agents and apps use Bearer; the
// WhatsApp webhook and the partner API carry no cookie.
function crossSite(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return false;
  if (/^bearer /i.test(req.headers.get("authorization") ?? "")) return false; // exactly what the routes treat as an API call (auth.ts hasBearer)
  if (!req.cookies.has(COOKIE) && !req.cookies.has(SESSION_COOKIE) && !req.cookies.has("ad_admin")) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  try {
    return new URL(req.headers.get("origin") ?? "").host !== req.nextUrl.host;
  } catch {
    return true;
  }
}

/** The page renders with the policy on its request (Next.js reads the nonce from it) and is served with it. */
function page(req: NextRequest) {
  const https = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  const site = new URL(SITE).origin;
  const csp = contentSecurityPolicy(newNonce(), {
    pathname: req.nextUrl.pathname, https, dev: process.env.NODE_ENV === "development", photoOrigin: site === req.nextUrl.origin ? undefined : site,
  });
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export default function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (/^\/api(?:\/|$)/i.test(path)) {
    return crossSite(req) ? NextResponse.json({ error: "Cross-site request refused." }, { status: 403 }) : NextResponse.next();
  }
  // "/MCP", "/Robots.txt": next.config.ts's no-scripts policy already applies (it matches any case); no second one.
  if (nonPagePath(path)) return NextResponse.next();
  if (path === "/auth/done") return mw ? mw(req) : NextResponse.redirect(new URL("/sign-in", req.url));
  if (path === "/") {
    const signedIn = req.cookies.has(COOKIE) || req.cookies.has(SESSION_COOKIE);
    if (signedIn && !req.nextUrl.searchParams.has("deleted")) return NextResponse.redirect(new URL("/chat", req.url));
  }
  return page(req);
}

// Every path but Next.js's static files and the routes that are not pages (the MCP server, the scripts agents read, the
// icons, robots, sitemap and manifest: lib/csp.ts NON_PAGE_SOURCES), which get next.config.ts's no-scripts policy.
export const config = {
  matcher: ["/((?!_next/static|_next/image|mcp$|llms\\.txt$|llms-full\\.txt$|favicon\\.ico$|icon\\.svg$|icon1\\.png$|apple-icon\\.png$|icon-192\\.png$|icon-512\\.png$|opengraph-image\\.png$|twitter-image\\.png$|app/opengraph-image\\.png$|app/twitter-image\\.png$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$).*)"],
};
