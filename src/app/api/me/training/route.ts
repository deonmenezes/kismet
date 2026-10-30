import { currentUser, hasBearer, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { sessionIdentity } from "@/lib/identity";
import { cleanFeedback } from "@/lib/training-core";
import { saveFeedback, setTraining, trainingState } from "@/lib/training";

// Sharing for feedback and training, always the person's own choice: GET their current answer (null: not asked yet)
// and whether they can say yes here; POST {"share": true | false, "feedback"?: "...", "from"?: "chat" | "profile"}
// answers or changes it. A yes needs the person's own Google / email sign-in in this browser: never a token, an agent,
// or a private-link cookie (an agent holding the link could make one). Anyone can always say no.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return json({ share: (await trainingState(me.id)).answer, canShare: !hasBearer(req) && Boolean(await sessionIdentity()) });
}

export async function POST(req: Request) {
  if (hasBearer(req)) return json({ error: "Answer this on the Kismet website." }, 403);
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`training:${me.id}`, 10, 3600))) return tooMany();
  const body = await req.json().catch(() => null);
  if (typeof body?.share !== "boolean") return json({ error: 'Send {"share": true} or {"share": false}.' }, 400);
  if (body.share && !(await sessionIdentity())) return json({ error: "Sign in with Google or your email on the Kismet website to turn this on." }, 403);
  const c = requestClient(req);
  await setTraining(me.id, body.share, c, body.from === "profile" ? "profile" : "chat");
  // The answer is saved: a feedback hiccup must not make it look like it wasn't.
  const feedback = cleanFeedback(body.feedback);
  const feedbackSaved = feedback ? await saveFeedback(me.id, feedback, c).then(() => true, () => false) : null;
  return json({ ok: true, share: body.share, feedbackSaved });
}
