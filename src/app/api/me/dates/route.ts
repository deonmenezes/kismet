import { clientIp, currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { startDates } from "@/lib/actions";

// Dates run after the response (after/waitUntil); clients poll GET /api/me for results.
export const maxDuration = 60;

export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`dates:${me.id}`, 10, 3600))) return tooMany();
  const ip = clientIp(req);
  if (!(await rateLimit(`dates-ip:${ip}`, 150, 3600))) return tooMany();
  let targetId: string | undefined;
  try {
    const body = (await req.json()) as { targetId?: unknown };
    if (typeof body?.targetId === "string" && /^[0-9a-f-]{36}$/i.test(body.targetId)) targetId = body.targetId;
  } catch {
    // empty body is fine
  }
  const { started, dateIds, text } = await startDates(me, ip, requestClient(req), targetId);
  return json({ started, dateIds, text, message: text }, started ? 202 : 200);
}
