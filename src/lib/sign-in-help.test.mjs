// Run: npm test. The sign-in popup's helpers: in-app browsers, Google's error codes, typed and pasted codes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCodeInput, attempt, backspaceCode, codeErrorMessage, googleErrorMessage, inAppBrowser, openInBrowserHint, openInBrowserUrl, pasteCode, safeNext, signInAsPage, tooManyTries } from "./sign-in-help.ts";

const UA = {
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  firefoxIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  igIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 400.0.0.32.110 (iPhone15,2; iOS 18_6; en_US; en; scale=3.00; 1179x2556; 712345678)",
  igAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 356.0.0.41.101 Android (34/14; 480dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; en_IN; 655111111)",
  fbIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.38.105;FBBV/700000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  fbAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.53.109;]",
  messenger: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0.0.40.109;FBBV/650000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6]",
  linkedin: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1234",
  tiktok: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_37.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/IN BytedanceWebview/d8a21c6",
  threads: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 360.0.0.21.106 (iPhone15,2; iOS 18_6; en_US; en; scale=3.00; 1179x2556; 680000000)",
  snapchat: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.60.0.43 (like Safari/8618.1.15.10.15, panda)",
  wkwebview: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidWebview: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36",
};

test("in-app browsers: known apps by name, on iOS and Android", () => {
  assert.deepEqual(inAppBrowser(UA.igIos), { app: "Instagram", platform: "ios" });
  assert.deepEqual(inAppBrowser(UA.igAndroid), { app: "Instagram", platform: "android" });
  assert.equal(inAppBrowser(UA.fbIos)?.app, "Facebook");
  assert.equal(inAppBrowser(UA.fbAndroid)?.app, "Facebook");
  assert.equal(inAppBrowser(UA.messenger)?.app, "Messenger");
  assert.equal(inAppBrowser(UA.linkedin)?.app, "LinkedIn");
  assert.equal(inAppBrowser(UA.tiktok)?.app, "TikTok");
  assert.equal(inAppBrowser(UA.threads)?.app, "Threads");
  assert.equal(inAppBrowser(UA.snapchat)?.app, "Snapchat");
});

test("in-app browsers: an unnamed webview is reported without a name", () => {
  assert.deepEqual(inAppBrowser(UA.wkwebview), { app: null, platform: "ios" });
  assert.deepEqual(inAppBrowser(UA.androidWebview), { app: null, platform: "android" });
});

test("in-app browsers: real browsers and home-screen apps are left alone", () => {
  for (const k of ["safari", "chromeIos", "firefoxIos", "chromeAndroid", "samsung", "desktop", "macSafari"]) assert.equal(inAppBrowser(UA[k]), null, k);
  assert.equal(inAppBrowser(UA.wkwebview, true), null, "iOS home-screen web app");
  assert.equal(inAppBrowser(""), null);
});

