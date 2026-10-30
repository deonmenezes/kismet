// Run: npm test. Rate-limit keys: networks and email inboxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalEmail, expandV6, networkOf } from "./net.ts";

test("networks: IPv6 by /64 in any notation, IPv4 per address in any notation", () => {
  const same = ["2001:db8::a:b:c:d", "2001:0DB8:0000:0000:ffff:1:2:3", "2001:db8:0:0:1::", "2001:db8::%eth0"].map(networkOf);
  assert.deepEqual(new Set(same), new Set(["2001:0db8:0000:0000"]));
  assert.notEqual(networkOf("2001:db8:0:1::5"), same[0]);
  assert.equal(networkOf("1.2.3.4"), "1.2.3.4");
  assert.equal(networkOf("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(networkOf("::ffff:102:304"), "1.2.3.4");
  assert.equal(networkOf("0:0:0:0:0:ffff:0102:0304"), "1.2.3.4");
  assert.notEqual(networkOf("::ffff:1.2.3.5"), networkOf("::ffff:1.2.3.4"));
  assert.equal(expandV6("::1").join(":"), "0000:0000:0000:0000:0000:0000:0000:0001");
});

test("emails: one key per inbox (+tags, Gmail dots and googlemail.com)", () => {
  assert.equal(canonicalEmail("Victim+1@Gmail.com"), "victim@gmail.com");
  assert.equal(canonicalEmail("v.ic.tim@googlemail.com"), "victim@gmail.com");
  assert.equal(canonicalEmail("first.last+x@example.com"), "first.last@example.com"); // dots matter elsewhere
});
