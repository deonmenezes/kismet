// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { computeRpSignatureMessage } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import {
  clientConfig, completeVerification, CODE_TTL, DEFAULT_ACTION, DUPLICATE_MESSAGE, mintCode, nullifierToDecimal, parseCode,
  rpSignature, signalFor, VERIFY_API, worldConfig,
} from "./world.ts";

const KEY = randomBytes(32).toString("hex"); // throwaway signing key
const ENV = { WORLD_APP_ID: "app_staging_0123456789abcdef", WORLD_RP_ID: "rp_0123456789abcdef", WORLD_SIGNING_KEY: KEY };
const C = worldConfig(ENV);
const U1 = "a0000000-0000-4000-8000-000000000001";
const U2 = "b0000000-0000-4000-8000-000000000002";
// The nullifier from the POST /v4/verify reference examples.
const NULLIFIER = "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";
const NOW = 1_792_000_000;

test("feature off unless all three vars are set and well-formed", () => {
  assert.equal(worldConfig({}), null);
  for (const k of Object.keys(ENV)) assert.equal(worldConfig({ ...ENV, [k]: undefined }), null, k);
  for (const k of Object.keys(ENV)) assert.equal(worldConfig({ ...ENV, [k]: "  " }), null, k);
  assert.equal(worldConfig({ ...ENV, WORLD_SIGNING_KEY: "abc" }), null);
  assert.equal(worldConfig({ ...ENV, WORLD_APP_ID: "0123" }), null);
  assert.equal(worldConfig({ ...ENV, WORLD_RP_ID: "app_x" }), null);
  assert.equal(worldConfig({ ...ENV, WORLD_ENV: "sandbox" }), null);
  assert.deepEqual(worldConfig(ENV), { appId: ENV.WORLD_APP_ID, rpId: ENV.WORLD_RP_ID, signingKey: KEY, action: DEFAULT_ACTION, environment: "production" });
  assert.equal(worldConfig({ ...ENV, WORLD_SIGNING_KEY: `0x${KEY}`, WORLD_ENV: "staging" }).environment, "staging");
  assert.equal(worldConfig({ ...ENV, WORLD_ACTION: "my-action" }).action, "my-action");
});

test("the browser config never carries the signing key", () => {
  const cc = clientConfig(C);
  assert.deepEqual(Object.keys(cc).sort(), ["action", "appId", "environment", "rpId"]);
  assert.ok(!JSON.stringify(cc).includes(KEY));
});

test("signRequest runs for real with a throwaway key: rp_context shape, 5-minute expiry", () => {
  const a = rpSignature(C);
  const b = rpSignature(C);
  assert.match(a.signature, /^0x[0-9a-f]{130}$/);
  assert.ok(["1b", "1c"].includes(a.signature.slice(-2))); // v = recovery id + 27
  assert.match(a.nonce, /^0x00[0-9a-f]{62}$/); // a field element: top byte zero
  assert.equal(a.expires_at - a.created_at, 300);
  assert.ok(Math.abs(a.created_at - Date.now() / 1000) < 5);
  assert.notEqual(a.nonce, b.nonce);
  assert.ok(!JSON.stringify(a).includes(KEY));
  // The signed message matches the docs' test vector (RP Signatures page).
  const nonce = Buffer.from("008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd", "hex");
  assert.equal(
    Buffer.from(computeRpSignatureMessage(nonce, 1700000000, 1700000300, "test-action")).toString("hex"),
    "01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a",
  );
});

