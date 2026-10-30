import { json, clientIp, rateLimit, tooMany } from "@/lib/auth";
import { removeFromWaitlist } from "@/lib/waitlist-store";

// One-time removal link (shown once on the success screen): deletes that entry.
export async function POST(req: Request) {
  if (!(await rateLimit(`waitlist-remove:${clientIp(req)}`, 30, 3600))) return tooMany();
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const ok = typeof body?.token === "string" && (await removeFromWaitlist(body.token));
  return ok ? json({ ok: true, removed: true }) : json({ error: "This removal link was already used or is not valid." }, 404);
}
