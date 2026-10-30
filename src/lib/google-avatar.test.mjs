// Only a real Google avatar URL is ever fetched (the "Use your Google profile picture?" opt-in).
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleAvatar } from "./google-avatar.ts";

test("google avatar: real lh3-lh6 URLs only, asked at 400 px", () => {
  assert.equal(googleAvatar("https://lh3.googleusercontent.com/a/ACg8ocK=s96-c"), "https://lh3.googleusercontent.com/a/ACg8ocK=s400-c");
  assert.equal(googleAvatar("https://lh6.googleusercontent.com/a/xyz"), "https://lh6.googleusercontent.com/a/xyz");
  assert.equal(googleAvatar("https://lh3.googleusercontent.com/d/drive-file-id"), null); // Drive, Photos, Blogger: not an avatar
  for (const bad of [
    "http://lh3.googleusercontent.com/a/x", "https://lh9.googleusercontent.com/a/x", "https://lh3.googleusercontent.com.evil.com/a",
    "https://lh?.googleusercontent.com/a", "https://user:pw@lh3.googleusercontent.com/a", "https://lh3.googleusercontent.com:8443/a",
    "https://evil.com/lh3.googleusercontent.com", "javascript:alert(1)", "", null, undefined, 42,
  ]) assert.equal(googleAvatar(bad), null, String(bad));
});
