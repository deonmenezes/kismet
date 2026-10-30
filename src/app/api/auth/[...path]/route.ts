import { createHmac } from "node:crypto";
import { clientIp, rateLimit, tooMany } from "@/lib/auth";
import { canonicalEmail } from "@/lib/net";
import { neonAuth } from "@/lib/identity";

// Neon Auth proxy (Google sign-in, emailed codes, sessions): the browser talks to our origin, cookies stay ours.
// Only the calls Kismet uses pass through (everything else, e.g. password resets or magic links that would send
// mail, is a 404). Sign-in calls are limited per network and code emails per address, here, because the proxy
// can't pass the visitor's IP upstream (Neon's own limits see only our server).
const off = () => Response.json({ error: "Sign-in is not available." }, { status: 503 });
const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
const h = neonAuth?.handler();
type Ctx = { params: Promise<{ path: string[] }> };

const ALLOWED_GET = /^(get-session|token)$/;
const ALLOWED_POST = /^(sign-in\/social|sign-in\/email-otp|email-otp\/send-verification-otp|sign-out)$/;
const SENDS_MAIL = /^email-otp\/send-verification-otp$/;
const salted = (v: string) => createHmac("sha256", process.env.IP_SALT || process.env.DATABASE_URL || "agent-dates").update(`mail:${v}`).digest("hex").slice(0, 32);

/** The email in a JSON body (the only kind the sign-in client sends, and the only kind passed on). */
async function emailOf(req: Request) {
  const base = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (base !== "application/json") return null;
  return String(((await req.clone().json().catch(() => null)) as { email?: unknown } | null)?.email ?? "");
}

export async function GET(req: Request, ctx: Ctx) {
  if (!h) return off();
  return ALLOWED_GET.test((await ctx.params).path.join("/")) ? h.GET(req, ctx) : notFound();
}

export async function POST(req: Request, ctx: Ctx) {
  if (!h) return off();
  const path = (await ctx.params).path.join("/");
  if (!ALLOWED_POST.test(path)) return notFound();
  if (path === "sign-out") return h.POST(req, ctx);
  const busy = () => tooMany("Too many sign-in attempts. Wait a few minutes and try again.");
  if (!(await rateLimit(`auth-ip:${clientIp(req)}`, 60, 600))) return busy();
  // Site-wide volume is watched, never enforced: a global refusal would let a few networks lock everyone out.
  if (!(await rateLimit("auth:all", 1200, 600))) console.warn("sign-in burst: over 1200 calls in 10 minutes");
  if (SENDS_MAIL.test(path)) {
    const email = await emailOf(req);
    if (email === null) return Response.json({ error: "Send JSON." }, { status: 415 });
    const e = canonicalEmail(email); // "+tags" and Gmail dots are the same inbox
    if (email.trim() && !(await rateLimit(`auth-mail:${salted(e)}`, 5, 3600))) return busy();
  }
  return h.POST(req, ctx);
}
