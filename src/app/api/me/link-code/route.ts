import { currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { createCode } from "@/lib/text/store";
import { logActivity } from "@/lib/records";
import { textLinks } from "@/lib/text/links";

// Kismet by text: a code (8 characters, 15 minutes, single use) the person texts to Kismet on WhatsApp as
// "LINK XXXX-XXXX". The phone then waits for this account's approval (GET / POST {"approve"} /api/me/link).
export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`link-code:${me.id}`, 10, 3600))) return tooMany();
  const { code, expiresAt } = await createCode({ userId: me.id });
  await logActivity(me.id, requestClient(req), "link_code");
  const links = textLinks(`LINK ${code}`);
  return json({
    code, expiresAt, ...links,
    text: links.whatsappUrl
      ? `Text "LINK ${code}" to Kismet on WhatsApp${links.whatsappNumber ? ` (${links.whatsappNumber})` : ""} within 15 minutes, then approve it here: ${links.whatsappUrl}`
      : `Text "LINK ${code}" to Kismet within 15 minutes, then approve it here.`,
  });
}
