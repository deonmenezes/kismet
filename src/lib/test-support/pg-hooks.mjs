// Module hooks for tests that run the real server modules against PGlite (an in-memory Postgres): "@/..." and
// extensionless relative imports resolve to the .ts files, and the Next.js / Neon packages become small stubs.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../../", import.meta.url);
const STUB = new URL("./stubs/", import.meta.url);
const STUBS = {
  "next/server": "next-server.mjs",
  "next/headers": "next-headers.mjs",
  "@neondatabase/serverless": "neon.mjs",
  "@neondatabase/auth/next/server": "neon-auth.mjs",
  "@vercel/blob": "blob.mjs",
  "@daytonaio/sdk": "daytona.mjs",
};

const withExt = (url) => {
  const p = fileURLToPath(url);
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (existsSync(p + ext) && (ext || /\.[cm]?[jt]sx?$/.test(p))) return pathToFileURL(p + ext).href;
  return null;
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: new URL(STUBS[specifier], STUB).href, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const url = withExt(new URL(specifier.slice(2), SRC));
    if (url) return { url, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const url = withExt(new URL(specifier, context.parentURL));
    if (url) return { url, shortCircuit: true };
  }
  return next(specifier, context);
}
