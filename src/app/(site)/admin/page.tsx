import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { ADMIN_COOKIE, adminCookieOk, AUTO_HIDE_REPORTERS } from "@/lib/safety";
import { historyOf, KEPT_REPORT_MONTHS } from "@/lib/report-history";

export const metadata: Metadata = { title: "Moderation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Report = { reason: string; note: string; status: string; created_at: string; reporter: string | null; photo_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 16).replace("T", " ") : "");
const show = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <div className="overflow-x-auto rounded-3xl border border-line bg-card">
    <table className="w-full text-left text-xs">
      <thead className="text-muted">
        <tr>{head.map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className="p-2">{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);

// One person's records: profile, sign-up source, consents, channels, notes, profile history and activity.
async function UserDetail({ id }: { id: string }) {
  const [u] = await sql`select * from users where id = ${id}`;
  if (!u) return <p className="pt-6 text-muted">No such user (deleted?). <a href="/admin" className="underline">Back</a></p>;
  const [consents, channels, notes, history, activity, threads] = await Promise.all([
    sql`select kind, version, channel, created_at from consents where user_id = ${id} order by created_at`,
    sql`select channel, client, first_seen_at, last_seen_at from user_channels where user_id = ${id} order by last_seen_at desc`,
    sql`select text, source, created_at from agent_notes where user_id = ${id} order by created_at desc`,
    sql`select field, old_value, new_value, channel, created_at from profile_history where user_id = ${id} order by id desc limit 200`,
    sql`select action, channel, client, meta, created_at from activity_log where user_id = ${id} order by id desc limit 300`,
    sql`select channel, phone, state, last_inbound_at, opted_out_at, paused_at,
        (select count(*) from conversation_messages m where m.phone_id = p.id)::int as messages from user_phones p where user_id = ${id}`,
  ]);
  const fields = ["name", "telegram", "rel_status", "openness", "gender", "interested_in", "looking_for", "interests", "bio", "agent_profile",
    "agent_name", "agent_personality", "public_quotes", "x_handle", "use_x_photo", "tags", "persona_card", "signup_channel", "signup_client",
    "terms_accepted_at", "world_verified_at", "banned_at", "hidden_at", "history_reviewed_at", "created_at", "updated_at"];
  return (
    <div className="flex flex-col gap-4 pt-6">
      <a href="/admin" className="text-sm underline">Back to admin</a>
      <h1 className="text-2xl font-extrabold">{u.name} <span className="text-base font-normal text-muted">@{u.telegram}</span></h1>
      <Table head={["Field", "Value"]} rows={fields.map((f) => [f, <span key={f} className="whitespace-pre-wrap">{u[f] instanceof Date ? when(u[f]) : show(u[f])}</span>])} />
      <h2 className="text-lg font-bold">Consents</h2>
      <Table head={["Kind", "Terms version", "Channel", "At"]} rows={consents.map((c) => [c.kind, c.version, c.channel, when(c.created_at)])} />
      <h2 className="text-lg font-bold">Channels (last seen)</h2>
      <Table head={["Channel", "Client", "First seen", "Last seen"]} rows={channels.map((c) => [c.channel, c.client, when(c.first_seen_at), when(c.last_seen_at)])} />
      <h2 className="text-lg font-bold">Kismet by text</h2>
      <Table head={["Channel", "Phone", "State", "Last inbound", "Opted out", "Paused", "Messages"]}
        rows={threads.map((t) => [t.channel, t.phone, t.state, when(t.last_inbound_at), when(t.opted_out_at), when(t.paused_at), t.messages])} />
      <h2 className="text-lg font-bold">What their agent knows ({notes.length})</h2>
      <Table head={["Note", "Source", "At"]} rows={notes.map((n) => [n.text, n.source, when(n.created_at)])} />
      <h2 className="text-lg font-bold">Profile history</h2>
      <Table head={["Field", "Before", "After", "Channel", "At"]} rows={history.map((h) => [h.field, show(h.old_value), show(h.new_value), h.channel, when(h.created_at)])} />
      <h2 className="text-lg font-bold">Activity</h2>
      <Table head={["Action", "Channel", "Client", "Details", "At"]} rows={activity.map((a) => [a.action, a.channel, a.client, show(a.meta), when(a.created_at)])} />
    </div>
  );
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ e?: string; user?: string }> }) {
  const key = process.env.ADMIN_KEY;
  const signedIn = adminCookieOk((await cookies()).get(ADMIN_COOKIE)?.value, key);
  const params = await searchParams;
  if (signedIn && params.user && UUID.test(params.user)) return <UserDetail id={params.user} />;
  if (!signedIn) {
    const e = params.e;
    return (
      <form method="post" action="/api/admin/login" className="mx-auto flex max-w-sm flex-col gap-3 pt-16">
        <h1 className="text-2xl font-extrabold">Moderation</h1>
        {!key && <p className="text-sm text-danger">ADMIN_KEY is not configured.</p>}
        {e && <p className="text-sm text-danger">{e === "rate" ? "Too many attempts. Try later." : "Wrong key."}</p>}
        <input name="key" type="password" autoComplete="current-password" className="field" placeholder="Admin key" required />
        <button className="btn btn-primary">Sign in</button>
      </form>
    );
  }

  const people = await sql`
    select u.id, u.name, u.telegram, u.bio, u.agent_profile, u.persona_card, u.banned_at, u.hidden_at,
      count(distinct r.reporter_id)::int as reporters,
      count(*) filter (where r.status = 'open')::int as open,
      json_agg(json_build_object('reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at, 'reporter', rp.name, 'photo_id', r.photo_id)
        order by r.created_at desc) as reports
    from reports r join users u on u.id = r.reported_id left join users rp on rp.id = r.reporter_id
    group by u.id
    order by (u.hidden_at is not null and u.banned_at is null) desc, count(*) filter (where r.status = 'open') desc, max(r.created_at) desc
    limit 200`;

  // Hidden at sign-up or on a contact change because an earlier account with the same contact was banned or reported
  // over the threshold (lib/report-history.ts), with the reports behind it.
  const rejoined = await Promise.all((await sql`select u.id, u.name, u.telegram, u.created_at, u.banned_at, u.hidden_at from users u
      where u.hidden_at is not null and exists (select 1 from activity_log a where a.user_id = u.id and a.action = 'report_history')
      order by u.hidden_at desc limit 50`).map(async (u) => Object.assign(u, { history: await historyOf(u.id as string) })));
  // Their Telegram only is on reports about another account: never hidden for it (a handle is not verified, so it may be an
  // impersonator's), only listed here to look at.
  const telegramMatches = await Promise.all((await sql`select u.id, u.name, u.telegram, u.created_at, u.banned_at, u.hidden_at from users u
      where exists (select 1 from activity_log a where a.user_id = u.id and a.action = 'report_history_telegram')
      order by u.created_at desc limit 50`).map(async (u) => Object.assign(u, { history: await historyOf(u.id as string) })));
  // Reports about accounts that were deleted, kept for KEPT_REPORT_MONTHS with only contact hashes; one group per account.
  const kept = await sql`select r.reported_gone_at, bool_or(r.reported_banned) as banned, bool_or(r.reported_hidden) as hidden, count(distinct r.reporter_id)::int as reporters,
      json_agg(json_build_object('reason', r.reason, 'note', r.note, 'status', r.status, 'created_at', r.created_at, 'reporter', rp.name, 'photo_id', null)
        order by r.created_at desc) as reports
    from reports r left join users rp on rp.id = r.reporter_id where r.reported_id is null
    group by r.reported_gone_at order by r.reported_gone_at desc nulls last limit 100`;

  const waitlist = await sql`select w.email, w.name, w.place, w.handle, w.platforms, w.created_at,
      (select count(*) from waitlist r where r.referred_by = w.ref_code)::int as referrals
    from waitlist w order by w.id desc limit 500`;
  const [{ n: waitlistTotal }] = await sql`select count(*)::int as n from waitlist`;

  // Every account with its sign-up source, last seen per channel and counts; then the latest activity.
  const users = await sql`select u.id, u.name, u.telegram, u.signup_channel, u.signup_client, u.created_at, u.banned_at, u.hidden_at,
      (select string_agg(c.channel || ' ' || to_char(c.last_seen_at, 'MM-DD HH24:MI'), ', ' order by c.last_seen_at desc) from user_channels c where c.user_id = u.id) as seen,
      (select count(*) from dates d where d.a_id = u.id or d.b_id = u.id)::int as dates,
      (select count(*) from dates d where (d.a_id = u.id or d.b_id = u.id) and d.matched_at is not null)::int as matches,
      (select count(*) from agent_notes n where n.user_id = u.id)::int as notes,
      (select count(*) from activity_log a where a.user_id = u.id)::int as actions
    from users u order by u.created_at desc limit 500`;
  const [{ n: userTotal }] = await sql`select count(*)::int as n from users`;
  const activity = await sql`select a.action, a.channel, a.client, a.meta, a.created_at, a.user_id, u.name
    from activity_log a left join users u on u.id = a.user_id order by a.id desc limit 150`;

  const act = (id: string, op: string, label: string, primary = false) => (
    <form method="post" action="/api/admin/action">
      <input type="hidden" name="userId" value={id} />
      <input type="hidden" name="op" value={op} />
      <button className={`btn min-h-11 px-4 text-sm ${primary ? "btn-primary" : "btn-ghost"}`}>{label}</button>
    </form>
  );

  return (
    <div className="flex flex-col gap-4 pt-6">
      <h1 className="text-2xl font-extrabold">Reports</h1>
      <p className="text-sm text-muted">
        {AUTO_HIDE_REPORTERS}+ distinct reporters hide a person automatically until reviewed. Ban hides them from everyone and stops their dates.
      </p>
      {!people.length && <p className="text-muted">No reports.</p>}
      {people.map((p) => (
        <section key={p.id} className="rounded-3xl border border-line bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-bold">
              {p.name} <span className="font-normal text-muted">@{p.telegram}</span>
            </p>
            <p className="font-semibold">
              {p.banned_at ? "Banned" : p.hidden_at ? "Auto-hidden, pending review" : "Visible"} · {p.reporters} reporter{p.reporters === 1 ? "" : "s"} · {p.open} open
            </p>
          </div>
          {p.bio && <p className="mt-2">{p.bio}</p>}
          {p.persona_card && <p className="mt-1 text-muted">{p.persona_card}</p>}
          {p.agent_profile && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted">Full profile text</summary>
              <p className="whitespace-pre-wrap">{p.agent_profile}</p>
            </details>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {(p.reports as Report[]).map((r, i) => (
              <li key={i} className="rounded-xl bg-bg-2 p-2">
                <b>{r.reason}</b> ({r.status}) · {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} · by {r.reporter ?? "deleted account"}
                {r.note && <p className="mt-1 whitespace-pre-wrap">{r.note}</p>}
                {r.photo_id && (
                  <div className="mt-2 flex items-end gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/photos/${r.photo_id}`} alt="Reported photo" className="size-24 rounded-xl object-cover" />
                    <form method="post" action="/api/admin/action">
                      <input type="hidden" name="userId" value={p.id} />
                      <input type="hidden" name="photoId" value={r.photo_id} />
                      <input type="hidden" name="op" value="deletephoto" />
                      <button className="btn btn-ghost min-h-11 px-3 text-xs">Delete photo</button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.banned_at ? act(p.id, "unban", "Unban") : act(p.id, "ban", "Ban", true)}
            {p.hidden_at && !p.banned_at && act(p.id, "unhide", "Restore (dismiss reports)")}
            {!p.hidden_at && !p.banned_at && p.open > 0 && act(p.id, "dismiss", "Dismiss open reports")}
          </div>
        </section>
      ))}

      <h2 className="mt-6 text-2xl font-extrabold">Hidden by an earlier account&apos;s reports ({rejoined.length})</h2>
      <p className="text-sm text-muted">
        Their phone, sign-in email or Agent Village key matches an account that was banned, hidden or reported by {AUTO_HIDE_REPORTERS}+
        people (often one deleted to rejoin). A Telegram match alone never hides anyone (see below). Restore makes those earlier reports stop
        counting against them.
      </p>
      {rejoined.map((p) => (
        <section key={p.id} className="rounded-3xl border border-line bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-bold">
              <a href={`/admin?user=${p.id}`} className="underline">{p.name}</a> <span className="font-normal text-muted">@{p.telegram} · joined {when(p.created_at)}</span>
            </p>
            <p className="font-semibold">{p.banned_at ? "Banned" : "Hidden, pending review"}</p>
          </div>
          <ul className="mt-3 flex flex-col gap-1">
            {p.history.map((r, i) => (
              <li key={i} className="rounded-xl bg-bg-2 p-2">
                <b>{r.reason}</b> ({r.status}) · {when(r.created_at)} · by {r.reporter ?? "deleted account"} · about{" "}
                {r.reported ?? `a deleted account${r.reported_gone_at ? ` (deleted ${when(r.reported_gone_at)})` : ""}`}{r.reported_banned ? ", banned" : r.reported_hidden ? ", hidden" : ""}
                {r.note && <p className="mt-1 whitespace-pre-wrap">{r.note}</p>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.banned_at ? act(p.id, "unban", "Unban") : act(p.id, "ban", "Ban", true)}
            {!p.banned_at && act(p.id, "unhide", "Restore")}
          </div>
        </section>
      ))}

      <h2 className="mt-6 text-2xl font-extrabold">Telegram matches an earlier account&apos;s reports ({telegramMatches.length})</h2>
      <p className="text-sm text-muted">
        Their Telegram username is on reports about another account. Usernames are not verified (anyone can type one, so this may be the real owner
        of a handle an impersonator used): it never hides anyone. Look at the history and ban only if it is clearly the same person.
      </p>
      {telegramMatches.map((p) => (
        <section key={p.id} className="rounded-3xl border border-line bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-bold">
              <a href={`/admin?user=${p.id}`} className="underline">{p.name}</a> <span className="font-normal text-muted">@{p.telegram} · joined {when(p.created_at)}</span>
            </p>
            <p className="font-semibold">{p.banned_at ? "Banned" : p.hidden_at ? "Hidden" : "Visible"}</p>
          </div>
          <ul className="mt-3 flex flex-col gap-1">
            {p.history.map((r, i) => (
              <li key={i} className="rounded-xl bg-bg-2 p-2">
                <b>{r.reason}</b> ({r.status}) · {when(r.created_at)} · by {r.reporter ?? "deleted account"} · about{" "}
                {r.reported ?? `a deleted account${r.reported_gone_at ? ` (deleted ${when(r.reported_gone_at)})` : ""}`}{r.reported_banned ? ", banned" : r.reported_hidden ? ", hidden" : ""}
                {r.note && <p className="mt-1 whitespace-pre-wrap">{r.note}</p>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">{p.banned_at ? act(p.id, "unban", "Unban") : act(p.id, "ban", "Ban", true)}</div>
        </section>
      ))}

      <h2 className="mt-6 text-2xl font-extrabold">Kept reports, account deleted ({kept.length})</h2>
      <p className="text-sm text-muted">
        Reports about people who deleted their account, kept {KEPT_REPORT_MONTHS} months with one-way hashes of their contacts (no name or contact),
        so a new account with the same contact is checked. Deleted automatically after that.
      </p>
      {kept.map((k, i) => (
        <section key={i} className="rounded-3xl border border-line bg-card p-4 text-sm">
          <p className="font-semibold">
            Deleted {k.reported_gone_at ? when(k.reported_gone_at) : "before this was kept (deleted by the next daily job)"}{k.banned ? " · was banned" : k.hidden ? " · was hidden" : ""} · {k.reporters} reporter{k.reporters === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {(k.reports as Report[]).map((r, j) => (
              <li key={j} className="rounded-xl bg-bg-2 p-2">
                <b>{r.reason}</b> ({r.status}) · {when(r.created_at)} · by {r.reporter ?? "deleted account"}
                {r.note && <p className="mt-1 whitespace-pre-wrap">{r.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h2 className="mt-6 text-2xl font-extrabold">Users ({userTotal})</h2>
      <Table
        head={["Name", "Telegram", "Signed up via", "Joined", "Last seen (UTC)", "Dates", "Matches", "Notes", "Actions", "Status"]}
        rows={users.map((u) => [
          <a key="n" href={`/admin?user=${u.id}`} className="font-semibold underline">{u.name}</a>,
          u.telegram, `${u.signup_channel}${u.signup_client ? ` (${u.signup_client})` : ""}`, when(u.created_at), u.seen ?? "",
          u.dates, u.matches, u.notes, u.actions, u.banned_at ? "banned" : u.hidden_at ? "hidden" : "",
        ])}
      />
      <h2 className="mt-6 text-2xl font-extrabold">Recent activity</h2>
      <Table
        head={["At (UTC)", "Who", "Action", "Channel", "Details"]}
        rows={activity.map((a) => [
          when(a.created_at),
          a.user_id ? <a key="u" href={`/admin?user=${a.user_id}`} className="underline">{a.name}</a> : <span key="u" className="text-muted">no account</span>,
          a.action, `${a.channel}${a.client ? ` (${a.client})` : ""}`, show(a.meta),
        ])}
      />

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-2xl font-extrabold">Waitlist ({waitlistTotal})</h2>
        <a href="/api/admin/waitlist" className="btn btn-ghost min-h-11 px-4 text-sm">Export CSV</a>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-line bg-card">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>{["Email", "Name", "Where", "Handle", "Platforms", "Refs", "Joined"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {waitlist.map((w) => (
              <tr key={w.email} className="border-t border-line">
                <td className="p-2">{w.email}</td>
                <td className="p-2">{w.name}</td>
                <td className="p-2">{w.place}</td>
                <td className="p-2">{w.handle}</td>
                <td className="p-2">{(w.platforms as string[]).join(", ")}</td>
                <td className="p-2">{w.referrals}</td>
                <td className="p-2">{new Date(w.created_at).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
