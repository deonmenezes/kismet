// Runs before every `npm run build` ("prebuild"): fails the build when the target database is missing a column the
// code needs, so new code is never deployed onto an unmigrated database (every sign-up and the pool would break at
// runtime). Fix: `npm run db:migrate` against that database, then build again. With no DATABASE_URL (CI, tests,
// a local build without .env.local) it skips: there is no target database to check.
import { pathToFileURL } from "node:url";

/** Columns the code reads and writes, added by db/schema.sql migrations (table, column, what added it). */
export const REQUIRED = [
  ["users", "is_demo", "demo isolation (lib/demo.ts)"],
  ["users", "edge_city", "Edge City only (lib/edge-city.ts)"],
  ["users", "edge_weeks", "Edge City only (lib/edge-city.ts)"],
  ["users", "edge_answered_at", "Edge City only (lib/edge-city.ts)"],
  ["reports", "reported_keys", "reports kept after deletion (lib/report-history.ts)"],
  ["reports", "reported_gone_at", "reports kept after deletion (lib/report-history.ts)"],
  ["reports", "reported_banned", "reports kept after deletion (lib/report-history.ts)"],
  ["reports", "reported_hidden", "reports kept after deletion (lib/report-history.ts)"],
  ["users", "history_reviewed_at", "reports kept after deletion (lib/report-history.ts)"],
  ["deletion_jobs", "next_at", "failed deletions retried (lib/deletion-jobs.ts)"],
  ["users", "contacts_checked_at", "the model contact check (lib/contact-check.ts)"],
  ["users", "contacts_input_hash", "the model contact check (lib/contact-check.ts)"],
  ["users", "contacts_check_attempts", "the model contact check (lib/contact-backfill.ts)"],
  ["agent_notes", "contacts_checked_at", "the model contact check (lib/contact-check.ts)"],
  ["agent_notes", "contacts_check_attempts", "the model contact check (lib/contact-backfill.ts)"],
];

/** The required columns that are not in the database. `query(text, params)` returns the rows. */
export async function missingColumns(query) {
  const rows = await query(
    "select table_name, column_name from information_schema.columns where table_schema = current_schema() and table_name = any($1::text[])",
    [[...new Set(REQUIRED.map(([t]) => t))]],
  );
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  return REQUIRED.filter(([t, c]) => !have.has(`${t}.${c}`));
}

/** The check: exit code and what to print. `connect(url)` gives a query function (Neon in the build). */
export async function run({ url, connect }) {
  if (!url) return { code: 0, message: "Schema check skipped: no DATABASE_URL (nothing to check against)." };
  let missing;
  try {
    missing = await missingColumns(await connect(url));
  } catch (e) {
    return { code: 1, message: `Schema check failed: could not read the database's columns (${e instanceof Error ? e.message : e}). Build stopped.` };
  }
  if (!missing.length) return { code: 0, message: `Schema check OK: ${REQUIRED.map(([t, c]) => `${t}.${c}`).join(", ")}.` };
  return {
    code: 1,
    message: [
      "Build stopped: the database is not migrated for this code. Missing:",
      ...missing.map(([t, c, why]) => `  - ${t}.${c} (${why})`),
      "Run `npm run db:migrate` with this DATABASE_URL first (db/schema.sql is idempotent and safe for the live code), then build again.",
    ].join("\n"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { code, message } = await run({
    // The database the app reads at runtime (lib/db.ts).
    url: process.env.DATABASE_URL,
    connect: async (url) => {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(url);
      return (text, params) => sql.query(text, params);
    },
  });
  (code ? console.error : console.log)(message);
  process.exit(code);
}