test("in-app browsers: a way out to Chrome on Android only, and a hint for both", () => {
  const ig = inAppBrowser(UA.igAndroid);
  const out = openInBrowserUrl("https://kismet-village.vercel.app/sign-in?x=1", ig);
  assert.match(out, /^intent:\/\/kismet-village\.vercel\.app\/sign-in\?x=1#Intent;scheme=https;package=com\.android\.chrome;/);
  assert.match(out, /S\.browser_fallback_url=https%3A%2F%2Fkismet-village/);
  assert.equal(openInBrowserUrl("https://kismet-village.vercel.app/", inAppBrowser(UA.igIos)), null);
  assert.equal(openInBrowserUrl("javascript:alert(1)", ig), null);
  assert.equal(openInBrowserUrl("not a url", ig), null);
  assert.match(openInBrowserHint(inAppBrowser(UA.igIos)), /Instagram.*Open in Safari/);
  assert.match(openInBrowserHint(ig), /⋮ in Instagram.*Open in Chrome/);
  assert.match(openInBrowserHint(inAppBrowser(UA.wkwebview)), /this app/);
});

test("Google errors: state problems, cancel, unlinked account, anything else, nothing", () => {
  assert.equal(googleErrorMessage(undefined), null);
  assert.equal(googleErrorMessage([]), null);
  for (const c of ["state_mismatch", "state_security_mismatch", "state_invalid", "please_restart_the_process", "STATE_NOT_FOUND"]) {
    assert.match(googleErrorMessage(["google", c]), /interrupted/, c);
  }
  assert.match(googleErrorMessage(["google", "access_denied"]), /cancelled/);
  assert.match(googleErrorMessage(["google", "account_not_linked"]), /email code/);
  assert.match(googleErrorMessage(["google", "invalid_code"]), /didn't finish/);
  assert.match(googleErrorMessage("google"), /didn't finish/);
  assert.match(googleErrorMessage("anything"), /didn't finish/);
});

const boxes = (v) => v.padEnd(6, "_").split("").map((c) => (c === "_" ? "" : c));
const shown = (e) => (e ? `${e.digits.map((d) => d || "_").join("")} focus ${e.focus}${e.complete ? " done" : ""}` : "ignored");

test("code boxes: typing moves on, the last digit completes", () => {
  assert.equal(shown(applyCodeInput(boxes(""), 0, "4", "")), "4_____ focus 1");
  assert.equal(shown(applyCodeInput(boxes("48291"), 5, "3", "")), "482913 focus 5 done");
});

test("code boxes: typing into a filled box replaces its digit, before or after the caret", () => {
  assert.equal(shown(applyCodeInput(boxes("123"), 1, "29", "2")), "193___ focus 3");
  assert.equal(shown(applyCodeInput(boxes("123"), 1, "92", "2")), "193___ focus 3");
  assert.equal(shown(applyCodeInput(boxes("3"), 0, "312", "3")), "12____ focus 2", "312 over a filled 3");
});

test("code boxes: a keyboard suggestion or autofill of the whole code fills every box", () => {
  assert.equal(shown(applyCodeInput(boxes("7"), 0, "7123456", "7")), "123456 focus 5 done", "Gboard's 123456 added to a filled box");
  assert.equal(shown(applyCodeInput(boxes(""), 0, "482913", "")), "482913 focus 5 done", "iOS one-time-code autofill");
  assert.equal(shown(applyCodeInput(boxes("12"), 2, "99482913", "")), "482913 focus 5 done", "more than 6 digits: the last 6");
});

test("code boxes: no digit in the input is ignored, an emptied box is cleared", () => {
  assert.equal(shown(applyCodeInput(boxes("123"), 1, "a", "2")), "ignored", "a letter over a selected digit");
  assert.equal(shown(applyCodeInput(boxes("123"), 1, " ", "2")), "ignored");
  assert.equal(shown(applyCodeInput(boxes("123"), 1, "", "2")), "1_3___ focus 1");
});

test("code boxes: paste finds the code in a sentence, or fills from the box", () => {
  assert.equal(shown(pasteCode(boxes(""), 3, "Your Kismet code is 482913. It expires in 10 minutes.")), "482913 focus 5 done");
  assert.equal(shown(pasteCode(boxes(""), 0, "482 913")), "482913 focus 5 done");
  assert.equal(shown(pasteCode(boxes("1"), 1, "23")), "123___ focus 3");
  assert.equal(shown(pasteCode(boxes(""), 0, "no digits")), "ignored");
});

test("code boxes: backspace in an empty box clears the one before", () => {
  assert.equal(shown(backspaceCode(boxes("123"), 3)), "12____ focus 2");
  assert.equal(shown(backspaceCode(boxes("123"), 2)), "ignored", "the box has a digit: the browser deletes it");
  assert.equal(shown(backspaceCode(boxes(""), 0)), "ignored");
});

test("auth calls: a returned error, a thrown one, a network failure and success all come back the same way", async () => {
  assert.equal(await attempt(async () => ({ data: { ok: true }, error: null })), null);
  assert.equal(await attempt(async () => undefined), null);
  assert.deepEqual(await attempt(async () => ({ error: { status: 429 } })), { status: 429 });
  const thrown = Object.assign(new Error("Invalid OTP"), { status: 400, code: "validation_failed" });
  assert.equal(await attempt(async () => { throw thrown; }), thrown);
  assert.deepEqual(await attempt(async () => { throw "offline"; }), {});
});

test("code errors: too many tries (by code or by message), busy, anything else", () => {
  assert.equal(tooManyTries({ code: "TOO_MANY_ATTEMPTS" }), true);
  assert.equal(tooManyTries({ status: 400, message: "Invalid OTP" }), false);
  assert.match(codeErrorMessage({ code: "TOO_MANY_ATTEMPTS" }), /Too many tries/);
  assert.match(codeErrorMessage({ status: 403, code: "feature_not_supported", message: "Too many attempts" }), /Too many tries/);
  assert.match(codeErrorMessage({ status: 429 }), /Lots of people/);
  assert.match(codeErrorMessage({ status: 400, message: "Invalid OTP" }), /didn't work/);
  assert.match(codeErrorMessage({}), /didn't work/);
});

test("sign-in opens as a page on phones and every iOS / iPadOS browser, as a popup on a desktop-wide screen", () => {
  // Phone-sized: always the page, whatever the browser.
  for (const ua of [UA.safari, UA.chromeIos, UA.chromeAndroid, UA.samsung, UA.igAndroid, UA.desktop]) {
    assert.equal(signInAsPage(ua, 390), true);
    assert.equal(signInAsPage(ua, 767), true);
  }
  // iOS at any width (an iPhone in landscape, an iPad): the page; so is iPadOS asking for the desktop site (a touch Mac).
  assert.equal(signInAsPage(UA.safari, 932), true);
  assert.equal(signInAsPage(UA.chromeIos, 1024, 5), true);
  assert.equal(signInAsPage(UA.macSafari, 1024, 5), true);
  // A real desktop or laptop: the popup.
  assert.equal(signInAsPage(UA.macSafari, 1280, 0), false);
  assert.equal(signInAsPage(UA.desktop, 768), false);
  assert.equal(signInAsPage(UA.desktop, 1280, 10), false); // a Windows touch laptop
});

test("safeNext keeps a signed-in page of this site and nothing else", () => {
  for (const ok of ["/chat", "/home", "/edit", "/chat/abc-123", "/chat/abc_123?x=1", "/edit?tab=photos#top", "/home#photos"]) assert.equal(safeNext(ok), ok);
  for (const bad of [undefined, null, "", ["/home"], 42, "home", "//evil.example", "/\\evil.example", "/\\/evil", "https://evil.example/",
    "javascript:alert(1)", "/home\nx", "/chat\u0000", "/chat/" + "a".repeat(600), "/chat/a/b", "/chat/..%2f", "/homepage", "/edit-x",
    "/HOME", "/u/abcdefghijklmnopqrstuvwxyz", "/api/signout", "/", "/join"]) {
    assert.equal(safeNext(bad), "/chat", JSON.stringify(bad));
  }
  // Never back to a sign-in page (signed in, it would send on to `next` again).
  for (const loop of ["/sign-in", "/sign-in?next=/home", "/auth/done", "/auth/done?next=/home"]) assert.equal(safeNext(loop), "/chat", loop);
  assert.equal(safeNext("//x", "/"), "/");
});

test("QA7: on a short phone (360x640) with their words quoted, the email button still fits: smaller head, two-line quote", () => {
  // Measured in Chromium and WebKit at 360x640, 375x667 and 390x664: the button ended at 644 of 640, now 618 (any quote).
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const short = /@media \(max-width: 639px\) and \(max-height: 700px\) \{([^@]*?)\n\}/.exec(css);
  assert.ok(short, "the short-phone block for the sign-in page");
  for (const rule of [".k-signin-page .k-mark {", ".k-signin-page .k-head {", ".k-signin-page .k-quote {", ".k-signin-page .k-quote blockquote {"]) assert.ok(short[1].includes(rule), rule);
  assert.match(short[1], /-webkit-line-clamp: 2;/);
  // Only the page: the desktop popup (k-sheet) keeps its own layout.
  assert.doesNotMatch(short[1], /^\s*\.k-(?!signin-page)/m);
});
