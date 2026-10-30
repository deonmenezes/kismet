// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isVillageOp, parseSubject, parseVillageRequest, partnerAuth, residentKey, withSubject } from "./village.ts";

const KEY = "k".repeat(20) + "Z9-_".repeat(11); // 64 chars, like a base64url 48-byte key

test("partner auth: no usable key configured disables the API", () => {
  assert.equal(partnerAuth(`Bearer ${KEY}`, undefined), "disabled");
  assert.equal(partnerAuth(`Bearer ${KEY}`, ""), "disabled");
  assert.equal(partnerAuth("Bearer short", "short"), "disabled");
});

test("partner auth: only the exact bearer is accepted", () => {
  assert.equal(partnerAuth(`Bearer ${KEY}`, KEY), "ok");
  assert.equal(partnerAuth(`bearer ${KEY}`, KEY), "ok");
  for (const header of [null, "", KEY, `Basic ${KEY}`, `Bearer ${KEY.slice(0, -1)}`, `Bearer ${KEY}x`, `Bearer  ${KEY}`, `Bearer ${KEY} `,
    `Bearer ${KEY.toUpperCase()}`, "Bearer ", `Bearer ${"a".repeat(600)}`]) {
    assert.equal(partnerAuth(header, KEY), "denied", String(header));
  }
});

test("operations are a closed list", () => {
  for (const op of ["signup", "summary", "go", "decide", "delete", "verify-link"]) assert.ok(isVillageOp(op));
  assert.deepEqual(parseVillageRequest("verify-link", { residentId: "r" }), { op: "verify-link", residentId: "r" });
  assert.ok("error" in parseVillageRequest("verify-link", { residentId: "r", userId: "x" }));
  for (const op of ["publish", "me", "", "Signup", "toString", "__proto__"]) assert.ok(!isVillageOp(op));
});

test("residentId: opaque, bounded, stored only as a hash", () => {
  assert.equal(residentKey("r1"), residentKey("r1"));
  assert.notEqual(residentKey("r1"), residentKey("r2"));
  assert.match(residentKey("r1"), /^[0-9a-f]{64}$/);
  assert.ok(!residentKey("VERIFY-1").includes("VERIFY"));
  for (const residentId of ["VERIFY-a1", "tg:12345", "5f0c7e2a-1b9e-4c55-9a8e-0d1f2a3b4c5d", "a".repeat(128)]) {
    assert.deepEqual(parseVillageRequest("summary", { residentId }), { op: "summary", residentId });
  }
  for (const residentId of ["", "-x", "a b", "a/b", "a".repeat(129), 5, null, ["x"]]) {
    assert.ok("error" in parseVillageRequest("summary", { residentId }), JSON.stringify(residentId));
  }
});

test("each operation takes exactly its fields", () => {
  const dateId = "5f0c7e2a-1b9e-4c55-9a8e-0d1f2a3b4c5d";
  assert.deepEqual(parseVillageRequest("decide", { residentId: "r", dateId, decision: "meet" }), { op: "decide", residentId: "r", dateId, decision: "meet" });
  assert.deepEqual(parseVillageRequest("go", { residentId: "r", targetId: dateId }), { op: "go", residentId: "r", targetId: dateId });
  assert.deepEqual(parseVillageRequest("go", { residentId: "r" }), { op: "go", residentId: "r" });
  assert.deepEqual(parseVillageRequest("signup", { residentId: "r", answers: { name: "A" }, telegram: "deon_x" }), { op: "signup", residentId: "r", answers: { name: "A" }, telegram: "deon_x" });
  const refused = [
    ["summary", { residentId: "r", userId: "x" }], ["delete", { residentId: "r", all: true }], ["decide", { residentId: "r", dateId, decision: "yes" }],
    ["decide", { residentId: "r", dateId: "../x", decision: "meet" }], ["decide", { residentId: "r", decision: "meet" }],
    ["go", { residentId: "r", targetId: "not-a-uuid" }], ["signup", { residentId: "r" }], ["signup", { residentId: "r", answers: [] }],
    ["signup", { residentId: "r", answers: {}, telegram: 5 }], ["summary", []], ["summary", null], ["summary", "r"],
  ];
  for (const [op, body] of refused) assert.ok("error" in parseVillageRequest(op, body), `${op} ${JSON.stringify(body)}`);
});

test("X-Village-Subject: same rule as residentId; absent is null", () => {
  assert.equal(parseSubject(null), null);
  for (const id of ["VERIFY-a1", "tg:12345", "5f0c7e2a-1b9e-4c55-9a8e-0d1f2a3b4c5d", "a".repeat(128)]) assert.deepEqual(parseSubject(id), { subject: id });
  for (const id of ["", " r", "-x", "a b", "a/b", "a".repeat(129)]) assert.match(parseSubject(id).error, /^X-Village-Subject must be/, JSON.stringify(id));
});

test("X-Village-Subject becomes residentId; a different body residentId is a mismatch, never overridden", () => {
  assert.deepEqual(withSubject({}, "r1"), { body: { residentId: "r1" } });
  assert.deepEqual(withSubject({ residentId: "r1", decision: "meet" }, "r1"), { body: { residentId: "r1", decision: "meet" } });
  assert.deepEqual(withSubject({ residentId: null }, "r1"), { body: { residentId: "r1" } });
  assert.equal(withSubject({ residentId: "r2" }, "r1"), "mismatch");
  assert.equal(withSubject({ residentId: 5 }, "r1"), "mismatch");
  // Not an object: left for parseVillageRequest to refuse.
  for (const body of [null, [], "r1"]) assert.ok("error" in parseVillageRequest("summary", withSubject(body, "r1").body));
  // The header and the body give one request, so one hashed account.
  const dateId = "5f0c7e2a-1b9e-4c55-9a8e-0d1f2a3b4c5d";
  const viaHeader = parseVillageRequest("decide", withSubject({ dateId, decision: "pass" }, "r1").body);
  assert.deepEqual(viaHeader, parseVillageRequest("decide", { residentId: "r1", dateId, decision: "pass" }));
});
