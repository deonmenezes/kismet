import { cookies } from "next/headers";
import { get } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { sql, toDate } from "@/lib/db";
import { canSeePhotos, isOpenMatch } from "@/lib/secret";
import { inPool } from "@/lib/edge-city";
import { seesPhotos } from "@/lib/views";
import { ADMIN_COOKIE, adminCookieOk } from "@/lib/safety";

// Serves a photo from the private Blob store, only to someone entitled to see that person: the owner, someone
// whose own agent recommends them (open recommendation, both Edge City members), or an open match; and an admin.
// Everyone else: 404.
export async function GET(req: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const { id } = await ctx.params;
  const nope = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return nope();
  const [photo] = await sql`select p.pathname, p.user_id, u.banned_at, u.hidden_at, u.is_demo, u.edge_city from photos p join users u on u.id = p.user_id where p.id = ${id}`;
  if (!photo) return nope();
  const admin = adminCookieOk((await cookies()).get(ADMIN_COOKIE)?.value, process.env.ADMIN_KEY);
  if (!admin) {
    const me = await currentUser(req);
    if (!me) return nope();
    const owner = photo.user_id as string;
    if (me.id !== owner) {
      if (photo.banned_at || photo.hidden_at || Boolean(photo.is_demo) !== me.isDemo) return nope();
      const [blocked] = await sql`select 1 from blocks k where (k.blocker_id = ${me.id} and k.blocked_id = ${owner}) or (k.blocker_id = ${owner} and k.blocked_id = ${me.id})`;
      if (blocked) return nope();
      const all = (await sql`select * from dates where (a_id = ${me.id} and b_id = ${owner}) or (a_id = ${owner} and b_id = ${me.id})`).map(toDate);
      // A recommendation counts only between Edge City members (lib/edge-city.ts); a match already made always does.
      const dates = inPool(me) && photo.edge_city === true ? all : all.filter(isOpenMatch);
      if (!canSeePhotos(dates, me.id, owner) || !(await seesPhotos(me))) return nope();
    }
  }
  const blob = await get(photo.pathname as string, { access: "private" });
  if (!blob || blob.statusCode !== 200) return nope();
  return new Response(blob.stream, {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" },
  });
}
