import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";

// World ID (optional "✓ World ID verified" badge). No database or framework imports (unit-tested directly).
// Flow (https://docs.world.org/world-id/idkit/integrate): the backend signs each proof request (RP signature),
// the /verify/<code> page runs IDKit (Orb or Selfie Check, World ID 4.0 only), the backend forwards the result
// as-is to the Developer Portal and stores the nullifier: one World ID = one verified account.
// Off (no buttons, no links, "unavailable" answers) unless WORLD_APP_ID, WORLD_RP_ID and WORLD_SIGNING_KEY are set.

export type WorldConfig = {
  appId: `app_${string}`;
  rpId: string;
  signingKey: string;
  action: string;
  environment: "production" | "staging";
};

export const DEFAULT_ACTION = "agent-dates-verify-2026";
export const VERIFY_API = "https://developer.world.org/api/v4/verify";
export type Credential = "orb" | "selfie";

/** null = the feature is off: a var is missing or malformed. */
export function worldConfig(env: Record<string, string | undefined> = process.env): WorldConfig | null {
  const appId = env.WORLD_APP_ID?.trim();
  const rpId = env.WORLD_RP_ID?.trim();
  const signingKey = env.WORLD_SIGNING_KEY?.trim();
  const environment = env.WORLD_ENV?.trim() || "production";
  const action = env.WORLD_ACTION?.trim() || DEFAULT_ACTION;
  if (!appId || !rpId || !signingKey) return null;
  if (!/^app_[A-Za-z0-9_-]+$/.test(appId) || !/^rp_[A-Za-z0-9_-]+$/.test(rpId)) return null;
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(signingKey)) return null;
  if (environment !== "production" && environment !== "staging") return null;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(action)) return null;
  return { appId: appId as `app_${string}`, rpId, signingKey, action, environment };
}

/** What the browser may know: never the signing key. */
export const clientConfig = (c: WorldConfig) => ({ appId: c.appId, rpId: c.rpId, action: c.action, environment: c.environment });

/** RP signature for one proof request (server only), in the shape IDKit's rp_context takes. */
export function rpSignature(c: WorldConfig, ttl = 300) {
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: c.signingKey, action: c.action, ttl });
  return { signature: sig, nonce, created_at: createdAt, expires_at: expiresAt };
}

/** The proof is bound to this account: the signal is enforced again on the backend (signal_hash). */
export const signalFor = (userId: string) => `agent-dates:${userId}`;

// ---- One-time verify links: /verify/<code>. Stateless (HMAC under a key derived from the signing key), tied to
// one user, expiring within 15 minutes, single use (the used ones are recorded by hash). The same link is handed
// out for a 5-minute window, so reading a summary twice does not mint a new one; `variant` moves past used ones.

export const CODE_TTL = 15 * 60;
const CODE_BUCKET = 5 * 60;
export const CODE_VARIANTS = 4;
const MAC_BYTES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const codeKey = (c: WorldConfig) => createHash("sha256").update(`agent-dates:verify-code:${c.signingKey.toLowerCase().replace(/^0x/, "")}`).digest();
const mac = (c: WorldConfig, payload: Buffer) => createHmac("sha256", codeKey(c)).update(payload).digest().subarray(0, MAC_BYTES);

export function mintCode(c: WorldConfig, userId: string, variant: number, nowSec = Math.floor(Date.now() / 1000)) {
  if (!UUID.test(userId) || variant < 0 || variant >= CODE_VARIANTS) throw new Error("bad code input");
  const expiresAt = Math.floor(nowSec / CODE_BUCKET) * CODE_BUCKET + CODE_TTL;
  const payload = Buffer.alloc(21);
  Buffer.from(userId.replace(/-/g, ""), "hex").copy(payload, 0);
  payload.writeUInt32BE(expiresAt, 16);
  payload.writeUInt8(variant, 20);
  return { code: Buffer.concat([payload, mac(c, payload)]).toString("base64url"), expiresAt };
}

export type ParsedCode = { userId: string; expiresAt: number; codeHash: string };

export function parseCode(c: WorldConfig, code: unknown, nowSec = Math.floor(Date.now() / 1000)): ParsedCode | { error: "invalid" | "expired" } {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{44}$/.test(code)) return { error: "invalid" };
  const raw = Buffer.from(code, "base64url");
  if (raw.length !== 21 + MAC_BYTES) return { error: "invalid" };
  const payload = raw.subarray(0, 21);
  if (!timingSafeEqual(raw.subarray(21), mac(c, payload)) || payload.readUInt8(20) >= CODE_VARIANTS) return { error: "invalid" };
  const expiresAt = payload.readUInt32BE(16);
  if (nowSec >= expiresAt) return { error: "expired" };
  const hex = payload.subarray(0, 16).toString("hex");
  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { userId, expiresAt, codeHash: codeHash(code) };
}

export const codeHash = (code: string) => createHash("sha256").update(`agent-dates:world-code:${code}`).digest("hex");

// ---- Proof checks

/** 0x-hex (as the docs show) to decimal for NUMERIC(78,0). Decimal input (as the SDK types describe) passes through. */
export function nullifierToDecimal(n: unknown): string | null {
  if (typeof n !== "string") return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(n) && !/^[0-9]{1,78}$/.test(n)) return null;
  const v = BigInt(n);
  return v < BigInt(1) << BigInt(256) ? v.toString() : null;
}

const asBig = (s: unknown) => {
  if (typeof s !== "string" || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(s)) return null;
  return BigInt(s);
};

