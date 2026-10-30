import { cookies } from "next/headers";
import { after } from "next/server";
import { clientIp, COOKIE, currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { parseEdit } from "@/lib/validate";
import { autoStartDates, deleteUser, setEdgeCity, updateProfile } from "@/lib/actions";
import { meCompact, meView } from "@/lib/views";
import { parseSince } from "@/lib/secret";
import { markShown } from "@/lib/records";
import { DEMO_RESERVED_TEXT, reservedForDemo } from "@/lib/demo";

export const maxDuration = 60;

export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  // Default: the compact view agents act on. ?full=1: everything (the web app). ?since=<ISO time>: only new items.
  const q = new URL(req.url).searchParams;
  const since = parseSince(q.get("since"));
  if (since === false) return json({ error: "since must be an ISO time, e.g. 2026-10-18T12:00:00Z" }, 400);
  const c = requestClient(req);
  await autoStartDates(me, clientIp(req), c); // an app open or an agent's poll
  const view = await meView(me, { since });
  after(() => markShown(me.id, view.recommendations.map((r) => r.dateId), c));
  return json(q.get("full") === "1" ? view : meCompact(view));
}

export async function PATCH(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`edit:${me.id}`, 20, 3600))) return tooMany();
  const raw = await req.text();
  if (raw.length > 12_000) return json({ error: "Too much text." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  // Telegram left out = unchanged; empty only when matches reach them another way (WhatsApp) or they have none today.
  const parsed = parseEdit(body, me);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  // App Review's demo name and handle (lib/demo.ts): only a demo account keeps them.
  if (reservedForDemo(parsed.profile, me.isDemo)) return json({ error: DEMO_RESERVED_TEXT }, 403);
  const c = requestClient(req, body);
  // The Edge City answer goes the way POST /api/me/edge-city takes it (lib/edge-city.ts): logged, and a yes starts dates.
  const { edgeCity, ...profile } = parsed.profile;
  await updateProfile(me.id, profile, c); // the weeks as given (an empty list clears them), as before
  if (edgeCity !== undefined) {
    const u = await setEdgeCity(me.id, edgeCity, undefined, c);
    if (u && edgeCity) await autoStartDates(u, clientIp(req), c);
  }
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  await deleteUser(me.id, requestClient(req));
  (await cookies()).delete(COOKIE);
  return json({ ok: true, deleted: true });
}
