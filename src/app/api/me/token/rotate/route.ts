import { NextResponse } from "next/server";
import { COOKIE, cookieOptions, currentUser, endAllSessions, hashToken, newToken, rateLimit, requestClient, startSession, tooMany, unauthorized } from "@/lib/auth";
import { sql } from "@/lib/db";
import { SITE } from "@/lib/copy";
import { logActivity } from "@/lib/records";

// Resets the private link (and the API token, the same secret): the old one stops working everywhere at once, and
// every browser session ends (this one gets a fresh session).
// Use it if a link was shared or leaked. This browser gets the new one as its cookie; apps and agents need the new
// token (it is shown once here).
export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  // Each credential has its own budget: someone holding a leaked link can't use up the owner's resets.
  const signedInAs = (await (await import("@/lib/identity")).sessionIdentity())?.authUserId ?? "link";
  if (!(await rateLimit(`rotate:${signedInAs}:${me.id}`, 5, 86400))) return tooMany("You reset your link a lot today. Try again tomorrow.");
  const token = newToken();
  await sql`update users set token_hash = ${hashToken(token)}, token_used_at = now() where id = ${me.id}`;
  await endAllSessions(me.id); // every browser signed in with the old link is signed out
  // ...and Google / email sign-ins joined after the one making this request (seniority: someone who used a leaked
  // link to Connect can't remove the owner's older sign-in). The rest are listed so the owner can check them.
  const idm = await import("@/lib/identity");
  const current = (await idm.sessionIdentity())?.authUserId ?? null;
  const removed = await idm.removeNewerSignIns(me.id, current);
  const signIns = await idm.joinedSignIns(me.id, current);
  await logActivity(me.id, requestClient(req), "signin", { via: "token_rotate" });
  const others = signIns.filter((s) => !s.you);
  const res = NextResponse.json({
    ok: true,
    privateLink: `${SITE}/u/${token}`,
    token,
    removedSignIns: removed.length,
    signIns,
    text: `Done: your old private link no longer works and every other browser is signed out.${removed.length ? ` ${removed.length} newer sign-in${removed.length === 1 ? " was" : "s were"} removed.` : ""}${others.length ? ` Still joined: ${others.map((s) => s.email).join(", ")}; remove any you don't know (GET/DELETE /api/me/sign-ins).` : ""} This is your new link, shown once; keep it private.`,
  }, { headers: { "cache-control": "no-store" } });
  const session = req.headers.get("authorization") ? null : await startSession(me.id);
  if (session) res.cookies.set(COOKIE, session, cookieOptions);
  return res;
}
