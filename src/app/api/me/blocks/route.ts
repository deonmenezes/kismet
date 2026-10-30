import { currentUser, json, unauthorized } from "@/lib/auth";
import { listBlocks } from "@/lib/actions";

export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return json({ blocks: await listBlocks(me) });
}
