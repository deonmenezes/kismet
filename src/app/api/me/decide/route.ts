import { decideDate } from "@/lib/actions";
import { currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";

export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`decide:${me.id}`, 120, 3600))) return tooMany();
  let body: { dateId?: unknown; decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const { dateId, decision } = body ?? {};
  if (typeof dateId !== "string" || !/^[0-9a-f-]{36}$/i.test(dateId) || (decision !== "meet" && decision !== "pass")) {
    return json({ error: 'Send {"dateId": "<uuid>", "decision": "meet" | "pass"}.' }, 400);
  }
  const result = await decideDate(me, dateId, decision, requestClient(req));
  if (!result) return json({ error: "Agent chat not found (or still running)." }, 404);
  return json(result);
}
