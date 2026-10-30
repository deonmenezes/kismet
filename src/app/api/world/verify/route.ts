import { clientIp, json, rateLimit, tooMany } from "@/lib/auth";
import { completeVerification, parseCode, worldConfig } from "@/lib/world";
import { worldStore } from "@/lib/world-store";
import { logActivity } from "@/lib/records";

// Verifies an IDKit result from the /verify/<code> page: environment check, forward as-is to the Developer
// Portal, Orb or Selfie Check only, one World ID per account (see completeVerification in lib/world.ts).
export const maxDuration = 30;

export async function POST(req: Request) {
  const c = worldConfig();
  if (!c) return json({ ok: false, error: "verification_unavailable", message: "World ID verification is not available right now." }, 503);
  if (!(await rateLimit(`world-verify-ip:${clientIp(req)}`, 60, 3600))) return tooMany();
  const raw = await req.text();
  if (raw.length > 20_000) return json({ ok: false, error: "too_large", message: "Request too large." }, 413);
  let body: { code?: unknown; result?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_json", message: "Body must be JSON." }, 400);
  }
  const parsed = parseCode(c, body?.code);
  if (!("error" in parsed) && !(await rateLimit(`world-verify:${parsed.userId}`, 10, 3600))) return tooMany();
  const out = await completeVerification(c, worldStore, body?.code, body?.result);
  if (out.status === 200 && !("error" in parsed)) await logActivity(parsed.userId, { channel: "web", client: "" }, "world_verify");
  return json(out.body, out.status);
}
