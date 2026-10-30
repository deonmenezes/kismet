import type { NextConfig } from "next";
import { NON_PAGE_CSP, NON_PAGE_SOURCES } from "./src/lib/csp";

// Security headers on every response. No framing (clickjacking), no full URLs in Referer (private links, verify
// codes), the microphone only for our own chat (dictation), nothing else from the device.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** The old name (QA2 S-7: it served pages, privacy included, on its own). Its pages go to the canonical address. */
const OLD_HOST = "agent-dates.vercel.app";
const CANONICAL = "https://kismet-village.vercel.app";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    // Pages only: the API, the MCP server, the scripts agents read and Next's own files keep answering on the old host
    // (agents and app builds saved it), with no redirect a POST might not follow.
    return [{
      source: "/:path((?!api/|mcp$|llms\\.txt$|llms-full\\.txt$|_next/|\\.well-known/).*)",
      has: [{ type: "host", value: OLD_HOST }],
      destination: `${CANONICAL}/:path`,
      permanent: true,
    }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Content-Security-Policy: pages get theirs, with a nonce, from the proxy (src/proxy.ts, lib/csp.ts); the routes that
      // are not pages (the API, MCP, llms.txt, icons) get one that runs nothing. Never both on one path: no response
      // carries two policies (the browser would enforce both).
      ...NON_PAGE_SOURCES.map((source) => ({ source, headers: [{ key: "Content-Security-Policy", value: NON_PAGE_CSP }] })),
      // Pages whose URL holds a secret never send it anywhere.
      { source: "/u/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/verify/:code", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/waitlist/remove", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/app/waitlist/remove", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