// Credential identifiers the docs show for World ID 4.0 uniqueness proofs, with their issuer schema ids.
const CREDENTIALS: Record<string, { level: Credential; schema: number }> = {
  proof_of_human: { level: "orb", schema: 1 },
  selfie: { level: "selfie", schema: 11 },
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => Boolean(x) && typeof x === "object" && !Array.isArray(x);

export type ProofItem = { level: Credential; identifier: string; nullifier: string };

/** Checks on the IDKit result BEFORE it is sent anywhere. Returns the acceptable response items. */
export function checkResult(c: WorldConfig, result: unknown, userId: string): ProofItem[] | { error: string } {
  if (!isObj(result)) return { error: "No World ID result." };
  if (result.environment !== c.environment) return { error: "That proof is from the wrong World ID environment." };
  if (result.protocol_version !== "4.0" || result.session_id !== undefined) return { error: "Please update World App and try again (World ID 4.0 needed)." };
  if (result.action !== c.action) return { error: "That proof is for a different action." };
  if (!Array.isArray(result.responses) || !result.responses.length) return { error: "No World ID result." };
  const signal = BigInt(hashSignal(signalFor(userId)));
  const items: ProofItem[] = [];
  for (const r of result.responses) {
    if (!isObj(r) || typeof r.identifier !== "string") continue;
    const cred = CREDENTIALS[r.identifier];
    if (!cred || r.issuer_schema_id !== cred.schema) continue;
    const nullifier = nullifierToDecimal(r.nullifier);
    if (!nullifier || asBig(r.signal_hash) !== signal) continue;
    items.push({ level: cred.level, identifier: r.identifier, nullifier });
  }
  if (!items.length) return { error: "Only an Orb or Selfie Check World ID proof for this account counts." };
  return items;
}

/** Checks on the Developer Portal's answer. Picks the proven credential (Orb over Selfie). */
export function pickVerified(c: WorldConfig, verification: unknown, items: ProofItem[]): ProofItem | { error: string } {
  if (!isObj(verification) || verification.success !== true || verification.environment !== c.environment) {
    return { error: "World ID could not verify that proof." };
  }
  // With per-credential results, keep only the ones that passed ("success: true" means at least one did).
  let ok = items;
  if (Array.isArray(verification.results)) {
    const passed = new Set(verification.results.filter((r) => isObj(r) && r.success === true).map((r) => (r as Obj).identifier));
    ok = items.filter((i) => passed.has(i.identifier));
  } else if (items.length > 1) ok = [];
  const best = ok.find((i) => i.level === "orb") ?? ok.find((i) => i.level === "selfie");
  return best ?? { error: "World ID could not verify that proof." };
}

// ---- The whole verify step, with the database behind an interface (unit-tested with a fake store).

export type VerifyStore = {
  /** false when the user does not exist; otherwise whether they are verified. */
  userState(userId: string): Promise<{ exists: boolean; verified: boolean }>;
  /** Marks the link used. false if it already was. */
  consumeCode(codeHash: string): Promise<boolean>;
  /** One World ID per account, one account per World ID (UNIQUE (nullifier, action)). */
  saveNullifier(userId: string, nullifier: string, action: string, level: Credential): Promise<"ok" | "duplicate" | "already_verified">;
};

export type VerifyOutcome = { status: number; body: { ok: boolean; error?: string; message: string; level?: Credential } };

const fail = (status: number, error: string, message: string): VerifyOutcome => ({ status, body: { ok: false, error, message } });

export const DUPLICATE_MESSAGE = "This World ID is already linked to another Kismet account. One World ID can verify only one account.";

export async function completeVerification(
  c: WorldConfig,
  store: VerifyStore,
  code: unknown,
  result: unknown,
  opts: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<VerifyOutcome> {
  const parsed = parseCode(c, code, opts.now);
  if ("error" in parsed) {
    return parsed.error === "expired"
      ? fail(410, "link_expired", "This verify link expired. Ask your agent (or open your Kismet home) for a new one.")
      : fail(400, "invalid_link", "This verify link is not valid.");
  }
  const user = await store.userState(parsed.userId);
  if (!user.exists) return fail(404, "invalid_link", "This verify link is not valid.");
  if (user.verified) return { status: 200, body: { ok: true, message: "You're already World ID verified ✓" } };

  const items = checkResult(c, result, parsed.userId);
  if ("error" in items) return fail(400, "invalid_proof", items.error);

  if (!(await store.consumeCode(parsed.codeHash))) return fail(410, "link_used", "This verify link was already used. Ask for a new one.");

  let verification: unknown;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${VERIFY_API}/${encodeURIComponent(c.rpId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result), // forwarded as-is
      signal: AbortSignal.timeout(15_000),
    });
    verification = await res.json().catch(() => null);
    if (!res.ok) return fail(400, "not_verified", "World ID could not verify that proof.");
  } catch {
    return fail(502, "world_unreachable", "Couldn't reach World ID. Try again with a new link.");
  }

  const picked = pickVerified(c, verification, items);
  if ("error" in picked) return fail(400, "not_verified", picked.error);

  const saved = await store.saveNullifier(parsed.userId, picked.nullifier, c.action, picked.level);
  if (saved === "duplicate") return fail(409, "world_id_in_use", DUPLICATE_MESSAGE);
  return { status: 200, body: { ok: true, level: picked.level, message: "Verified ✓ Your matches will see a World ID verified badge." } };
}
