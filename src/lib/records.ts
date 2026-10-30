import { sql } from "./db";
import { stripContacts } from "./contacts";
import { onlyRemoved, screenNotes } from "./contact-check";
import { NOTES_KEPT, profileChanges, type Client } from "./client";

// The account records (db/schema.sql "Kismet records"): consents, profile edit history, last seen per
// channel, the append-only activity log and agent notes. Everything here is deleted with the account
// (ON DELETE CASCADE); only an anonymous "delete" activity row without a user stays.

/**
 * The Terms version a sign-up agrees to (the /terms "Last updated" date; a ".2" suffix marks a second update on one day,
 * as on 2026-10-28 for reports kept after deletion; 2026-10-29: the product described as intros, not dating). Recorded
 * for new sign-ups only: existing accounts are never asked again ("continued use" in /terms).
 */
export const TERMS_VERSION = "2026-10-29";

export type Action =
  | "signup" | "signin" | "profile_edit" | "dates_start" | "recommendation_shown" | "decision" | "match" | "unmatch"
  | "block" | "unblock" | "report" | "message_sent" | "photo_upload" | "photo_remove" | "notes_add" | "notes_delete"
  | "world_verify" | "waitlist_join" | "waitlist_remove" | "delete"
  | "text_consent" | "text_opt_out" | "text_opt_in" | "text_pause" | "text_resume" | "phone_link" | "link_code"
  | "checkin_asked" | "meeting_mark" | "signal_add" | "signal_change" | "weekly_drop" | "google_photo"
  | "training_share" | "feedback" | "edge_city" | "report_history" | "report_history_telegram";

/** Appends one activity row. Never throws: a failed log line must not fail the person's request. */
export async function logActivity(userId: string | null, c: Client, action: Action, meta: Record<string, unknown> = {}) {
  try {
    await sql`insert into activity_log (user_id, channel, client, action, meta)
      values (${userId}, ${c.channel}, ${c.client}, ${action}, ${JSON.stringify(meta)}::jsonb)`;
  } catch (e) {
    console.error("activity log failed", action, e instanceof Error ? e.message : e);
  }
}

/** Last seen on this channel. The first request on a new channel is logged as a sign-in there. */
export async function touchSeen(userId: string, c: Client) {
  try {
    // Skipped when the account was just deleted (this runs after the response).
    const [r] = await sql`insert into user_channels (user_id, channel, client)
      select ${userId}, ${c.channel}, ${c.client} where exists (select 1 from users where id = ${userId})
      on conflict (user_id, channel) do update set last_seen_at = now(),
        -- Time in use: a gap under 5 minutes is time spent with Kismet open, a longer one starts a new visit (1 minute).
        active_minutes = user_channels.active_minutes + case when user_channels.last_seen_at > now() - interval '5 minutes'
          then round(extract(epoch from now() - user_channels.last_seen_at) / 60)::int else 1 end,
        client = case when excluded.client <> '' then excluded.client else user_channels.client end
      where user_channels.last_seen_at < now() - interval '1 minute' or (excluded.client <> '' and excluded.client <> user_channels.client)
      returning (xmax = 0) as inserted`;
    if (r?.inserted) await logActivity(userId, c, "signin", { firstOnChannel: true });
  } catch (e) {
    console.error("last seen failed", e instanceof Error ? e.message : e);
  }
}

/** Sign-up: the source, both consents (18+ and the Terms version), the first channel and the activity row. */
export async function recordSignup(userId: string, c: Client, meta: Record<string, unknown> = {}) {
  await sql`update users set signup_channel = ${c.channel}, signup_client = ${c.client} where id = ${userId}`;
  await sql`insert into consents (user_id, kind, version, channel)
    values (${userId}, 'age_18_plus', ${TERMS_VERSION}, ${c.channel}), (${userId}, 'terms', ${TERMS_VERSION}, ${c.channel})`;
  await sql`insert into user_channels (user_id, channel, client) values (${userId}, ${c.channel}, ${c.client}) on conflict do nothing`;
  await logActivity(userId, c, "signup", meta);
}

/** One profile_history row per changed field (previous and new value), and a profile_edit activity row. */
export async function recordProfileEdit(userId: string, before: Record<string, unknown>, after: Record<string, unknown>, c: Client) {
  const changes = profileChanges(before, after);
  if (!changes.length) return;
  await sql`insert into profile_history (user_id, field, old_value, new_value, channel)
    select ${userId}, f, o::jsonb, n::jsonb, ${c.channel}
    from unnest(${changes.map((x) => x.field)}::text[], ${changes.map((x) => JSON.stringify(x.old))}::text[], ${changes.map((x) => JSON.stringify(x.new))}::text[]) as t(f, o, n)`;
  await logActivity(userId, c, "profile_edit", { fields: changes.map((x) => x.field) });
}

