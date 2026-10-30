import { sql, toUser, type User } from "@/lib/db";
import { DATES_PER_DAY, reserveDates, runDates } from "@/lib/engine";
import { logActivity } from "@/lib/records";
import { SYSTEM } from "@/lib/client";
import { pushAllActive, whatsapp } from "@/lib/text/runtime";
import { dailyJob } from "@/lib/daily";
import { cronAuthorized, releaseWeeklyDrops } from "@/lib/drop-store";
import { backfillReportKeys, purgeKeptReports } from "@/lib/report-history";
import { drainDeletionJobs } from "@/lib/deletion-jobs";
import { backfillContactChecks } from "@/lib/contact-backfill";

// The daily job, 03:00 UTC = 08:30 Asia/Kolkata (vercel.json crons; Hobby crons run once a day and fire within
// the hour, so never in quiet hours). Vercel sends Authorization: Bearer $CRON_SECRET.
// Order and limits: lib/daily.ts.
// 1. Sign-up conversations abandoned for 30 days are deleted, and reports kept after an account deletion once 12 months
//    have passed (lib/report-history.ts, which also hashes reports filed before that existed); this week's drop is caught up if the weekly cron
//    (/api/text/drop, lib/drop-store.ts) missed anyone (a no-op otherwise, and before Wednesday's drop).
// 2. Kismet by text first: queued notices and the next open recommendation go out to WhatsApp users.
// 3. Dates start on their own: visible residents with allowance left (web, apps, Agent Village and WhatsApp
//    alike) get up to 3 new dates each, a bounded batch inside the usual caps (3 per India day, 600 a day for
//    the village). Between runs, dates also start on sign-up and when people show up (lib/actions.ts autoStartDates).
// 2b. The model contact check (lib/contact-check.ts) reads profiles and notes it never read (lib/contact-backfill.ts), for at
//    most 30 s, so today's dates see them without a hidden contact.
// 4. Deletions outside the database that failed (photo files, sign-ins, agent boxes: lib/deletion-jobs.ts) are retried,
//    for at most 30 s.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return new Response("Forbidden", { status: 403 });
  const byId = new Map<string, User>();
  const r = await dailyJob({
    dropAbandoned: async () =>
      (await sql`delete from user_phones where user_id is null and coalesce(last_inbound_at, created_at) < now() - interval '30 days' returning id`).length,
    async purgeKeptReports() {
      const purged = await purgeKeptReports();
      await backfillReportKeys(); // reports filed before the hashes existed (a few hundred accounts a day)
      return purged;
    },
    deletionJobs: async () => (await drainDeletionJobs()).done, // photo files, sign-ins, agent boxes that failed to go
    weeklyDrop: async () => (await releaseWeeklyDrops(new Date(), 30_000, { catchUp: true })).released, // catch-up: mostly template plans; never a drop before its time
    async pushAll() {
      if (!whatsapp.configured()) return 0;
      return pushAllActive();
    },
    // Profiles and notes the model contact check never read (lib/contact-backfill.ts), for at most 30 s.
    contactChecks: async () => {
      const r = await backfillContactChecks();
      return r.users + r.notes;
    },
    async people(limit) {
      // Not demo accounts (lib/demo.ts): their dates are set up by hand for App Review, never started in the background.
      const rows = await sql`select u.* from users u where u.edge_city and u.banned_at is null and u.hidden_at is null and not u.is_demo
          and (select count(*) from dates d where (d.a_id = u.id or d.b_id = u.id)
            and d.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) < ${DATES_PER_DAY}
        order by random() limit ${limit}`;
      for (const u of rows.map(toUser)) byId.set(u.id, u);
      return [...byId.values()];
    },
    async reserve(id) {
      const me = byId.get(id)!;
      const { ids } = await reserveDates(me, `cron:${me.id}`);
      if (ids.length) await logActivity(me.id, SYSTEM, "dates_start", { dateIds: ids, auto: true });
      return ids;
    },
    runDates, // each finished date texts its WhatsApp users (engine.runDate -> pushForUsers)
  });
  return Response.json({ ok: true, ...r });
}
