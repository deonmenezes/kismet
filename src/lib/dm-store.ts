import { sql, toDate } from "./db";
import { rateLimit } from "./auth";
import type { DmStore, Message } from "./dm";

// The Neon-backed message store (logic and tests: lib/dm.ts).

const msg = (r: Record<string, unknown>): Message => ({
  id: Number(r.id),
  senderId: r.sender_id as string,
  text: r.text as string,
  createdAt: new Date(r.created_at as string).toISOString(),
  kind: r.kind === "agent" ? "agent" : "human",
});

export const neonDm: DmStore = {
  date: async (id) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const [r] = await sql`select * from dates where id = ${id}`;
    return r ? toDate(r) : null;
  },
  blocked: async (a, b) =>
    (await sql`select 1 where exists (select 1 from blocks k where (k.blocker_id = ${a} and k.blocked_id = ${b}) or (k.blocker_id = ${b} and k.blocked_id = ${a}))
      or exists (select 1 from users x where x.id in (${a}, ${b}) and (x.banned_at is not null or x.hidden_at is not null))
      or exists (select 1 from users x join users y on y.id = ${b} where x.id = ${a} and x.is_demo <> y.is_demo)`).length > 0,
  hit: (key, limit, windowSec) => rateLimit(key, limit, windowSec),
  insert: async (dateId, senderId, text) => msg((await sql`insert into messages (date_id, sender_id, text) values (${dateId}, ${senderId}, ${text}) returning *`)[0]),
  list: async (dateId, afterId, limit) => (await sql`select * from messages where date_id = ${dateId} and id > ${afterId} order by id limit ${limit}`).map(msg),
  markRead: async (dateId, side, upTo) => {
    if (side === "a") await sql`update dates set read_a = greatest(read_a, ${upTo}) where id = ${dateId}`;
    else await sql`update dates set read_b = greatest(read_b, ${upTo}) where id = ${dateId}`;
  },
  close: async (dateId) => {
    await sql`update dates set chat_closed_at = coalesce(chat_closed_at, now()) where id = ${dateId}`;
  },
};

/** Per open match of this user: unread count and the last message (for the inbox, summary and views). */
export async function chatInfo(meId: string, dateIds: string[]) {
  // Kismet's lines (lib/match-agents.ts) are labelled and never counted as the other person's unread messages.
  const out = new Map<string, { unread: number; last: { text: string; mine: boolean; agent: boolean; createdAt: string } | null }>();
  if (!dateIds.length) return out;
  const counts = await sql`select d.id,
      count(m.id) filter (where m.sender_id <> ${meId} and m.kind = 'human' and m.id > case when d.a_id = ${meId} then d.read_a else d.read_b end)::int as unread
    from dates d left join messages m on m.date_id = d.id where d.id = any(${dateIds}::uuid[]) group by d.id`;
  const lasts = await sql`select distinct on (date_id) date_id, sender_id, kind, text, created_at from messages
    where date_id = any(${dateIds}::uuid[]) order by date_id, id desc`;
  const lastBy = new Map(lasts.map((r) => [r.date_id as string, r]));
  for (const c of counts) {
    const l = lastBy.get(c.id as string);
    out.set(c.id as string, {
      unread: c.unread as number,
      last: l ? { text: l.kind === "agent" ? `(Kismet) ${l.text}` : (l.text as string), mine: l.sender_id === meId, agent: l.kind === "agent", createdAt: new Date(l.created_at as string).toISOString() } : null,
    });
  }
  return out;
}

/** Messages of conversations closed more than 30 days ago are deleted. */
export const purgeClosedChats = () =>
  sql`delete from messages where date_id in (select id from dates where chat_closed_at < now() - interval '30 days')`;
