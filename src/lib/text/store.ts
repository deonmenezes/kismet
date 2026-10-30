import { createHash, randomBytes } from "node:crypto";
import { sql } from "../db";
import { rateLimit } from "../auth";
import type { LinkRequest, Notice, State, Thread, TextStore } from "./agent";
import { CODE_ALPHABET, formatCode, normalizeCode } from "./parse";
import type { TextChannel } from "./types";

// The Neon-backed store for Kismet by text (logic and tests: lib/text/agent.ts).
// user_phones = one text thread per (channel, phone): state, interview draft, opt-out, the WhatsApp window,
// the pending recommendation, queued notices (date ids only) and a short lease that serializes its messages.
// conversation_messages = the transcript (deleted with the thread, and so with the account).

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
const toThread = (r: any): Thread => ({
  id: r.id, channel: r.channel, phone: r.phone, userId: r.user_id ?? null, state: r.state, draft: r.draft ?? {},
  verifiedAt: iso(r.verified_at), optedOutAt: iso(r.opted_out_at), pausedAt: iso(r.paused_at), blockedAt: iso(r.blocked_at),
  lastInboundAt: iso(r.last_inbound_at), pendingDateId: r.pending_date_id ?? null, toldFinal: Boolean(r.told_final),
  notices: Array.isArray(r.notices) ? r.notices : [],
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export const codeHash = (code: string) => createHash("sha256").update(`kismet-link:${normalizeCode(code)}`).digest("hex");
/** 8 random characters of Crockford base32 (40 bits). */
const newCode = () => [...randomBytes(8)].map((b) => CODE_ALPHABET[b & 31]).join("");

/** A link code (15 minutes, single use) for the person `userId` (app/web side) or for a text thread. Shown as XXXX-XXXX. */
export async function createCode(owner: { userId: string } | { phoneId: string }) {
  await sql`delete from link_codes where expires_at < now()`;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const rows = await sql`insert into link_codes (code_hash, user_id, phone_id, expires_at)
      values (${codeHash(code)}, ${"userId" in owner ? owner.userId : null}, ${"phoneId" in owner ? owner.phoneId : null}, now() + interval '15 minutes')
      on conflict do nothing returning code_hash`;
    if (rows.length) return { code: formatCode(code), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  }
  throw new Error("could not allocate a link code");
}

/** Web side: a code the phone handed out -> a link request the phone must confirm with YES. */
export async function requestLinkFromThreadCode(userId: string, code: string) {
  const [r] = await sql`delete from link_codes where code_hash = ${codeHash(code)} and phone_id is not null and expires_at > now() returning phone_id`;
  if (!r) return null;
  const [t] = await sql`select * from user_phones where id = ${r.phone_id}`;
  if (!t) return null;
  await sql`delete from link_requests where phone_id = ${t.id}`;
  const [q] = await sql`insert into link_requests (user_id, phone_id, needs) values (${userId}, ${t.id}, 'phone') returning id`;
  return { thread: toThread(t), requestId: q.id as string };
}

/** App side: requests waiting for this user's approval (a phone typed their code). */
export async function webLinkRequests(userId: string) {
  const rows = await sql`select q.id, q.created_at, p.channel, p.phone from link_requests q join user_phones p on p.id = q.phone_id
    where q.user_id = ${userId} and q.needs = 'web' and q.expires_at > now() order by q.created_at desc`;
  return rows.map((r) => ({ requestId: r.id as string, channel: r.channel as string, phone: maskPhone(r.phone as string), createdAt: iso(r.created_at) }));
}

/** App side approval: links the thread; null when the request is unknown, expired or not this user's. */
export async function approveWebLink(userId: string, requestId: string) {
  const [q] = await sql`delete from link_requests where id = ${requestId} and user_id = ${userId} and needs = 'web' and expires_at > now() returning phone_id`;
  if (!q) return null;
  const [t] = await sql`select * from user_phones where id = ${q.phone_id}`;
  return t ? toThread(t) : null;
}

export const maskPhone = (p: string) => `${p.slice(0, 3)}••••${p.slice(-4)}`;

const LEASE_SECONDS = 30;

export const neonText: TextStore = {
  thread: async (channel: TextChannel, phone: string) => {
    const [r] = await sql`select * from user_phones where channel = ${channel} and phone = ${phone}`;
    return r ? toThread(r) : null;
  },
  createThread: async (channel, phone) => {
    const [r] = await sql`insert into user_phones (channel, phone) values (${channel}, ${phone})
      on conflict (channel, phone) do update set phone = excluded.phone returning *`;
    return toThread(r);
  },
  save: async (t) => {
    await sql`update user_phones set user_id = ${t.userId}, state = ${t.state}, draft = ${JSON.stringify(t.draft)}::jsonb,
      verified_at = ${t.verifiedAt}, opted_out_at = ${t.optedOutAt}, paused_at = ${t.pausedAt}, blocked_at = ${t.blockedAt},
      last_inbound_at = ${t.lastInboundAt}, told_final = ${t.toldFinal}, updated_at = now() where id = ${t.id}`;
  },
  deleteThread: async (id) => {
    await sql`delete from user_phones where id = ${id}`;
  },
  lock: async (t) => {
    const token = randomBytes(12).toString("hex");
    const deadline = Date.now() + 25_000;
    for (;;) {
      const got = await sql`update user_phones set lock_id = ${token}, lock_until = now() + make_interval(secs => ${LEASE_SECONDS})
        where id = ${t.id} and (lock_until is null or lock_until < now()) returning id`;
      if (got.length || Date.now() > deadline) break; // after the deadline, go ahead (a crashed holder's lease ends anyway)
      await new Promise((r) => setTimeout(r, 150));
    }
    return async () => {
      await sql`update user_phones set lock_id = null, lock_until = null where id = ${t.id} and lock_id = ${token}`;
    };
  },
  claimState: async (t, from: State, to: State) =>
    (await sql`update user_phones set state = ${to} where id = ${t.id} and state = ${from} returning id`).length > 0,
  claimSignup: async (t, userId) => {
    const [r] = await sql`update user_phones set state = 'signing_up', pending_user_id = coalesce(pending_user_id, ${userId}::uuid)
      where id = ${t.id} and state = 'confirm' returning pending_user_id`;
    return r ? (r.pending_user_id as string) : null;
  },
  claimInbound: async (t, providerId, text) =>
    (await sql`insert into conversation_messages (phone_id, direction, text, provider_id) values (${t.id}, 'in', ${text.slice(0, 4000)}, ${providerId})
      on conflict do nothing returning id`).length > 0,
  recordOutbound: async (t, text, providerId) => {
    await sql`insert into conversation_messages (phone_id, direction, text, provider_id) values (${t.id}, 'out', ${text.slice(0, 4000)}, ${providerId})`;
  },
  history: async (t, n) =>
    (await sql`select direction, text from (select id, direction, text from conversation_messages where phone_id = ${t.id} order by id desc limit ${n + 1}) x order by id`)
      .slice(0, -1) // the newest is the message being handled
      .map((r) => ({ direction: r.direction as "in" | "out", text: r.text as string })),
  hit: (key, limit, windowSec) => rateLimit(key.length > 80 ? createHash("sha256").update(key).digest("hex") : key, limit, windowSec),
  claimPending: async (t, dateId) =>
    (await sql`update user_phones set pending_date_id = ${dateId} where id = ${t.id} and pending_date_id is null returning id`).length > 0,
  releasePending: async (t, dateId) => {
    await sql`update user_phones set pending_date_id = null where id = ${t.id} and pending_date_id = ${dateId}`;
  },
  queueNotice: async (t, n: Notice) => {
    await sql`update user_phones set notices = case when notices @> ${JSON.stringify([n])}::jsonb then notices
      else notices || ${JSON.stringify([n])}::jsonb end where id = ${t.id}`;
  },
  takeNotices: async (t) => {
    const [r] = await sql`with old as (select notices from user_phones where id = ${t.id} for update)
      update user_phones set notices = '[]'::jsonb where id = ${t.id} returning (select notices from old) as notices`;
    return (r?.notices as Notice[]) ?? [];
  },
  threadsOfUser: async (userId) => (await sql`select * from user_phones where user_id = ${userId}`).map(toThread),
  requestLinkFromUserCode: async (t, code): Promise<LinkRequest | null> => {
    const [r] = await sql`delete from link_codes where code_hash = ${codeHash(code)} and user_id is not null and expires_at > now() returning user_id`;
    if (!r) return null;
    await sql`delete from link_requests where phone_id = ${t.id}`;
    const [q] = await sql`insert into link_requests (user_id, phone_id, needs) values (${r.user_id}, ${t.id}, 'web') returning id`;
    const [u] = await sql`select name from users where id = ${r.user_id}`;
    return { id: q.id as string, userId: r.user_id as string, userName: (u?.name as string) ?? "" };
  },
  createThreadCode: async (t) => (await createCode({ phoneId: t.id })).code,
  phoneLinkRequest: async (t) => {
    const [q] = await sql`select q.id, q.user_id, u.name from link_requests q join users u on u.id = q.user_id
      where q.phone_id = ${t.id} and q.needs = 'phone' and q.expires_at > now() order by q.created_at desc limit 1`;
    return q ? { id: q.id as string, userId: q.user_id as string, userName: q.name as string } : null;
  },
  completeLink: async (t, requestId) => {
    const [q] = await sql`delete from link_requests where id = ${requestId} and phone_id = ${t.id} and expires_at > now() returning user_id`;
    return Boolean(q);
  },
};

/** A match/notice about these dates is void (unmatch, block, report, deletion): drop it from every queue. */
export async function dropNotices(dateIds: string[]) {
  if (!dateIds.length) return;
  await sql`update user_phones set notices = coalesce((select jsonb_agg(n) from jsonb_array_elements(notices) n where not (n->>'dateId' = any(${dateIds}::text[]))), '[]'::jsonb)
    where notices <> '[]'::jsonb`;
  await sql`update user_phones set pending_date_id = null where pending_date_id = any(${dateIds}::uuid[])`;
}
