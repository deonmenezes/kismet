// Pure helpers for rate-limit keys (no imports; unit-tested in net.test.mjs).

/** An IPv6 address written out in full: 8 groups of 4 lowercase hex digits (zone id dropped). */
export function expandV6(ip: string) {
  const [head, tail = ""] = ip.split("%")[0].split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  return [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b].map((x) => x.toLowerCase().padStart(4, "0"));
}

const V4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The network an address belongs to, for per-network limits: an IPv4 address itself (also when written as
 * IPv6, "::ffff:1.2.3.4" or "::ffff:102:304"); for IPv6, its /64 (anyone gets a whole /64).
 */
export function networkOf(ip: string) {
  if (V4.test(ip)) return ip;
  if (!ip.includes(":")) return ip;
  const mapped = (g: string[]) => g.slice(0, 5).every((x) => x === "0000") && g[5] === "ffff";
  // "::ffff:1.2.3.4": the dotted part stands for the last two groups.
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (dotted) return mapped(expandV6(`${dotted[1]}0:0`)) ? dotted[2] : expandV6(`${dotted[1]}0:0`).slice(0, 4).join(":");
  const g = expandV6(ip);
  if (mapped(g)) {
    const n = ((parseInt(g[6], 16) << 16) | parseInt(g[7], 16)) >>> 0;
    return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
  }
  return g.slice(0, 4).join(":");
}

/** One inbox, one key: lowercase, "+tag" dropped, and Gmail's dots ignored. */
export function canonicalEmail(email: string) {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  return `${/^(gmail|googlemail)\.com$/.test(domain) ? base.replaceAll(".", "") : base}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}