test("nullifier: 0x-hex to decimal for NUMERIC(78,0)", () => {
  assert.equal(nullifierToDecimal(NULLIFIER), "19888075077784840540223737223137982910975806272286153757503062117164780026840");
  assert.equal(nullifierToDecimal("0x0"), "0");
  assert.equal(nullifierToDecimal("0xff"), "255");
  assert.equal(nullifierToDecimal("0xFF"), "255"); // casing cannot make two different values
  assert.equal(nullifierToDecimal("0x00ff"), "255"); // nor can leading zeros
  assert.equal(nullifierToDecimal(`0x${"f".repeat(64)}`), "115792089237316195423570985008687907853269984665640564039457584007913129639935");
  assert.equal(nullifierToDecimal("12345"), "12345"); // already decimal (as the SDK types describe)
  for (const bad of ["0x", "ff", "-1", " 0x1", "0x1 ", "1e5", "0x" + "f".repeat(65), "115792089237316195423570985008687907853269984665640564039457584007913129639936", 5, null, undefined, {}]) {
    assert.equal(nullifierToDecimal(bad), null, String(bad));
  }
});

test("verify links: tied to one user, expire within 15 minutes, tamper-proof", () => {
  const { code, expiresAt } = mintCode(C, U1, 0, NOW);
  assert.match(code, /^[A-Za-z0-9_-]{44}$/);
  assert.ok(expiresAt - NOW > 10 * 60 && expiresAt - NOW <= CODE_TTL);
  const p = parseCode(C, code, NOW);
  assert.equal(p.userId, U1);
  assert.equal(p.expiresAt, expiresAt);
  assert.equal(mintCode(C, U1, 0, NOW + 60).code, code); // same link within the window: no churn
  assert.notEqual(mintCode(C, U1, 1, NOW).code, code);
  assert.notEqual(mintCode(C, U2, 0, NOW).code, code);
  assert.deepEqual(parseCode(C, code, expiresAt), { error: "expired" });
  assert.deepEqual(parseCode(worldConfig({ ...ENV, WORLD_SIGNING_KEY: randomBytes(32).toString("hex") }), code, NOW), { error: "invalid" });
  const raw = Buffer.from(code, "base64url");
  raw[3] ^= 1; // another user id
  assert.deepEqual(parseCode(C, raw.toString("base64url"), NOW), { error: "invalid" });
  const later = Buffer.from(code, "base64url");
  later.writeUInt32BE(expiresAt + 3600, 16); // a longer expiry
  assert.deepEqual(parseCode(C, later.toString("base64url"), NOW), { error: "invalid" });
  for (const bad of ["", "x", code.slice(1), `${code}A`, 5, null]) assert.deepEqual(parseCode(C, bad, NOW), { error: "invalid" });
});

// ---- completeVerification with an in-memory store (same rules as the SQL: UNIQUE (nullifier, action), one per user)

function fakeStore() {
  const users = new Map([[U1, null], [U2, null]]);
  const used = new Set();
  const byNullifier = new Map();
  return {
    users, byNullifier,
    async userState(id) { return { exists: users.has(id), verified: Boolean(users.get(id)) }; },
    async consumeCode(h) { if (used.has(h)) return false; used.add(h); return true; },
    async saveNullifier(id, n, action, level) {
      const k = `${n}|${action}`;
      if (byNullifier.has(k)) return byNullifier.get(k) === id ? "already_verified" : "duplicate";
      if (users.get(id)) return "already_verified";
      byNullifier.set(k, id);
      users.set(id, level);
      return "ok";
    },
    deleteUser(id) { users.delete(id); for (const [k, v] of byNullifier) if (v === id) byNullifier.delete(k); },
  };
}

