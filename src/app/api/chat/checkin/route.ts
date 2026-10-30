import { json, rateLimit, tooMany } from "@/lib/auth";
import { answerCheckIn, CHECKIN, sameOrigin, viewerFor, type CheckinAnswer } from "@/lib/text/web-chat";

// "Did you meet?" after a match: POST {"dateId", "answer": "met" | "not_yet" | "not_meeting"}. Private: the answer
// goes to this person's own activity log, never to the match.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const v = await viewerFor(req);
  if (!v?.me) return json({ error: "Sign in to chat with Kismet.", signIn: "/sign-in" }, 401);
  if (!(await rateLimit(`chat-msg:${v.me.id}`, 20, 60))) return tooMany();
  const body = await req.json().catch(() => null);
  const dateId = typeof body?.dateId === "string" && /^[0-9a-f-]{36}$/i.test(body.dateId) ? body.dateId : null;
  const answer = CHECKIN.includes(body?.answer) ? (body.answer as CheckinAnswer) : null;
  if (!dateId || !answer) return json({ error: "Send dateId and answer." }, 400);
  const view = await answerCheckIn(v, dateId, answer);
  return view ? json(view) : json({ error: "That check-in isn't open." }, 409);
}
