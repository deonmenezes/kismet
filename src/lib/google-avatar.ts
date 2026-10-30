// The profile picture URL of a Google sign-in (Neon Auth keeps it), checked before anything is fetched.

/** A real Google sign-in avatar URL (https://lh3-6.googleusercontent.com/a/..., no credentials or port), at 400 px. */
export function googleAvatar(raw: unknown) {
  try {
    const u = new URL(typeof raw === "string" ? raw : "");
    if (u.protocol !== "https:" || !/^lh[3-6]\.googleusercontent\.com$/.test(u.hostname) || u.username || u.password || u.port || !u.pathname.startsWith("/a/")) return null;
    return u.href.replace(/=s\d+(-c)?$/, "=s400-c");
  } catch {
    return null;
  }
}
