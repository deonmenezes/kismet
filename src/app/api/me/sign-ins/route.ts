import { currentUser, endAllSessions, json, unauthorized } from "@/lib/auth";
import { joinedSignIns, removeNewerSignIns, sessionIdentity } from "@/lib/identity";

// The Google / email sign-ins joined to your account. GET lists them (emails masked); DELETE {"id"} removes one,
// by seniority: your sign-in can remove only sign-ins joined after it (so a later joiner can't remove yours). A
// removed sign-in can never join this account again, and every private-link browser session ends.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return json({ signIns: await joinedSignIns(me.id, (await sessionIdentity())?.authUserId ?? null) });
}

export async function DELETE(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" && body.id.length <= 100 ? body.id : null;
  if (!id) return json({ error: 'Send {"id"} from the list.' }, 400);
  const current = (await sessionIdentity())?.authUserId ?? null;
  const gone = await removeNewerSignIns(me.id, current, id);
  if (!gone.length) return json({ error: "You can remove only sign-ins that joined after yours (sign in with Google or email first)." }, 403);
  // A removed sign-in can't join again, and every private-link browser session ends (reset the link too if it leaked).
  await endAllSessions(me.id);
  return json({ ok: true, signIns: await joinedSignIns(me.id, current) });
}
