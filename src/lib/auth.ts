import { createHash, createHmac, randomBytes } from "node:crypto";
import { networkOf } from "./net";
import { cookies } from "next/headers";
import { after } from "next/server";
import { sql, toUser, type User } from "./db";
import { resolveClient, type Client } from "./client";
import { touchSeen } from "./records";

export const COOKIE = "ad_token";
/** A browser session lasts 30 days (then sign in again); a private link unused for 90 days stops working. */
export const SESSION_DAYS = 30;
export const LINK_IDLE_DAYS = 90;
const COOKIE_MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

/**
 * The private link / API token (Bearer). Expires on its own after LINK_IDLE_DAYS unused (every use keeps it alive,
 * so apps never notice); reset it anytime with POST /api/me/token/rotate.
 */
export async function userByToken(token: string | undefined | null): Promise<User | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await sql`select * from users where token_hash = ${hashToken(token)}
    and coalesce(token_used_at, created_at) > now() - make_interval(days => ${LINK_IDLE_DAYS})`;
  if (!rows[0]) return null;
  await sql`update users set token_used_at = now() where id = ${rows[0].id} and (token_used_at is null or token_used_at < now() - interval '1 hour')`;
  return toUser(rows[0]);
}

// Browser sessions: the cookie holds its own random token (stored hashed), never the private-link secret, so a
// copied cookie is not the account's permanent key. 30 days, ended server-side on sign-out.
/**
 * A new browser session. `viaToken`: the private link it came from; the session is only created while that link is
 * still current, so a link reset racing a sign-in can't leave a session behind. Keeps the newest 20 per account.
 */
export async function startSession(userId: string, viaToken?: string) {
  const token = newToken();
  const via = viaToken ? hashToken(viaToken) : null;
  const [ok] = await sql`insert into web_sessions (token_hash, user_id, expires_at)
    select ${hashToken(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS})
    where ${via}::text is null or exists (select 1 from users where id = ${userId} and token_hash = ${via})
    returning 1`;
  if (!ok) return null;
  await sql`delete from web_sessions where user_id = ${userId} and (expires_at < now()
    or token_hash in (select token_hash from web_sessions where user_id = ${userId} order by created_at desc offset 20))`;
  return token;
}

export async function endSession(token: string | undefined | null) {
  if (token && token.length >= 20 && token.length <= 100) await sql`delete from web_sessions where token_hash = ${hashToken(token)}`;
}

/** Ends every browser session of this account ("sign out everywhere", a reset private link). */
export const endAllSessions = async (userId: string) => void (await sql`delete from web_sessions where user_id = ${userId}`);

/** Cookies set before sessions existed hold the private link itself: accepted until this date (and upgraded on sight). */
export const LEGACY_COOKIE_UNTIL = Date.UTC(2026, 10, 20);

/** The account behind a browser cookie: a session, or (until LEGACY_COOKIE_UNTIL) an old cookie holding the link. */
export async function cookieUser(token: string | undefined | null): Promise<User | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [r] = await sql`select u.* from web_sessions s join users u on u.id = s.user_id where s.token_hash = ${hashToken(token)} and s.expires_at > now()`;
  if (r) return toUser(r);
  return Date.now() < LEGACY_COOKIE_UNTIL ? userByToken(token) : null;
}

/** An old cookie holding the private link: the account, so the caller can swap it for a session. Null otherwise. */
export async function legacyCookieUser(token: string | undefined | null) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [s] = await sql`select 1 from web_sessions where token_hash = ${hashToken(token)}`;
  return s ? null : userByToken(token);
}


// Bearer token (agents) first, then the httpOnly cookie (browser).
export async function tokenFrom(req?: Request) {
  const auth = req?.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (await cookies()).get(COOKIE)?.value;
}

export const hasBearer = (req?: Request) => Boolean(req?.headers.get("authorization")?.toLowerCase().startsWith("bearer "));

/** Which client sent this request (X-Kismet-Client header, then the body's client fields, then Bearer = api, cookie = web). */
export const requestClient = (req?: Request, body?: unknown): Client =>
  resolveClient(req?.headers.get("x-kismet-client"), hasBearer(req), body);

/**
 * The signed-in user: a Bearer token (agents, apps); in browsers, a Google / email sign-in joined to an account
 * (lib/identity.ts) before the private-link cookie, so a planted cookie never overrides who signed in.
 * Also records last seen on this channel (after the response).
 */
export async function currentUser(req?: Request) {
  const bearer = hasBearer(req);
  const idm = bearer ? null : await import("./identity");
  const identity = idm ? await idm.sessionIdentity() : null;
  const viaIdentity = identity && idm ? await idm.identityUser(identity.authUserId) : null;
  // A Google / email sign-in that isn't joined to an account never borrows a private-link cookie (a planted one
  // would otherwise collect their edits and photos); joining happens only through Connect in the chat.
  if (identity && !viaIdentity) return null;
  const token = await tokenFrom(req);
  const user = viaIdentity ?? (bearer ? await userByToken(token) : await cookieUser(token));
  if (user) {
    const c = requestClient(req);
    after(() => touchSeen(user.id, c));
  }
  return user;
}

export function clientIp(req: Request) {
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // One network per IPv6 /64 (anyone gets a whole /64, so per-address limits would be free to dodge). Compressed
  // forms ("2001:db8::a:b:c:d") are expanded first, so every address of a /64 lands in the same bucket.
  const net = networkOf(ip); // IPv4 per address (also written as IPv6), IPv6 per /64 (lib/net.ts)
  // Salted so stored counters can't be mapped back to an IP. Raw IPs are never stored.
  return createHmac("sha256", process.env.IP_SALT || process.env.DATABASE_URL || "agent-dates").update(net).digest("hex").slice(0, 32);
}

/** The public read-only endpoints (/mcp, /api/public/*): each call runs database queries, so 60 a minute per network. */
export const PUBLIC_PER_MINUTE = 60;
export const publicAllowed = (req: Request, name: string) => rateLimit(`public-${name}:${clientIp(req)}`, PUBLIC_PER_MINUTE, 60);

/** Reads a counter without counting: true while it is under `limit` (or unset / expired). */
export async function underLimit(key: string, limit: number) {
  const [r] = await sql`select count from rate_limits where key = ${key} and expires_at > now()`;
  return !r || (r.count as number) < limit;
}

export async function rateLimit(key: string, limit: number, windowSec: number) {
  const [r] = await sql`
    insert into rate_limits (key, count, expires_at)
    values (${key}, 1, now() + make_interval(secs => ${windowSec}))
    on conflict (key) do update set
      count = case when rate_limits.expires_at < now() then 1 else rate_limits.count + 1 end,
      expires_at = case when rate_limits.expires_at < now() then excluded.expires_at else rate_limits.expires_at end
    returning count`;
  return (r.count as number) <= limit;
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export const unauthorized = () => json({ error: "Not signed in. Send Authorization: Bearer <token> or open your private link." }, 401);
export const tooMany = (msg = "Slow down a little and try again later.") => json({ error: msg }, 429);
