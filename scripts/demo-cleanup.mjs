// One-off: removes every date (recommendation, match, its chat) between a demo account and a real resident, made
// before demo accounts got their own pool (lib/demo.ts, users.is_demo). Dry run by default: prints what it would
// remove and changes nothing. Real residents are shown by a short id prefix only, never by name.
//   node --env-file-if-exists=.env.local scripts/demo-cleanup.mjs            dry run
//   node --env-file-if-exists=.env.local scripts/demo-cleanup.mjs --apply    deletes them
// Demo accounts: users.is_demo (db/schema.sql). Before that migration a dry run falls back to the migration's rule (exact
// handle and a "(demo)" name); --apply needs the migration first. Safe to run again: it only ever deletes dates that
// still cross the line, and a drop claim already released on one of them is kept ("had its drop"), as on account deletion.
import { pathToFileURL } from "node:url";

export const DEMO_HANDLES = ["kismet_review_demo", "maya_demo_kismet", "arjun_demo_kismet", "priya_demo_kismet", "leo_demo_kismet", "zara_demo_kismet"];

/** query(text, params) -> rows. Returns what it found (and, with apply, removed). */
export async function demoCleanup(query, { apply = false, log = console.log } = {}) {
  const flagged = (await query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'users' and column_name = 'is_demo'`, [])).length > 0;
  if (apply && !flagged) throw new Error("users.is_demo is missing: run the migration (npm run db:migrate) first.");
  // Is the user row `u` (or another alias) a demo account? $1 is always the handles (unused, but typed, once the column exists).
  const demo = (u) => (flagged ? `(${u}.is_demo and $1::text[] is not null)` : `(${u}.name like '% (demo)' and ${u}.telegram = any($1::text[]))`);
  const DEMO = demo("u");
  // A date whose two sides are on different sides of the demo line.
  const CROSS = `(select count(*) from users u where u.id in (d.a_id, d.b_id) and ${DEMO}) = 1`;
  log(flagged ? "Demo accounts by users.is_demo." : "users.is_demo is not there yet: demo accounts by handle and \"(demo)\" name.");
  const demos = await query(`select u.id, u.name, u.hidden_at, u.banned_at from users u where ${DEMO} order by u.name`, [DEMO_HANDLES]);
  log(`Demo accounts: ${demos.length ? demos.map((u) => `${u.name}${u.hidden_at ? " [HIDDEN]" : ""}${u.banned_at ? " [BANNED]" : ""}`).join(", ") : "none"}`);
  const rows = await query(`select d.id, d.status, d.matched_at, d.chat_closed_at, d.created_at,
      (select u.name from users u where u.id in (d.a_id, d.b_id) and ${DEMO} limit 1) as demo_name,
      (select left(u.id::text, 8) from users u where u.id in (d.a_id, d.b_id) and not ${DEMO} limit 1) as real_id,
      (select count(*)::int from messages m where m.date_id = d.id) as messages
    from dates d where ${CROSS} order by d.created_at`, [DEMO_HANDLES]);
  log(`Dates between a demo account and a real resident: ${rows.length}`);
  for (const r of rows) {
    const state = r.matched_at ? (r.chat_closed_at ? "match (closed)" : "MATCH") : r.status === "done" ? "recommendation/date" : r.status;
    log(`  ${r.id}  ${r.demo_name} <-> real ${r.real_id}…  ${state}, ${r.messages} message(s), created ${new Date(r.created_at).toISOString()}`);
  }
  const reports = await query(`select count(*)::int as n from reports r join users u on u.id = r.reported_id
    where ${DEMO} and r.reporter_id is not null and not exists (select 1 from users x where x.id = r.reporter_id and ${demo("x")})`, [DEMO_HANDLES]);
  log(`Reports by real residents against demo accounts (kept for review, never deleted here): ${reports[0].n}`);
  if (!apply) {
    log(rows.length ? "Dry run: nothing changed. Run again with --apply to delete these dates." : "Nothing to clean up.");
    return { found: rows.length, removed: 0, ids: rows.map((r) => r.id) };
  }
  if (!rows.length) return { found: 0, removed: 0, ids: [] };
  // Messages and unreleased drop claims go with the date; a released claim stays, as "had its drop" (date_id null).
  // Only on dates that still cross the line (the same check as the delete): a re-run after a crash finishes the job.
  await query(`update drop_claims p set date_id = null from dates d where p.date_id = d.id and d.id = any($2::uuid[]) and ${CROSS}
    and ((d.a_id = p.user_id and d.drop_a_at is not null) or (d.b_id = p.user_id and d.drop_b_at is not null))`, [DEMO_HANDLES, rows.map((r) => r.id)]);
  // Queued text notices about it are dropped too.
  const removed = (await query(`delete from dates d where d.id = any($2::uuid[]) and ${CROSS} returning d.id`, [DEMO_HANDLES, rows.map((r) => r.id)])).map((r) => r.id);
  if (removed.length) {
    await query(`update user_phones set notices = coalesce((select jsonb_agg(n) from jsonb_array_elements(notices) n where not (n->>'dateId' = any($1::text[]))), '[]'::jsonb)
      where notices <> '[]'::jsonb`, [removed]);
    await query(`update user_phones set pending_date_id = null where pending_date_id = any($1::uuid[])`, [removed]);
  }
  log(`Deleted ${removed.length} date(s).`);
  return { found: rows.length, removed: removed.length, ids: removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  console.log(apply ? "APPLY: deleting demo <-> real-resident dates." : "DRY RUN (add --apply to delete).");
  await demoCleanup((text, params) => sql.query(text, params), { apply });
}