// IDKit results in the shapes the integrate guide shows (World ID 4.0 uniqueness / Selfie Check).
const proof = ["0x1a2b", "0x3c4d", "0x5e6f", "0x7a8b", "0x9c0d"];
const orbItem = (userId, over = {}) => ({ identifier: "proof_of_human", signal_hash: hashSignal(signalFor(userId)), proof, nullifier: NULLIFIER, issuer_schema_id: 1, expires_at_min: 1756166400, ...over });
const selfieItem = (userId, over = {}) => ({ identifier: "selfie", signal_hash: hashSignal(signalFor(userId)), proof, nullifier: NULLIFIER, issuer_schema_id: 11, expires_at_min: 1788302888, sybil_score: 10, ...over });
const idkitResult = (items, over = {}) => ({ protocol_version: "4.0", nonce: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", action: DEFAULT_ACTION, environment: "production", responses: items, ...over });

// Developer Portal answers in the shapes of the POST /v4/verify reference (VerifyV4SuccessResponse / ErrorResponse).
const portalOk = (identifier = "proof_of_human", over = {}) => ({
  success: true, action: DEFAULT_ACTION, nullifier: NULLIFIER, created_at: "2026-10-18T10:00:00.000Z", environment: "production",
  results: [{ identifier, success: true, nullifier: NULLIFIER }], ...over,
});
const portalFail = { success: false, code: "all_verifications_failed", detail: "All proof verifications failed.", results: [{ identifier: "orb", success: false, code: "verification_error", detail: "On-chain proof verification failed." }] };

function fakeFetch(answer, status = 200) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(answer), { status }); };
  fn.calls = calls;
  return fn;
}

const code = (userId, v = 0) => mintCode(C, userId, v, NOW).code;
const run = (store, c, result, fetchImpl) => completeVerification(C, store, c, result, { now: NOW, fetchImpl });

test("Orb proof: forwarded as-is to /v4/verify/{rp_id}, nullifier stored, level orb", async () => {
  const store = fakeStore();
  const f = fakeFetch(portalOk());
  const result = idkitResult([orbItem(U1)]);
  const out = await run(store, code(U1), result, f);
  assert.equal(out.status, 200);
  assert.deepEqual([out.body.ok, out.body.level], [true, "orb"]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `${VERIFY_API}/${ENV.WORLD_RP_ID}`);
  assert.deepEqual(f.calls[0].body, result);
  assert.equal(store.users.get(U1), "orb");
  assert.equal(store.byNullifier.get(`${BigInt(NULLIFIER)}|${DEFAULT_ACTION}`), U1);
});

test("Selfie Check proof: level selfie; Orb wins only when the portal passed it", async () => {
  const s1 = fakeStore();
  const out = await run(s1, code(U1), idkitResult([selfieItem(U1)]), fakeFetch(portalOk("selfie")));
  assert.deepEqual([out.status, out.body.level], [200, "selfie"]);
  const s2 = fakeStore();
  const both = idkitResult([orbItem(U1), selfieItem(U1, { nullifier: "0x01" })]);
  const out2 = await run(s2, code(U1), both, fakeFetch(portalOk("selfie", { results: [{ identifier: "proof_of_human", success: false }, { identifier: "selfie", success: true }] })));
  assert.deepEqual([out2.status, out2.body.level], [200, "selfie"]);
  assert.ok(s2.byNullifier.has(`1|${DEFAULT_ACTION}`));
});

test("one World ID = one account: a nullifier already used by another account is refused, and freed on delete", async () => {
  const store = fakeStore();
  assert.equal((await run(store, code(U1), idkitResult([orbItem(U1)]), fakeFetch(portalOk()))).status, 200);
  const dup = await run(store, code(U2), idkitResult([orbItem(U2)]), fakeFetch(portalOk()));
  assert.equal(dup.status, 409);
  assert.deepEqual([dup.body.ok, dup.body.error, dup.body.message], [false, "world_id_in_use", DUPLICATE_MESSAGE]);
  assert.equal(store.users.get(U2), null);
  // Same World ID via Selfie Check (same nullifier for this action) is refused too.
  assert.equal((await run(store, code(U2, 1), idkitResult([selfieItem(U2)]), fakeFetch(portalOk("selfie")))).status, 409);
  store.deleteUser(U1); // ON DELETE CASCADE frees it
  assert.equal((await run(store, code(U2, 2), idkitResult([orbItem(U2)]), fakeFetch(portalOk()))).status, 200);
});

