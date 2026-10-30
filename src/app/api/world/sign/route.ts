import { clientIp, json, rateLimit, tooMany } from "@/lib/auth";
import { parseCode, rpSignature, worldConfig } from "@/lib/world";
import { worldStore } from "@/lib/world-store";

// RP signature for one World ID proof request, for the /verify/<code> page. The one-time code is the
// user's short-lived credential here. The signing key never leaves the server; the signature expires in 5 minutes.
export async function POST(req: Request) {
  const c = worldConfig();
  if (!c) return json({ ok: false, error: "verification_unavailable", message: "World ID verification is not available right now." }, 503);
  if (!(await rateLimit(`world-sign-ip:${clientIp(req)}`, 120, 3600))) return tooMany();
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json", message: "Send {\"code\": \"...\"}." }, 400);
  }
  const parsed = parseCode(c, body?.code);
  if ("error" in parsed) return json({ ok: false, error: parsed.error === "expired" ? "link_expired" : "invalid_link", message: "This verify link is not valid any more. Ask for a new one." }, 410);
  if (!(await rateLimit(`world-sign:${parsed.userId}`, 30, 3600))) return tooMany();
  const user = await worldStore.userState(parsed.userId);
  if (!user.exists) return json({ ok: false, error: "invalid_link", message: "This verify link is not valid any more. Ask for a new one." }, 410);
  if (user.verified) return json({ ok: false, error: "already_verified", message: "You're already World ID verified ✓" }, 409);
  return json({ ok: true, ...rpSignature(c) });
}
