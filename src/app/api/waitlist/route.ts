import { clientIp, json, requestClient } from "@/lib/auth";
import { sql } from "@/lib/db";
import { logActivity } from "@/lib/records";
import { joinWaitlist } from "@/lib/waitlist";
import { neonWaitlist } from "@/lib/waitlist-store";

// Join the waitlist. The same email again returns its existing place (never an error, never a new removal link).
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 4000) return json({ error: "Too much text." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const r = await joinWaitlist(neonWaitlist, body, clientIp(req));
  if (!r.ok) return json({ error: r.error }, r.status);
  // A honeypot hit gets a plausible answer and nothing is stored.
  if ("bot" in r) return json({ ok: true, existing: false, position: 1, refCode: null, removalToken: null }, 201);
  if (!r.existing) {
    // Where the entry came from (the waitlist has no user, so the activity row carries the entry id).
    const c = requestClient(req, body);
    const [w] = await sql`update waitlist set channel = ${c.channel}, client = ${c.client} where ref_code = ${r.refCode} returning id`;
    if (w) await logActivity(null, { ...c, channel: c.channel === "web" ? "waitlist" : c.channel }, "waitlist_join", { waitlistId: Number(w.id) });
  }
  return json(r, r.existing ? 200 : 201);
}