/** How matches reach them changed (Telegram or their phone): a profile_history row like any other field. */
export async function recordContactChange(userId: string, before: { method: string; phone: string | null }, after: { method: string; phone: string | null }, c: Client) {
  await sql`insert into profile_history (user_id, field, old_value, new_value, channel)
    values (${userId}, 'contactMethod', ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${c.channel})`;
  await logActivity(userId, c, "profile_edit", { fields: ["contactMethod"] });
}

/**
 * Marks recommendations as shown to `meId` the first time, with one recommendation_shown row each. shown_x_at is per
 * side: a held date shown to someone while nothing was held (weekly mode off, or after the event's last drop) stays
 * visible to them when holding resumes, and only to them (lib/secret.ts heldFrom).
 */
export async function markShown(meId: string, dateIds: string[], c: Client) {
  if (!dateIds.length) return;
  try {
    await sql`with sa as (
        update dates set shown_a_at = now() where id = any(${dateIds}::uuid[]) and a_id = ${meId} and shown_a_at is null returning id
      ), sb as (
        update dates set shown_b_at = now() where id = any(${dateIds}::uuid[]) and b_id = ${meId} and shown_b_at is null returning id
      )
      insert into activity_log (user_id, channel, client, action, meta)
      select ${meId}, ${c.channel}, ${c.client}, 'recommendation_shown', jsonb_build_object('dateId', id) from (select id from sa union all select id from sb) x`;
  } catch (e) {
    console.error("mark shown failed", e instanceof Error ? e.message : e);
  }
}

export type Note = { id: string; text: string; source: string; createdAt: string };

export async function listNotes(userId: string): Promise<Note[]> {
  const rows = await sql`select id, text, source, created_at from agent_notes where user_id = ${userId} order by created_at desc, id limit ${NOTES_KEPT}`;
  return rows.map((r) => ({ id: r.id as string, text: r.text as string, source: r.source as string, createdAt: new Date(r.created_at).toISOString() }));
}

/** Newest first, for the persona card: at most ~1200 characters of them. */
export async function notesFor(userId: string) {
  const out: string[] = [];
  let n = 0;
  for (const note of await listNotes(userId)) {
    if ((n += note.text.length) > 1200) break;
    out.push(note.text);
  }
  return out;
}

/**
 * Adds notes (contact details stripped, then the model contact check of lib/contact-check.ts; exact repeats skipped) and
 * keeps only the newest NOTES_KEPT. opts.checked: the caller already screened these texts (a sign-up screens its notes
 * with the profile), and whether the model read them.
 */
export async function addNotes(userId: string, texts: string[], c: Client, opts: { checked?: boolean } = {}) {
  let clean = texts.map((t) => stripContacts(t).trim()).filter((t) => t && !onlyRemoved(t));
  if (!clean.length) return 0;
  let checked = opts.checked;
  if (checked === undefined) {
    const screened = await screenNotes(clean, { label: userId });
    clean = screened.notes.map((t) => t.trim()).filter((t) => t && !onlyRemoved(t));
    checked = screened.checked;
    if (!clean.length) return 0;
  }
  const rows = await sql`insert into agent_notes (user_id, text, source, contacts_checked_at)
    select ${userId}, t, ${c.channel}, ${checked ? new Date().toISOString() : null}::timestamptz from unnest(${clean}::text[]) as t
    where not exists (select 1 from agent_notes a where a.user_id = ${userId} and lower(a.text) = lower(t))
    returning id`;
  await sql`delete from agent_notes where user_id = ${userId} and id not in
    (select id from agent_notes where user_id = ${userId} order by created_at desc, id limit ${NOTES_KEPT})`;
  if (rows.length) await logActivity(userId, c, "notes_add", { noteIds: rows.map((r) => r.id), count: rows.length });
  return rows.length;
}

/** Deletes one note (only the owner's) or all of them. Returns how many were deleted. */
export async function deleteNotes(userId: string, which: "all" | { id: string }, c: Client) {
  const rows = which === "all"
    ? await sql`delete from agent_notes where user_id = ${userId} returning id`
    : await sql`delete from agent_notes where user_id = ${userId} and id = ${which.id} returning id`;
  if (rows.length) await logActivity(userId, c, "notes_delete", which === "all" ? { all: true, count: rows.length } : { noteId: which.id });
  return rows.length;
}
