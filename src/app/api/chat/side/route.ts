import { json, rateLimit, tooMany } from "@/lib/auth";
import { sideView, viewerFor } from "@/lib/text/web-chat";

// The chats sidebar on a match chat page (matches with unread dots, signals, the account row). Read only.
export async function GET(req: Request) {
  const v = await viewerFor(req);
  if (!v) return json({ error: "Sign in to chat with Kismet.", signIn: "/sign-in" }, 401);
  if (!(await rateLimit(`chat-side:${v.me?.id ?? v.identity!.authUserId}`, 40, 60))) return tooMany();
  return json(await sideView(v));
}
