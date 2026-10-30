import { NextResponse } from "next/server";
import { clientIp, COOKIE, cookieOptions, rateLimit, startSession, underLimit, userByToken } from "@/lib/auth";
import { logActivity } from "@/lib/records";

// Private link: starts a browser session (its own token in the cookie, never the link itself) and goes home.
// Opened from another website, or by anything that isn't a browser navigation, it first asks for one tap on our own
// page, so no other site can quietly sign a visitor into an account of its choosing and link-preview bots can't use
// up sessions. Links tapped in apps, email or the address bar ("none") and our own pages go straight through.

const dest = (req: Request, ok: boolean) => {
  const chat = new URL(req.url).searchParams.get("next") === "chat";
  return new URL(ok ? (chat ? "/chat" : "/home") : chat ? "/sign-in?expired=1" : "/join?expired=1", req.url);
};

const noRef = (res: Response) => {
  res.headers.set("referrer-policy", "no-referrer");
  res.headers.set("cache-control", "no-store");
  return res;
};

async function signIn(req: Request, token: string) {
  // Only failed lookups count against a network, so junk links can't lock a shared venue Wi-Fi out of real ones.
  const net = `u-fail:${clientIp(req)}`;
  if (!(await underLimit(net, 60))) return noRef(NextResponse.redirect(new URL("/sign-in", req.url), 303));
  const user = await userByToken(token);
  if (!user) await rateLimit(net, 60, 3600);
  const session = user && (await rateLimit(`u:${user.id}`, 30, 3600)) ? await startSession(user.id, token) : null;
  const res = NextResponse.redirect(dest(req, Boolean(session)), 303);
  if (user && session) {
    res.cookies.set(COOKIE, session, cookieOptions);
    await logActivity(user.id, { channel: "web", client: "" }, "signin", { via: "private_link" });
  }
  return noRef(res);
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Straight in only for a real browser navigation from an app, email, the address bar or our own pages. Other
  // sites, and clients that send no fetch metadata (link-preview bots unfurling a shared link), get the tap page.
  const site = req.headers.get("sec-fetch-site");
  if (site === "none" || site === "same-origin") return signIn(req, token);
  const next = new URL(req.url).searchParams.get("next") === "chat" ? "?next=chat" : "";
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open Kismet</title><meta name="color-scheme" content="light dark"><style>@media (prefers-color-scheme:dark){body{background:#14101c!important;color:#f8eef6!important}p{color:#b0a4c0!important}}</style><body style="font-family:system-ui,sans-serif;background:#fbe5f5;color:#1e1530;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<form method="post" action="${next}" style="max-width:22rem;text-align:center"><h1 style="font-size:1.4rem">Open your Kismet account?</h1>
<p style="color:#665878">You followed a private link from another website. Open it only if it is your own.</p>
<button style="font:inherit;font-weight:700;min-height:48px;padding:0 1.5rem;border:0;border-radius:999px;background:#ed6b83;color:#1e1530">Open my account</button></form>`;
  return noRef(new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }));
}

// The confirmation tap (same-origin only: the proxy refuses cross-site posts that carry our cookies; this one
// carries none, so the Sec-Fetch-Site / Origin check is done here too).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const same = site ? site === "same-origin" : (() => { try { return new URL(origin ?? "").host === new URL(req.url).host; } catch { return false; } })();
  if (!same) return noRef(NextResponse.redirect(new URL("/sign-in", req.url), 303));
  return signIn(req, (await params).token);
}
