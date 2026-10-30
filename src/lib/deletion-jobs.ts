// Deletions that must happen outside our database when an account (or a photo) is deleted: the photo files in Vercel
// Blob, the Neon Auth sign-in (its user row, with sessions and Google link) and the person's agent box at Daytona.
// Until now a failure there was only logged, so a photo file or a sign-in email could outlive the account. Now a
// failed one is queued in deletion_jobs (db/schema.sql) and the daily job (/api/text/cron, lib/daily.ts) retries it
// with backoff until it is gone. A queued job holds only what is needed to delete: a blob pathname (random ids), a
// Neon Auth user id, or the deleted account's id (its box is named after it). Never a name, an email or a contact.
import { sql } from "./db";

export type DeletionKind = "blob" | "neon_auth" | "agent_box";
export const DELETION_KINDS: readonly DeletionKind[] = ["blob", "neon_auth", "agent_box"];

/** Retries per daily run and kind: a backlog drains over a few days, never one long cron. Agent boxes are slow: fewer. */
export const DRAIN_LIMIT = 100;
export const BOX_LIMIT = 10;
/** The daily job's time for retries: no new try starts after it, and one try that hangs is given up after STEP_MS. */
export const DRAIN_BUDGET_MS = 30_000;
export const STEP_MS = 15_000;
/** After this many failed tries a job stops (next_at = infinity) and waits for a person (it stays listed with its error). */
export const MAX_ATTEMPTS = 14;
/** Wait before try n+1 after n failures: 1 h, 2 h, 4 h ... at most 7 days (the cron runs daily, so mostly "tomorrow"). */
export const backoffMs = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), 168) * 3_600_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Queues targets whose deletion just failed. Never throws: the caller's own work (the account delete) already happened. */
export async function queueDeletions(kind: DeletionKind, targets: readonly string[], error: unknown) {
  const list = [...new Set(targets.filter(Boolean))];
  if (!list.length) return;
  console.error(`${kind} delete failed, queued for retry`, list.length, message(error));
  await sql`insert into deletion_jobs (kind, target, last_error)
      select ${kind}, t, ${message(error)} from unnest(${list}::text[]) as t
      on conflict (kind, target) do update set next_at = least(deletion_jobs.next_at, now()), last_error = excluded.last_error`
    .catch((e) => console.error("deletion job queue failed", kind, list.length, message(e)));
}

/**
 * The real deleters. Each resolves when the target is gone (also when it was already gone) and throws otherwise.
 * `ready` says whether a kind can be tried now: without DAYTONA_API_KEY a box job waits (it is not done, and is not
 * counted as a failure either).
 */
export type Deleters = Record<DeletionKind, (targets: string[]) => Promise<void>> & { ready?: (kind: DeletionKind) => boolean };
const realDeleters: Deleters = {
  blob: async (pathnames) => (await import("@vercel/blob")).del(pathnames),
  // A sign-in linked to an account again (the person signed up again with Google and Neon Auth kept the user) is no longer
  // the deleted account's: it stays, and the job is done.
  neon_auth: async (ids) => void (await sql`delete from neon_auth."user" u where u.id::text = any(${ids}::text[])
    and not exists (select 1 from auth_identities a where a.auth_user_id = u.id::text)`),
  agent_box: async (userIds) => {
    const { deleteBox } = await import("./agent-box");
    for (const id of userIds) await deleteBox(id);
  },
  ready: (kind) => kind !== "agent_box" || Boolean(process.env.DAYTONA_API_KEY),
};

/** The deleter's promise, or a failure after `ms` (a hung call is a failed try; it may still finish on its own). */
const within = (p: Promise<void>, ms: number) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms);
  p.then(resolve, reject).finally(() => clearTimeout(t));
});

/**
 * Retries due jobs, oldest first: per kind at most `limit` (agent boxes BOX_LIMIT), only kinds that are ready, so a
 * backlog of one kind never starves another. Files and sign-ins are tried together, then one by one if that fails (one
 * bad target never holds back the rest); boxes one by one (each delete waits for Daytona). Each job's try is counted
 * (attempts, next_at) BEFORE it runs, so a run killed mid-way still backs off; a job the time budget cut off before its
 * own try gets that count back and is due again next run. Done ones are deleted; failed ones keep the wait and their
 * error, and stop after MAX_ATTEMPTS. No try starts after `budgetMs`. Returns how many were done and failed.
 */
export async function drainDeletionJobs(deleters: Deleters = realDeleters, limit = DRAIN_LIMIT, budgetMs = DRAIN_BUDGET_MS, stepMs = STEP_MS) {
  const deadline = Date.now() + budgetMs;
  const kinds = DELETION_KINDS.filter((k) => !deleters.ready || deleters.ready(k));
  const due = kinds.length ? await sql`select id, kind, target, attempts from (
        select id, kind, target, attempts, next_at, row_number() over (partition by kind order by next_at, id) as n
        from deletion_jobs where next_at <= now() and kind = any(${kinds}::text[])) d
      where n <= case when kind = 'agent_box' then ${Math.min(limit, BOX_LIMIT)}::int else ${limit}::int end
      order by next_at, id` : [];
  let done = 0;
  let failed = 0;
  for (const kind of kinds) {
    const jobs = due.filter((j) => j.kind === kind);
    if (!jobs.length || Date.now() >= deadline) continue;
    const ids = jobs.map((j) => j.id as number);
    // Counted first (one statement): attempts + 1 and the next wait, or never again after the last attempt.
    await sql`update deletion_jobs set attempts = attempts + 1, last_tried_at = now(),
        next_at = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'infinity'::timestamptz
          else now() + make_interval(secs => least(power(2, attempts), 168) * 3600) end
      where id = any(${ids}::bigint[])`;
    const ok = kind !== "agent_box" && (await within(deleters[kind](jobs.map((j) => j.target as string)), stepMs).then(() => true, () => false));
    for (const j of jobs) {
      if (!ok && Date.now() >= deadline) {
        // Never tried on its own this run: not a failure, and due again next run.
        await sql`update deletion_jobs set attempts = greatest(attempts - 1, 0), next_at = now() where id = ${j.id}`;
        continue;
      }
      const err = ok ? null : await within(deleters[kind]([j.target as string]), stepMs).then(() => null, (e: unknown) => e ?? new Error("failed"));
      if (!err) {
        await sql`delete from deletion_jobs where id = ${j.id}`;
        done++;
        continue;
      }
      failed++;
      if ((j.attempts as number) + 1 >= MAX_ATTEMPTS) console.error("deletion job gave up", kind, j.id, message(err));
      await sql`update deletion_jobs set last_error = ${message(err)} where id = ${j.id}`;
    }
  }
  return { done, failed };
}
