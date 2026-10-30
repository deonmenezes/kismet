import { json, rateLimit, tooMany } from "@/lib/auth";
import { changeSignal, sameOrigin, viewerFor } from "@/lib/text/web-chat";

// Sidebar: POST {"id", "action": "pause" | "resume" | "drop"} on one of your own signals.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const v = await viewerFor(req);
  if (!v?.me) return json({ error: "Sign in to chat with Kismet.", signIn: "/sign-in" }, 401);
  if (!(await rateLimit(`chat-msg:${v.me.id}`, 20, 60))) return tooMany();
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  const action = ["pause", "resume", "drop"].includes(body?.action) ? (body.action as "pause" | "resume" | "drop") : null;
  if (!id || !action) return json({ error: "Send id and action." }, 400);
  const view = await changeSignal(v, id, action);
  return view ? json(view) : json({ error: "That signal can't be changed (5 can be active at once)." }, 409);
}
