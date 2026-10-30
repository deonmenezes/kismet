// Run: npm test. QA3 N3-L1: every icon a browser may pick is the 28 Oct brand (an ink Fraunces Italic "K" on flat coral):
// the SVG favicon Chromium, Edge and Firefox prefer, the 48 px PNG, the apple icon, the install icons and /favicon.ico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const CORAL = [0xed, 0x6b, 0x83];
const OLD = ["#1E1530\"/><g", "#A86FF7", "#FBE5F5", "mask"]; // the 19 Oct tile, sparkle, heart and its masks

test("icon.svg is the coral tile with the ink K, nothing of the old heart mark", () => {
  const svg = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
  assert.match(svg, /<rect width="64" height="64" fill="#ED6B83"\/>/);
  assert.match(svg, /<path fill="#1E1530" [^>]*d="M/);
  for (const s of OLD) assert.ok(!svg.includes(s), s);
  assert.ok(!/<(?:script|image|foreignObject|use)\b/.test(svg) && !/href=/.test(svg), "self-contained, nothing loaded");
});

/** The colour of a PNG's top-left pixel (8-bit RGB or RGBA; on the first row every filter stores the first pixel as is). */
function cornerOfPng(buf) {
  assert.equal(buf.subarray(1, 4).toString(), "PNG");
  let at = 8;
  const idat = [];
  let colorType = 0;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString();
    if (type === "IHDR") colorType = buf[at + 8 + 9];
    if (type === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  assert.ok([2, 6].includes(colorType), `color type ${colorType}`);
  return [raw[1], raw[2], raw[3]];
}

test("the PNG icons and every /favicon.ico size start coral (none is the dark 19 Oct tile)", () => {
  for (const f of ["../app/icon1.png", "../app/apple-icon.png", "../../public/icon-192.png", "../../public/icon-512.png"]) {
    assert.deepEqual(cornerOfPng(readFileSync(new URL(f, import.meta.url))), CORAL, f);
  }
  const ico = readFileSync(new URL("../../public/favicon.ico", import.meta.url));
  const n = ico.readUInt16LE(4);
  assert.ok(n >= 3);
  for (let k = 0; k < n; k++) {
    const size = ico.readUInt32LE(6 + 16 * k + 8);
    const offset = ico.readUInt32LE(6 + 16 * k + 12);
    const img = ico.subarray(offset, offset + size);
    if (img.subarray(1, 4).toString() === "PNG") assert.deepEqual(cornerOfPng(img), CORAL);
    else {
      // BMP entry: BGRA rows bottom-up; the top-left pixel is the first of the last row.
      const w = img.readInt32LE(4), h = img.readInt32LE(8) / 2, bpp = img.readUInt16LE(14);
      assert.equal(bpp, 32);
      const px = 40 + (h - 1) * w * 4;
      assert.deepEqual([img[px + 2], img[px + 1], img[px]], CORAL, `ico ${w}x${h}`);
    }
  }
});
