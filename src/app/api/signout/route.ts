import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, cookieUser, endSession } from "@/lib/auth";

// Signs this browser out: the session ends on the server (not just the cookie), then the cookie goes. The page also
// ends the Google / email session. GET (the chat sends a dead cookie here): clears only a cookie that no longer opens
// an account, so a link on another site can't sign anyone out.
async function end() {
  await endSession((await cookies()).get(COOKIE)?.value);
}

export async function POST() {
  await end();
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.delete(COOKIE);
  return res;
}

export async function GET(req: Request) {
  if (await cookieUser((await cookies()).get(COOKIE)?.value)) return NextResponse.redirect(new URL("/chat", req.url));
  const res = NextResponse.redirect(new URL("/sign-in", req.url));
  res.cookies.delete(COOKIE);
  return res;
}
