import { cookies } from "next/headers";
import { clientIp, rateLimit } from "@/lib/auth";
import { ADMIN_COOKIE, adminKeyOk, adminSession } from "@/lib/safety";

// Admin sign-in: the ADMIN_KEY from a form post sets a short-lived httpOnly session cookie.
export async function POST(req: Request) {
  const back = (q = "") => Response.redirect(new URL(`/admin${q}`, req.url), 303);
  // Per network: a global counter would let anyone lock the admin out with wrong guesses.
  if (!(await rateLimit(`admin-login:${clientIp(req)}`, 10, 3600))) return back("?e=rate");
  // A body that is no form (JSON, plain text, a bare multipart header) is a wrong key, not a 500 (QA5 Q5-L2).
  const key = (await req.formData().catch(() => null))?.get("key");
  if (typeof key !== "string" || !adminKeyOk(key, process.env.ADMIN_KEY)) return back("?e=key");
  (await cookies()).set(ADMIN_COOKIE, adminSession(key), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 12 * 3600,
  });
  return back();
}