test("environment mismatch is refused before (nothing sent) and after verification", async () => {
  const store = fakeStore();
  const f = fakeFetch(portalOk());
  const before = await run(store, code(U1), idkitResult([orbItem(U1)], { environment: "staging" }), f);
  assert.deepEqual([before.status, before.body.error], [400, "invalid_proof"]);
  assert.equal(f.calls.length, 0);
  const after = await run(store, code(U1), idkitResult([orbItem(U1)]), fakeFetch(portalOk("proof_of_human", { environment: "staging" })));
  assert.deepEqual([after.status, after.body.error], [400, "not_verified"]);
  assert.equal(store.users.get(U1), null);
  const missing = await run(store, code(U1, 1), idkitResult([orbItem(U1)]), fakeFetch(portalOk("proof_of_human", { environment: undefined })));
  assert.equal(missing.status, 400);
});

test("portal refusal, unknown credentials, legacy/session proofs and someone else's proof are refused", async () => {
  const s = fakeStore();
  const f = fakeFetch(portalFail, 400);
  assert.deepEqual((await run(s, code(U1), idkitResult([orbItem(U1)]), f)).body.error, "not_verified");
  const never = fakeFetch(portalOk());
  const refused = [
    idkitResult([orbItem(U1, { identifier: "passport", issuer_schema_id: 9303 })]),
    idkitResult([orbItem(U1, { issuer_schema_id: 9303 })]),
    idkitResult([orbItem(U1)], { protocol_version: "3.0" }),
    idkitResult([{ identifier: "orb", signal_hash: hashSignal(signalFor(U1)), proof: "0x1a", merkle_root: "0x0a", nullifier: NULLIFIER }], { protocol_version: "3.0" }),
    idkitResult([orbItem(U1)], { session_id: "session_ab" }),
    idkitResult([orbItem(U1)], { action: "another-action" }),
    idkitResult([orbItem(U2)]), // a proof bound to another account
    idkitResult([orbItem(U1, { signal_hash: "0x0" })]),
    idkitResult([orbItem(U1, { nullifier: "not-hex" })]),
    idkitResult([]),
    null,
  ];
  for (const r of refused) assert.equal((await run(fakeStore(), code(U1), r, never)).status, 400, JSON.stringify(r));
  assert.equal(never.calls.length, 0);
});

test("expired, forged and reused verify links are refused", async () => {
  const store = fakeStore();
  const { code: c, expiresAt } = mintCode(C, U1, 0, NOW);
  const expired = await completeVerification(C, store, c, idkitResult([orbItem(U1)]), { now: expiresAt, fetchImpl: fakeFetch(portalOk()) });
  assert.deepEqual([expired.status, expired.body.error], [410, "link_expired"]);
  assert.deepEqual((await run(store, "A".repeat(44), idkitResult([orbItem(U1)]), fakeFetch(portalOk()))).body.error, "invalid_link");
  // First use fails at the portal (link consumed); the same link cannot be used again.
  assert.equal((await run(store, c, idkitResult([orbItem(U1)]), fakeFetch(portalFail, 400))).status, 400);
  const again = await run(store, c, idkitResult([orbItem(U1)]), fakeFetch(portalOk()));
  assert.deepEqual([again.status, again.body.error], [410, "link_used"]);
  // A deleted account's link is dead.
  store.deleteUser(U2);
  assert.equal((await run(store, code(U2), idkitResult([orbItem(U2)]), fakeFetch(portalOk()))).body.error, "invalid_link");
});

test("an already verified account is told so without another proof", async () => {
  const store = fakeStore();
  store.users.set(U1, "orb");
  const f = fakeFetch(portalOk());
  const out = await run(store, code(U1), idkitResult([orbItem(U1)]), f);
  assert.deepEqual([out.status, out.body.ok], [200, true]);
  assert.equal(f.calls.length, 0);
});
