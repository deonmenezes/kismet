import { after, NextResponse } from "next/server";
import { clientIp, COOKIE, cookieOptions, json, legacyCookieUser, rateLimit, requestClient, startSession, tooMany } from "@/lib/auth";
import { touchSeen } from "@/lib/records";
import { stripControls } from "@/lib/controls";
import { sendChat, syncChat, viewerFor, type Viewer } from "@/lib/text/web-chat";

// The website's chat with your Kismet agent (lib/text/web-chat.ts). Browser only: a Google / email sign-in or the
// private-link cookie. GET: the conversation (and anything new: notices, the next recommendation).
// POST {"text", "buttonId"?}: one message; answers with the updated conversation.

export const maxDuration = 60;

const signedOut = () => json({ error: "Sign in to chat with Kismet.", signIn: "/sign-in" }, 401);
// Per person, with a loose ceiling per network: a whole venue can share one Wi-Fi exit.
const who = (v: Viewer) => v.me?.id ?? v.identity!.authUserId;

/** A cookie from before sessions existed holds the private link itself: swap it for a session on sight. */
async function upgradeCookie(req: Request, res: NextResponse) {
  const old = req.headers.get("cookie")?.match(/(?:^|;\s*)ad_token=([^;]+)/)?.[1];
  const link = old ? decodeURIComponent(old) : null;
  const u = link ? await legacyCookieUser(link) : null;
  const session = u && link ? await startSession(u.id, link) : null;
  if (session) res.cookies.set(COOKIE, session, cookieOptions);
  return res;
}

export async function GET(req: Request) {
  const v = await viewerFor(req);
  if (!v) return signedOut();
  if (!(await rateLimit(`chat-sync:${who(v)}`, 40, 60)) || !(await rateLimit(`chat-sync-ip:${clientIp(req)}`, 1500, 60))) return tooMany();
  // Time in use (lib/records.ts): the page polls this only while its tab is visible.
  const me = v.me;
  if (me) after(() => touchSeen(me.id, requestClient(req)));
  return upgradeCookie(req, NextResponse.json(await syncChat(v), { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request) {
  const v = await viewerFor(req);
  if (!v) return signedOut();
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? stripControls(body.text).trim() : "";
  const buttonId = typeof body?.buttonId === "string" && /^kismet:(yes|no):[0-9a-f-]{36}$/i.test(body.buttonId) ? body.buttonId : null;
  if (!text && !buttonId) return json({ error: "Type a message." }, 400);
  if (text.length > 2000) return json({ error: "That message is too long." }, 400);
  const ip = clientIp(req);
  if (!(await rateLimit(`chat-msg:${who(v)}`, 20, 60)) || !(await rateLimit(`chat-msg-ip:${ip}`, 400, 60))) return tooMany();
  const r = await sendChat(v, text || (buttonId!.split(":")[1] === "yes" ? "Yes" : "No"), buttonId, ip);
  if ("limited" in r) return tooMany(r.limited);
  if (r.deleted) {
    const res = NextResponse.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
    res.cookies.delete(COOKIE);
    return res;
  }
  return json(r);
}
