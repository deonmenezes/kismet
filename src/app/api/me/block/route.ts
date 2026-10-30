import { currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { blockDate, unblockDate } from "@/lib/actions";
import { GONE, parseBlock } from "@/lib/safety";

// Block (POST) or unblock (DELETE) the other person on a recommendation or match. Silent: they are never told.
async function handle(req: Request, op: "block" | "unblock") {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`block:${me.id}`, 60, 3600))) return tooMany();
  const r = parseBlock(await req.json().catch(() => null));
  if ("error" in r) return json({ error: r.error }, 400);
  const c = requestClient(req);
  const out = op === "block" ? await blockDate(me, r.dateId, c) : await unblockDate(me, r.dateId, c);
  if (!out) return json(GONE[op], 410);
  return json(out, out.ok ? 200 : 409);
}

export const POST = (req: Request) => handle(req, "block");
export const DELETE = (req: Request) => handle(req, "unblock");
