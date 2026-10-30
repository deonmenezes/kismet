import { autoStartDates, setEdgeCity } from "@/lib/actions";
import { clientIp, currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { SITE } from "@/lib/copy";
import { edgeOnlyText, edgeWelcomeText, normalizeEdgeCity, normalizeWeeks } from "@/lib/edge-city";
import { edgeCityView } from "@/lib/views";

// "Are you at Edge City India?" (lib/edge-city.ts), for apps and agents: GET where the person stands, POST
// {"edgeCity": true | false, "weeks"?: ["week1", "week2", "week3"]} answers it (self-attested, changeable). Kismet is
// for Edge City India residents only: a yes puts their agent in the pool, a no gets the waitlist.
export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return json(edgeCityView(me));
}

export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`edge-city:${me.id}`, 10, 3600))) return tooMany();
  const body = await req.json().catch(() => null);
  const member = normalizeEdgeCity(body?.edgeCity ?? body?.atEdgeCity ?? body?.answer);
  if (member === undefined) return json({ error: 'Send {"edgeCity": true} or {"edgeCity": false}, and optionally "weeks": ["week1", "week2", "week3"].' }, 400);
  const c = requestClient(req, body);
  const u = await setEdgeCity(me.id, member, normalizeWeeks(body?.weeks ?? body?.edgeWeeks), c);
  if (!u) return unauthorized();
  if (member) await autoStartDates(u, clientIp(req), c);
  return json({ ok: true, ...edgeCityView(u), text: member ? edgeWelcomeText : edgeOnlyText(SITE) });
}
