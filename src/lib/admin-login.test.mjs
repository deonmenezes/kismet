// Run: npm test. POST /api/admin/login on a real Postgres (PGlite, in memory, for the rate limit): any body that is no
// form (JSON, plain text, a bare multipart header, nothing) goes back to /admin?e=key, never a 500 (QA5 Q5-L2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

await freshDb();
process.env.ADMIN_KEY = "k".repeat(32);
const { POST } = await import("../app/api/admin/login/route.ts");

let ip = 0;
const login = (body, type) => POST(new Request("https://kismet.test/api/admin/login", {
  method: "POST", headers: { "x-real-ip": `203.0.113.${++ip}`, ...(type ? { "content-type": type } : {}) }, body,
}));
const where = (res) => (res.headers.get("location") ? new URL(res.headers.get("location")).pathname + new URL(res.headers.get("location")).search : null);

test("a body that is no form answers 303 to /admin?e=key, not 500", async () => {
  for (const [body, type] of [[JSON.stringify({ key: process.env.ADMIN_KEY }), "application/json"], ["key=x", "text/plain"],
    ["", "multipart/form-data"], ["--x\r\nbroken", "multipart/form-data; boundary=x"], [undefined, undefined], ["%%%", "application/x-www-form-urlencoded; charset=nope"]]) {
    const res = await login(body, type);
    assert.equal(res.status, 303, `${type}: ${res.status}`);
    assert.equal(where(res), "/admin?e=key", type);
  }
});

test("the form still works: a wrong key gives ?e=key, the right one goes to /admin", async () => {
  assert.equal(where(await login(new URLSearchParams({ key: "wrong" }))), "/admin?e=key");
  const ok = await login(new URLSearchParams({ key: process.env.ADMIN_KEY }));
  assert.equal(ok.status, 303);
  assert.equal(where(ok), "/admin");
});
