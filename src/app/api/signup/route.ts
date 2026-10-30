import { cookies } from "next/headers";
import { clientIp, COOKIE, cookieOptions, json, rateLimit, requestClient, startSession, tooMany } from "@/lib/auth";
import { parseProfile } from "@/lib/validate";
import { consentError } from "@/lib/safety";
import { autoStartDates, insertUser } from "@/lib/actions";
import { sql, toUser } from "@/lib/db";
import { signupText } from "@/lib/chat";
import { worldConfig } from "@/lib/world";
import { verifyLink } from "@/lib/world-store";
import { parseNotes } from "@/lib/client";
import { DEMO_RESERVED_TEXT, demoKeyOk, isDemoProfile, reservedForDemo } from "@/lib/demo";
import { SITE } from "@/lib/copy";
import { EDGE_QUESTION_PLAIN, edgeOnlyText, signupEdgeCity } from "@/lib/edge-city";

export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 12_000) return json({ error: "Too much text." }, 413);
  // Per IP (agents in Agent Village may share one egress IP, so this is above a single person's needs) plus a global cap.
  const ip = clientIp(req);
  if (!(await rateLimit(`signup:${ip}`, 20, 3600))) return tooMany("Too many sign-ups from this network. Try again in an hour.");
  if (!(await rateLimit(`signup-day:${ip}`, 40, 86400))) return tooMany("Too many sign-ups from this network today. Try again tomorrow.");
  // Watched, never enforced site-wide (per network above is the limit): a global refusal locks everyone out.
  if (!(await rateLimit("signup:all", 1000, 3600))) console.warn("sign-ups: over the hourly watch level");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const consent = consentError(body);
  if (consent) return json({ error: consent }, 400);
  const parsed = parseProfile(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const p = parsed.profile;
  // App Review's demo accounts (lib/demo.ts): a demo name or handle is reserved; only the demo key makes a demo account
  // (with both), and without it either one is refused.
  const keyOk = demoKeyOk(req.headers.get("x-kismet-demo-key"));
  const demo = keyOk && isDemoProfile(p);
  if (!demo && reservedForDemo(p)) {
    return json({ error: DEMO_RESERVED_TEXT }, 403);
  }
  // Kismet is for Edge City India residents only (lib/edge-city.ts): a "no" gets the waitlist, and no account.
  if (p.edgeCity === false) {
    const text = edgeOnlyText(SITE);
    return json({ ok: false, error: "edge_city_only", text, message: text, waitlist: `${SITE}/waitlist` }, 403);
  }
  // Optional: facts the resident's agent already knows about them (agent_notes, private to them).
  const rawNotes = (body as Record<string, unknown>).notes;
  const notes = rawNotes === undefined || rawNotes === null ? [] : parseNotes({ notes: rawNotes });
  if (!Array.isArray(notes)) return json({ error: `notes: ${notes.error}` }, 400);
  // Signup source: X-Kismet-Client header, or "client"/"channel"+"appVersion" in the body; else api (Bearer-less agent) or web.
  const client = requestClient(req, body);
  const c = client.channel === "web" && !req.headers.get("cookie") && !req.headers.get("origin") ? { ...client, channel: "api" as const } : client;
  // Left out by a store app (App Store build 2, App Review) or a real demo sign-up: a member (lib/edge-city.ts).
  const edgeCity = signupEdgeCity(p.edgeCity, c.channel, demo);
  const { id, token } = (await insertUser({ ...p, edgeCity: edgeCity ?? undefined }, c, null, notes, null, { demo, edgeAssumed: p.edgeCity === undefined }))!;
  // The first dates start on their own (the app or agent may still start more right away, within the caps).
  const [fresh] = await sql`select * from users where id = ${id}`;
  if (fresh) await autoStartDates(toUser(fresh), ip, c);
  // A browser gets a session (never the private link itself); agents and apps calling the API need none.
  if (c.channel === "web") {
    const session = await startSession(id);
    if (session) (await cookies()).set(COOKIE, session, cookieOptions);
  }
  const privateLink = `${new URL(req.url).origin}/u/${token}`;
  // Optional World ID badge: only when the feature is configured.
  const world = worldConfig();
  const verify = world ? await verifyLink(world, { id, worldVerifiedAt: null }) : null;
  // Left out by an agent or the website: the account is made but stays out of the pool until they answer, once
  // (POST /api/me/edge-city, or the question on their next visit to the website or WhatsApp).
  const edge = edgeCity === true ? {} : { edgeCity: { member: false, answered: false, question: EDGE_QUESTION_PLAIN } };
  return json({ ok: true, token, privateLink, message: signupText(p.name, privateLink), ...edge, ...(verify ? { verifyLink: verify.url } : {}) }, 201);
}
