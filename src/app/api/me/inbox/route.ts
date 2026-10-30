import { currentUser, json, unauthorized } from "@/lib/auth";
import { meView } from "@/lib/views";

// Conversations with open matches: last message and unread count, most recent first.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const view = await meView(me);
  const conversations = view.matches
    .map((m) => ({ matchId: m.dateId, name: m.name, photo: m.photos[0] ?? null, lastMessage: m.lastMessage, unread: m.unread, matchedAt: m.matchedAt }))
    .sort((a, b) => (b.lastMessage?.createdAt ?? b.matchedAt).localeCompare(a.lastMessage?.createdAt ?? a.matchedAt));
  return json({ conversations, unread: conversations.reduce((n, c) => n + c.unread, 0) });
}
