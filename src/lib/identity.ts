import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { sql, toUser, type User } from "./db";
import { logActivity } from "./records";
import { checkReportHistory } from "./report-history";
import type { Client } from "./client";

// Website sign-in: Neon Auth (Better Auth) with Google or a 6-digit code by email. The Neon Auth user is only
// an identity; the Kismet account is `users`, joined through auth_identities once the chat interview signs
// them up, or once they press Connect for an account they opened with a private link in the same browser
// (never automatically: a planted private-link cookie must not capture someone's Google sign-in).

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const secret = process.env.NEON_AUTH_COOKIE_SECRET;

/** Off (no sign-in buttons, no sessions) unless NEON_AUTH_BASE_URL and a 32+ character NEON_AUTH_COOKIE_SECRET are set. */
export const neonAuth = baseUrl && secret && secret.length >= 32 ? createNeonAuth({ baseUrl, cookies: { secret }, logLevel: "error" }) : null;

export const SESSION_COOKIE = "__Secure-neon-auth.session_token";
const PREFIX = "__Secure-neon-auth";

export type Identity = { authUserId: string; email: string; name: string };

// Upstream session checks, by hashed session token, for a minute (the SDK's own signed cache lasts 5).
const memo = new Map<string, { id: Identity | null; exp: number }>();
const toIdentity = (u: { id?: unknown; email?: unknown; name?: unknown } | null | undefined): Identity | null =>
  u?.id ? { authUserId: String(u.id), email: String(u.email ?? ""), name: String(u.name ?? "") } : null;

/**
 * The signed-in Neon Auth identity of this browser, or null (no session, or sign-in is off). The SDK's signed
 * session cookie answers without a network call; when it has expired we ask Neon Auth directly and write no
 * cookies, because pages (Server Components) may not set them (the /api/auth proxy refreshes them).
 */
export async function sessionIdentity(): Promise<Identity | null> {
  if (!neonAuth) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null; // no upstream call for visitors who never signed in
  const key = createHash("sha256").update(token).digest("hex");
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.id;
  let id: Identity | null = null;
  try {
    const cookie = jar.getAll().filter((c) => c.name.startsWith(PREFIX)).map((c) => `${c.name}=${c.value}`).join("; ");
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
    const res = await fetch(`${baseUrl!.replace(/\/$/, "")}/get-session`, { headers: { cookie, origin }, cache: "no-store", signal: AbortSignal.timeout(6000) });
    id = toIdentity(((await res.json().catch(() => null)) as { user?: Record<string, unknown> } | null)?.user);
  } catch (e) {
    console.error("session lookup failed", e instanceof Error ? e.message : e);
    return null; // not cached: try again next request
  }
  if (memo.size > 5000) memo.clear();
  memo.set(key, { id, exp: Date.now() + 60_000 });
  return id;
}

/** The Kismet account behind an identity, if it has one. */
export async function identityUser(authUserId: string): Promise<User | null> {
  const [r] = await sql`select u.* from auth_identities i join users u on u.id = i.user_id where i.auth_user_id = ${authUserId}`;
  return r ? toUser(r) : null;
}

/** Joins an identity to a Kismet account. An identity belongs to one account: the first link stays. */
export async function linkIdentity(id: Identity, userId: string, c: Client) {
  // A sign-in removed from this account (by its owner, or on a link reset) never joins it again.
  const [revoked] = await sql`select 1 from revoked_identities where auth_user_id = ${id.authUserId} and user_id = ${userId}`;
  if (revoked) return false;
  const [r] = await sql`insert into auth_identities (auth_user_id, user_id, email) values (${id.authUserId}, ${userId}, ${id.email.slice(0, 320)})
    on conflict (auth_user_id) do update set last_seen_at = now() returning (xmax = 0) as inserted, user_id`;
  if (r?.inserted) {
    await logActivity(userId, c, "signin", { via: "identity_link" });
    await checkReportHistory(userId); // a new sign-in email (lib/report-history.ts)
  }
  return r?.user_id === userId;
}

export type JoinedSignIn = { id: string; email: string; joinedAt: string; you: boolean };
const mask = (e: string) => (e.includes("@") ? `${e.slice(0, 2)}…@${e.split("@")[1]}` : "sign-in");

/** The Google / email sign-ins joined to an account (emails masked), oldest first. */
export async function joinedSignIns(userId: string, current: string | null): Promise<JoinedSignIn[]> {
  const rows = await sql`select auth_user_id, email, created_at from auth_identities where user_id = ${userId} order by created_at`;
  return rows.map((r) => ({ id: r.auth_user_id as string, email: mask(r.email as string), joinedAt: new Date(r.created_at as string).toISOString(), you: r.auth_user_id === current }));
}

/**
 * Removes sign-ins from an account. Seniority decides: a sign-in may remove only sign-ins joined AFTER it (an
 * attacker who joined with a leaked link can't remove the owner's older sign-in, but the owner can remove theirs).
 * A request with no sign-in of its own (private link, app token) removes none. `only`: one sign-in, else all newer.
 */
export async function removeNewerSignIns(userId: string, current: string | null, only?: string) {
  if (!current) return [];
  const [mine] = await sql`select created_at from auth_identities where auth_user_id = ${current} and user_id = ${userId}`;
  if (!mine) return [];
  const gone = (only
    ? await sql`delete from auth_identities where user_id = ${userId} and auth_user_id = ${only} and auth_user_id <> ${current} and created_at > ${mine.created_at} returning auth_user_id`
    : await sql`delete from auth_identities where user_id = ${userId} and auth_user_id <> ${current} and created_at > ${mine.created_at} returning auth_user_id`
  ).map((r) => r.auth_user_id as string);
  if (gone.length) {
    await sql`insert into revoked_identities (auth_user_id, user_id) select unnest(${gone}::text[]), ${userId}::uuid on conflict do nothing`;
    await sql`delete from neon_auth.session where "userId"::text = any(${gone}::text[])`
      .catch((e) => console.error("sign-in revoke failed", e instanceof Error ? e.message : e));
  }
  return gone;
}

/** Removes a sign-in that never got an account (its sessions and Google link go with it). */
export async function deleteIdentity(authUserId: string) {
  await sql`delete from neon_auth."user" where id::text = ${authUserId} and not exists (select 1 from auth_identities where auth_user_id = ${authUserId})`
    .catch((e) => console.error("sign-in delete failed", e instanceof Error ? e.message : e));
}

/** The account behind the browser's identity session (lib/auth.ts currentUser tries it before the private-link cookie). */
export async function identitySessionUser(): Promise<User | null> {
  const id = await sessionIdentity();
  return id ? identityUser(id.authUserId) : null;
}
