// The daily cron job's order and limits, and when a "running" date is dead. Pure (no imports): the route
// (app/api/text/cron) wires the database, the engine and the text runtime in; tests pass fakes.

/** Dates the cron itself starts: 30 at 6 at a time is about 5 rounds of a ~30 s date, inside ~200 s. */
export const CRON_PEOPLE = 40;
export const CRON_DATES = 30;
export const CRON_CONCURRENCY = 6;

export type DailyIO = {
  /** Deletes sign-up conversations abandoned for 30 days; returns how many. */
  dropAbandoned(): Promise<number>;
  /** Deletes reports kept after an account deletion once they are 12 months old (lib/report-history.ts); returns how many. */
  purgeKeptReports?(): Promise<number>;
  /** Retries deletions outside the database that failed (lib/deletion-jobs.ts); returns how many are now done. */
  deletionJobs?(): Promise<number>;
  /**
   * The weekly drop's catch-up (lib/drop-store.ts releaseWeeklyDrops, idempotent): a no-op unless this week's drop
   * is due and someone still has one coming (the weekly cron missed, or failed for them). Returns how many went out.
   */
  weeklyDrop?(): Promise<number>;
  /** Queued notices and the next open recommendation for every active text user; returns the thread count. */
  pushAll(): Promise<number>;
  /**
   * The model contact check on profiles and notes never checked (lib/contact-backfill.ts, time-boxed, idempotent);
   * returns how many rows it checked.
   */
  contactChecks?(): Promise<number>;
  /** People with date allowance left today (at most `limit`). */
  people(limit: number): Promise<{ id: string }[]>;
  /** Reserves this person's next dates (consumes date_log budget); returns the new date ids. */
  reserve(personId: string): Promise<string[]>;
  runDates(ids: string[], concurrency: number): Promise<void>;
};

/**
 * Text pushes go first, so a long batch of dates can never starve the morning's notices and recommendations;
 * then a bounded batch of dates (each finished date texts its own people); then retries of failed deletions.
 */
export async function dailyJob(io: DailyIO) {
  const abandoned = await io.dropAbandoned();
  const keptReports = io.purgeKeptReports ? await io.purgeKeptReports().catch((e) => {
    console.error("cron kept-report purge failed", e instanceof Error ? e.message : e); // the rest of the job still runs
    return 0;
  }) : 0;
  const drops = io.weeklyDrop ? await io.weeklyDrop().catch((e) => {
    console.error("cron weekly drop failed", e instanceof Error ? e.message : e); // the rest of the job still runs
    return 0;
  }) : 0;
  const threads = await io.pushAll().catch((e) => {
    console.error("cron text push failed", e instanceof Error ? e.message : e); // dates still start
    return 0;
  });
  // Before the dates, so a profile checked today reaches today's dates without its clue (time-boxed: 30 s).
  const contactChecks = io.contactChecks ? await io.contactChecks().catch((e) => {
    console.error("cron contact checks failed", e instanceof Error ? e.message : e); // dates still start
    return 0;
  }) : 0;
  const people = await io.people(CRON_PEOPLE);
  const ids: string[] = [];
  for (const p of people) {
    if (ids.length >= CRON_DATES) break;
    ids.push(...(await io.reserve(p.id)));
  }
  await io.runDates(ids, CRON_CONCURRENCY); // every reserved date runs (at most CRON_DATES + 2)
  // Last, and time-boxed (lib/deletion-jobs.ts): retries of failed deletions never hold back pushes or dates, and a run
  // cut off before them only delays them a day.
  const deletions = io.deletionJobs ? await io.deletionJobs().catch((e) => {
    console.error("cron deletion retries failed", e instanceof Error ? e.message : e);
    return 0;
  }) : 0;
  return { people: people.length, dates: ids.length, threads, abandoned, ...(io.weeklyDrop ? { drops } : {}), ...(io.purgeKeptReports ? { keptReports } : {}),
    ...(io.deletionJobs ? { deletions } : {}), ...(io.contactChecks ? { contactChecks } : {}) };
}

/** A date that started generating this long ago is dead (a killed function); one never started, after this. */
export const STALE_STARTED_MS = 4 * 60_000;
/** Longer than any function's life (maxDuration 300 s): a date still queued in a running pool is never cut. */
export const STALE_QUEUED_MS = 10 * 60_000;

/** True when a "running" date is dead and may be deleted so the pair can be retried. */
export function staleRunning(d: { status: string; createdAt: Date; startedAt: Date | null }, now: Date) {
  if (d.status !== "running") return false;
  if (d.startedAt) return now.getTime() - d.startedAt.getTime() > STALE_STARTED_MS;
  return now.getTime() - d.createdAt.getTime() > STALE_QUEUED_MS;
}
