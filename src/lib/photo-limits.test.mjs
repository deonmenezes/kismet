// Run: npm test. Photo size limits under Vercel's 4.5 MB request cap (QA5 Q5-L3): 4 MB of image as multipart, 3 MB as
// base64 JSON, each answered with the app's own JSON 413 above it, on a real Postgres (PGlite, in memory); and the web
// client's shrink step (lib/photo-shrink.ts), whose pure parts run here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

await freshDb();
const L = await import("./photo-limits.ts");
const { fromBase64, PhotoError, toCleanJpeg } = await import("./photo-image.ts");
const { insertUser } = await import("./actions.ts");
const { parseProfile } = await import("./validate.ts");
const { POST } = await import("../app/api/me/photo/route.ts");
const { fitWithin, needsShrink, shrinkPhoto, ATTEMPTS, SHRINK_ABOVE_BYTES } = await import("./photo-shrink.ts");

const MB = 1024 * 1024;
const me = await insertUser(parseProfile({ name: "Ana", telegram: "ana_tg", lookingFor: ["friends"], interests: ["AI"], edgeCity: true }).profile, { channel: "web", client: "" });
const upload = (body, headers = {}) => POST(new Request("https://kismet.test/api/me/photo", { method: "POST", headers: { authorization: `Bearer ${me.token}`, ...headers }, body }));
const multipart = (bytes) => {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "p.jpg");
  return form;
};
const b64 = (n) => Buffer.from(new Uint8Array(n)).toString("base64");

test("every limit stays under Vercel's 4.5 MB request cap: 4 MB multipart, 3 MB base64 JSON", () => {
  assert.equal(L.PHOTO_MAX_BYTES, 4 * MB);
  assert.equal(L.PHOTO_MAX_BASE64_BYTES, 3 * MB);
  assert.ok(L.PHOTO_MAX_MULTIPART_BODY < L.PLATFORM_MAX_BODY && L.PHOTO_MAX_JSON_BODY < L.PLATFORM_MAX_BODY);
  // A 3 MB image as a data URL in JSON is still under the cap.
  assert.ok(JSON.stringify({ image: `data:image/jpeg;base64,${b64(3 * MB)}` }).length < L.PLATFORM_MAX_BODY);
});

test("toCleanJpeg and fromBase64 refuse more than the limits with a 413", async () => {
  await assert.rejects(toCleanJpeg(new Uint8Array(4 * MB + 1), 512), (e) => e instanceof PhotoError && e.status === 413 && /4 MB/.test(e.message));
  await assert.rejects(toCleanJpeg(new Uint8Array(4 * MB), 512), (e) => e instanceof PhotoError && e.status === 415); // the size is fine
  assert.equal(fromBase64(b64(3 * MB)).byteLength, 3 * MB);
  assert.throws(() => fromBase64(`data:image/png;base64,${b64(3 * MB + 1)}`), (e) => e instanceof PhotoError && e.status === 413 && /3 MB/.test(e.message));
  assert.equal(fromBase64("@@@"), null);
});

test("the route answers its own JSON 413 over the limits, and lets a photo at the limit through to the image check", async () => {
  for (const [res, re] of [
    [await upload("x", { "content-type": "multipart/form-data; boundary=x", "content-length": String(L.PHOTO_MAX_MULTIPART_BODY + 1) }), /4 MB/],
    [await upload("{}", { "content-type": "application/json", "content-length": String(L.PHOTO_MAX_JSON_BODY + 1) }), /3 MB/],
    [await upload(multipart(new Uint8Array(4 * MB + 1))), /4 MB/],
    [await upload(JSON.stringify({ image: b64(3 * MB + 3) }), { "content-type": "application/json" }), /3 MB/],
  ]) {
    assert.equal(res.status, 413);
    assert.match((await res.json()).error, re);
  }
  // At the limits: past the size checks to the image check (zeros are no image: 415).
  assert.equal((await upload(multipart(new Uint8Array(4 * MB)))).status, 415);
  assert.equal((await upload(JSON.stringify({ image: b64(3 * MB) }), { "content-type": "application/json" })).status, 415);
  // MIME base64 (a line break every 76 characters) of a 3 MB image: a bigger body, still under the cap, still taken.
  const wrapped = JSON.stringify({ image: b64(3 * MB).replace(/.{76}/g, "$&\n") });
  assert.ok(wrapped.length > L.PHOTO_MAX_BASE64_CHARS + 4096 && wrapped.length <= L.PHOTO_MAX_JSON_BODY);
  assert.equal((await upload(wrapped, { "content-type": "application/json", "content-length": String(wrapped.length) })).status, 415);
});

test("web client: big or HEIC photos are redrawn smaller, small ones go as picked, never enlarged", async () => {
  assert.deepEqual(fitWithin(4032, 3024, 2048), { width: 2048, height: 1536 });
  assert.deepEqual(fitWithin(3024, 4032, 2048), { width: 1536, height: 2048 });
  assert.deepEqual(fitWithin(800, 600, 2048), { width: 800, height: 600 });
  assert.ok(needsShrink(8 * MB, "image/jpeg") && needsShrink(500_000, "image/heic") && !needsShrink(SHRINK_ABOVE_BYTES, "image/png"));
  assert.ok(ATTEMPTS.every(([px]) => px >= 1024)); // the server still resizes to 1024 px
  const small = new File([new Uint8Array(1000)], "s.jpg", { type: "image/jpeg" });
  assert.equal(await shrinkPhoto(small), small);
  // Where nothing can draw it (no canvas here, like an HEIC outside Safari): the file if the server takes it, else null.
  const mid = new File([new Uint8Array(3 * MB)], "m.heic", { type: "image/heic" });
  assert.equal(await shrinkPhoto(mid), mid);
  assert.equal(await shrinkPhoto(new File([new Uint8Array(4 * MB + 1)], "b.jpg", { type: "image/jpeg" })), null);
});
