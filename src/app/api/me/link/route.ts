import { clientIp, currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { approveWebLink, neonText, requestLinkFromThreadCode, webLinkRequests } from "@/lib/text/store";
import { logActivity } from "@/lib/records";
import { finishWebLink, whatsapp } from "@/lib/text/runtime";

// Kismet by text: linking a WhatsApp number to this account. Either side's code needs the OTHER side's
// approval, so a guessed code alone links nothing:
// - GET: link requests waiting for this account's approval (a phone texted this account's code).
// - POST {"approve": "<requestId>"}: approve one of them.
// - POST {"code": "XXXX-XXXX"}: a code the phone got by texting LINK; Kismet then asks that phone to reply YES.

export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return json({ requests: await webLinkRequests(me.id) });
}

export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`link:${me.id}`, 10, 3600)) || !(await rateLimit(`link-ip:${clientIp(req)}`, 30, 3600))) return tooMany();
  const body = (await req.json().catch(() => null)) as { code?: unknown; approve?: unknown } | null;

  if (typeof body?.approve === "string") {
    const t = /^[0-9a-f-]{36}$/i.test(body.approve) ? await approveWebLink(me.id, body.approve) : null;
    if (!t) return json({ error: "That link request is gone or expired." }, 404);
    const r = await finishWebLink(t, me.id);
    return r.ok ? json({ ok: true, linked: true, channel: t.channel, text: "Linked. Kismet will text you there too." }) : json({ error: r.error }, 409);
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/.test(code)) return json({ error: 'Send {"code": "<the code Kismet texted you, like K7Q2-9XMB>"}.' }, 400);
  // Guessing codes: limited per person and per network (codes are 40 bits and live 15 minutes).
  if (!(await rateLimit(`link-try:${me.id}`, 10, 3600)) || !(await rateLimit(`link-try-ip:${clientIp(req)}`, 30, 3600))) {
    return tooMany("Too many link attempts. Try again in an hour.");
  }
  const found = await requestLinkFromThreadCode(me.id, code);
  if (!found) return json({ error: "That code is wrong or expired. Text LINK to Kismet for a new one." }, 404);
  const t = found.thread;
  if (t.optedOutAt) return json({ error: "That number opted out of Kismet texts. Text START to Kismet first." }, 409);
  if (t.userId && t.userId !== me.id) return json({ error: "That number already has its own Kismet account." }, 409);
  await logActivity(me.id, requestClient(req), "link_code", { requested: t.channel });
  if (whatsapp.configured()) {
    const r = await whatsapp.sendText(t.phone, `Link this number to ${me.name}'s Kismet account? Reply YES within 15 minutes to confirm. If that wasn't you, ignore this.`);
    await neonText.recordOutbound(t, "[link confirmation asked]", r.ok ? r.id : null);
  }
  return json({ ok: true, linked: false, pending: true, text: "Almost done: reply YES to Kismet on WhatsApp to confirm." }, 202);
}
