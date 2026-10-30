// Runs the real server modules against PGlite (an in-memory Postgres) with db/schema.sql applied, exactly as
// scripts/migrate.mjs applies it. Import this first; then import the modules under test dynamically.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

register("./pg-hooks.mjs", import.meta.url);
process.env.DATABASE_URL ??= "postgres://pglite/test";
// The model contact check (lib/contact-check.ts) never calls a real model in tests: by default it is "down", so a write
// keeps the regex-scrubbed text and is saved unchecked. A test sets its own mock to play the model.
globalThis.__kismetContactModel ??= async () => { throw new Error("no model in tests"); };

/** The statements of db/schema.sql, split like scripts/migrate.mjs. */
export const schemaStatements = () => readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8")
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

/** Applies the whole schema (a fresh database, or the migration on an existing one). */
export async function migrate(pg) {
  for (const s of schemaStatements()) await pg.query(s);
}

export async function freshDb() {
  const pg = new PGlite();
  await migrate(pg);
  globalThis.__kismetPg = pg;
  return pg;
}
