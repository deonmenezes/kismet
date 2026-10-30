import { sql } from "./db";
import { rateLimit } from "./auth";
import { removalHash, WAITLIST_PER_IP_HOUR, type WaitlistRow, type WaitlistStore } from "./waitlist";

// The Neon-backed waitlist store (logic and tests: lib/waitlist.ts).

const rowOf = async (where: "email" | "id", v: string | number): Promise<WaitlistRow | null> => {
  const [r] = where === "email"
    ? await sql`select id, ref_code from waitlist where lower(email) = lower(${v as string})`
    : await sql`select id, ref_code from waitlist where id = ${v as number}`;
  if (!r) return null;
  const [n] = await sql`select (select count(*) from waitlist where id <= ${r.id})::int as ord,
    (select count(*) from waitlist where referred_by = ${r.ref_code})::int as refs`;
  return { refCode: r.ref_code as string, order: n.ord as number, referrals: n.refs as number };
};

export const neonWaitlist: WaitlistStore = {
  hit: (ipHash) => rateLimit(`waitlist:${ipHash}`, WAITLIST_PER_IP_HOUR, 3600),
  byEmail: (email) => rowOf("email", email),
  refExists: async (code) => (await sql`select 1 from waitlist where ref_code = ${code}`).length > 0,
  insert: async (w) => {
    const [r] = await sql`insert into waitlist (email, name, place, handle, interests, platforms, ref_code, referred_by, removal_hash, ip_hash)
      values (${w.email}, ${w.name}, ${w.place}, ${w.handle}, ${w.interests}, ${w.platforms}, ${w.refCode}, ${w.referredBy}, ${w.removalHash}, ${w.ipHash})
      on conflict do nothing returning id`;
    return r ? rowOf("id", r.id as number) : null;
  },
};

/** One-time removal link: deletes the entry whose removal token this is, and its waitlist_join activity row. */
export async function removeFromWaitlist(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const [w] = await sql`delete from waitlist where removal_hash = ${removalHash(token)} returning id`;
  if (!w) return false;
  await sql`delete from activity_log where user_id is null and action = 'waitlist_join' and meta->>'waitlistId' = ${String(w.id)}`;
  await sql`insert into activity_log (user_id, channel, action) values (null, 'waitlist', 'waitlist_remove')`;
  return true;
}
