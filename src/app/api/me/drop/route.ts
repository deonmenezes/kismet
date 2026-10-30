import { after } from "next/server";
import { currentUser, json, requestClient, unauthorized } from "@/lib/auth";
import { dropFor } from "@/lib/drop-store";
import { markShown } from "@/lib/records";

// This week's Kismet (the weekly drop, lib/drop.ts) for agents (lib/agent-script.ts, section 3; the iOS app and its
// iMessage extension read GET /api/me instead): the one person and
// the proposed date plan. Answer it like any recommendation: POST /api/me/decide {"dateId", "decision"}.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const view = await dropFor(me);
  const open = view.drop?.status === "open" ? view.drop.dateId : null;
  if (open) after(() => markShown(me.id, [open], requestClient(req)));
  return json(view);
}
