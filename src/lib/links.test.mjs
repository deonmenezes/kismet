// Run: npm test. "Text Kismet on WhatsApp" links (lib/text/links.ts): only for a public, production number (QA2: the
// buttons pointed at Meta's test number, which answers 5 verified recipients at most).
import { test } from "node:test";
import assert from "node:assert/strict";
import { textLinks, whatsappPublic } from "./text/links.ts";

test("WhatsApp links: none unless KISMET_WHATSAPP_PUBLIC=1 (the test number stays private); then the wa.me link", () => {
  const none = { whatsappNumber: null, whatsappUrl: null };
  assert.deepEqual(textLinks("Hi", { KISMET_WHATSAPP_NUMBER: "+1 555 143 7970" }), none, "the test number, not public");
  assert.deepEqual(textLinks("Hi", { KISMET_WHATSAPP_NUMBER: "+15551437970", KISMET_WHATSAPP_PUBLIC: "0" }), none);
  assert.deepEqual(textLinks("Hi", { KISMET_WHATSAPP_PUBLIC: "1" }), none, "no number");
  assert.deepEqual(textLinks("Hi Kismet", { KISMET_WHATSAPP_NUMBER: "+91 98765 43210", KISMET_WHATSAPP_PUBLIC: "1" }),
    { whatsappNumber: "+919876543210", whatsappUrl: "https://wa.me/919876543210?text=Hi%20Kismet" });
  assert.equal(whatsappPublic({ KISMET_WHATSAPP_PUBLIC: "true" }), true);
  assert.equal(whatsappPublic({}), false);
});
