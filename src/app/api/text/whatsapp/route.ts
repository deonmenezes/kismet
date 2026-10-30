import { after } from "next/server";
import { handshake, statusesOf } from "@/lib/text/whatsapp";
import { handleMessages, whatsapp } from "@/lib/text/runtime";

// Kismet by text: the WhatsApp Cloud API webhook. Registered as the phone number's override_callback_uri,
// so the app-level webhook (Deon's inbox receiver) is untouched. GET: Meta's verify-token handshake.
// POST: signed with the Meta app secret (X-Hub-Signature-256); answered at once, handled after the response.
export const maxDuration = 60;

export function GET(req: Request) {
  const challenge = handshake(new URL(req.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge, { headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request) {
  if (!whatsapp.configured()) return new Response("Not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > 256_000) return new Response("Too large", { status: 413 });
  if (!whatsapp.verify(req.headers, raw)) return new Response("Bad signature", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  for (const st of statusesOf(body)) console.log("whatsapp status", st.id, st.status, st.error ?? "");
  const messages = whatsapp.parse(body);
  if (messages.length) after(() => handleMessages(whatsapp, messages));
  return new Response("ok");
}
