import { json } from "@/lib/auth";
import { connectAccount, sameOrigin, syncChat, viewerFor } from "@/lib/text/web-chat";

// "Connect": joins the signed-in Google / email identity to the private-link account open in this browser.
// Only from our own pages (Origin check), and only when the person presses the button.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const v = await viewerFor(req);
  if (!v?.identity || !v.connect) return json({ error: "Nothing to connect." }, 409);
  if (!(await connectAccount(v))) return json({ error: "This sign-in already belongs to another Kismet account." }, 409);
  return json(await syncChat({ me: v.connect, identity: v.identity, connect: null }));
}
