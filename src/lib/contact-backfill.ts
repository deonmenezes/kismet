// The daily job's half of the model contact check (lib/contact-check.ts): rows never checked (written before the check
// existed, or saved while the model was down: contacts_checked_at is null) are checked now. Profiles and notes the
// pre-filter finds nothing in are marked checked without a model call; the others get one call per account. A row the
// person edited since it was read is left alone (their edit ran its own check). Idempotent: a checked row is never
// read again. A failed check counts an attempt; after MAX_ATTEMPTS the row is left unchecked for a person to look at
// (select ... where contacts_checked_at is null and contacts_check_attempts >= 5), so it never holds the queue.
import { sql } from "./db";
import { SYSTEM } from "./client";
import { recordProfileEdit } from "./records";
import { inputHash, needsModel, onlyRemoved, profileFields, screenFields, type Detect } from "./contact-check";

/** Rows read per run and kind; model calls per run; the run's time and one call's. A backlog drains over a few days. */
export const BACKFILL_ROWS = 500;
export const BACKFILL_CALLS = 60;
export const BACKFILL_BUDGET_MS = 30_000;
export const BACKFILL_CALL_MS = 8_000;
/** Failed tries before a row waits for a person. */
export const MAX_ATTEMPTS = 5;
/** Profiles get this share of the run's time and calls first; notes the rest (and whatever profiles left). */
const PROFILE_SHARE = 0.6;

type Opts = { detect?: Detect; budgetMs?: number; callMs?: number; rows?: number; calls?: number };
export type BackfillResult = { users: number; notes: number; changed: number; failed: number };

const textOf = (v: string | string[]) => (Array.isArray(v) ? v.join(" | ") : v);

export async function backfillContactChecks(opts: Opts = {}): Promise<BackfillResult> {
  const start = Date.now();
  const budget = opts.budgetMs ?? BACKFILL_BUDGET_MS;
  const deadline = start + budget;
  const limit = opts.rows ?? BACKFILL_ROWS;
  const totalCalls = opts.calls ?? BACKFILL_CALLS;
  let calls = 0;
  const out: BackfillResult = { users: 0, notes: 0, changed: 0, failed: 0 };
  const screen = async <T extends Record<string, string | string[]>>(values: T, label: string) => {
    calls++;
    return screenFields(values, { detect: opts.detect, budgetMs: Math.min(opts.callMs ?? BACKFILL_CALL_MS, Math.max(1, deadline - Date.now())), label });
  };
  const rebuild = new Set<string>();

  // Profiles. updated_at as text (microseconds): the row is written back only if nobody edited it since.
  const profileDeadline = start + budget * PROFILE_SHARE;
  const profileCalls = Math.ceil(totalCalls * PROFILE_SHARE);
  const users = await sql`select id, name, bio, agent_profile, agent_name, agent_personality, area, interests, updated_at::text as v
    from users where contacts_checked_at is null and contacts_check_attempts < ${MAX_ATTEMPTS}
    order by contacts_check_attempts, created_at limit ${limit}`;
  const plain: { id: string; v: string }[] = [];
  for (const u of users) {
    const before = profileFields({ name: u.name, bio: u.bio, agentProfile: u.agent_profile, agentName: u.agent_name, agentPersonality: u.agent_personality, area: u.area, interests: u.interests });
    if (!Object.values(before).some((f) => needsModel(textOf(f)))) {
      plain.push({ id: u.id, v: u.v });
      continue;
    }
    if (calls >= profileCalls || Date.now() >= profileDeadline) continue;
    const r = await screen(before, `backfill ${u.id}`);
    if (!r.checked) {
      out.failed++;
      // What the model did remove is kept (a reply with one span in no field, or held back by the cap); the row stays
      // unchecked and counts an attempt.
      if (!r.removed) {
        await sql`update users set contacts_check_attempts = contacts_check_attempts + 1 where id = ${u.id} and updated_at::text = ${u.v}`;
        continue;
      }
    }
    const v = r.values;
    const interestsChanged = v.interests.length !== before.interests.length;
    // The stored text before the check is the input it came from: an agent sending that copy again reuses this check.
    const [done] = await sql`update users set name = ${v.name}, bio = ${v.bio}, agent_profile = ${v.agentProfile}, agent_name = ${v.agentName},
        agent_personality = ${v.agentPersonality}, area = ${v.area}, interests = ${v.interests},
        tags = case when ${interestsChanged} then ${v.interests.map((s) => s.toLowerCase())}::text[] else tags end,
        contacts_checked_at = ${r.checked ? new Date().toISOString() : null}::timestamptz,
        contacts_check_attempts = contacts_check_attempts + ${r.checked ? 0 : 1},
        contacts_input_hash = ${r.checked ? inputHash(before) : null}
      where id = ${u.id} and contacts_checked_at is null and updated_at::text = ${u.v} returning id`;
    if (!done) continue;
    if (r.checked) out.users++;
    if (r.removed) {
      out.changed++;
      rebuild.add(u.id);
      await recordProfileEdit(u.id, before, v, SYSTEM); // profile_history: what the check removed, by "system"
    }
  }
  if (plain.length) {
    const marked = await sql`update users u set contacts_checked_at = now()
      from unnest(${plain.map((p) => p.id)}::uuid[], ${plain.map((p) => p.v)}::text[]) as x(id, v)
      where u.id = x.id and u.contacts_checked_at is null and u.updated_at::text = x.v returning u.id`;
    out.users += marked.length;
  }

  // Notes (never edited, only added and deleted): one call per account for its unchecked notes.
  const notes = await sql`select id, user_id, text from agent_notes where contacts_checked_at is null and contacts_check_attempts < ${MAX_ATTEMPTS}
    order by contacts_check_attempts, created_at limit ${limit}`;
  const plainNotes: string[] = [];
  const byUser = new Map<string, { id: string; text: string }[]>();
  for (const n of notes) {
    if (!needsModel(n.text)) plainNotes.push(n.id);
    else byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), { id: n.id, text: n.text }]);
  }
  if (plainNotes.length) {
    out.notes += (await sql`update agent_notes set contacts_checked_at = now() where id = any(${plainNotes}::uuid[]) and contacts_checked_at is null returning id`).length;
  }
  for (const [userId, list] of byUser) {
    if (calls >= totalCalls || Date.now() >= deadline) break;
    const r = await screen(Object.fromEntries(list.map((n, i) => [`note${i + 1}`, n.text])), `backfill notes ${userId}`);
    if (!r.checked) out.failed++;
    // Unchecked (a span in no field, or held back by the cap): what was removed is kept, and every note counts an attempt.
    const checkedAt = r.checked ? new Date().toISOString() : null;
    const tries = r.checked ? 0 : 1;
    for (const [i, n] of list.entries()) {
      const text = (r.values[`note${i + 1}`] as string).trim();
      if (text === n.text.trim()) {
        await sql`update agent_notes set contacts_checked_at = ${checkedAt}::timestamptz, contacts_check_attempts = contacts_check_attempts + ${tries}
          where id = ${n.id} and contacts_checked_at is null`;
      } else {
        // A note that was only a contact goes; another keeps what is left.
        if (onlyRemoved(text)) await sql`delete from agent_notes where id = ${n.id}`;
        else await sql`update agent_notes set text = ${text}, contacts_checked_at = ${checkedAt}::timestamptz, contacts_check_attempts = contacts_check_attempts + ${tries}
          where id = ${n.id} and contacts_checked_at is null`;
        out.changed++;
        rebuild.add(userId);
      }
      if (r.checked) out.notes++;
    }
  }

  // The persona card and its tags were written from the old text: cleared, and the hash too, so the next date rewrites
  // them (lib/engine.ts enriches a profile with no card); until then dates use the checked bio.
  if (rebuild.size) await sql`update users set persona_card = '', profile_hash = null where id = any(${[...rebuild]}::uuid[])`;
  if (out.users || out.notes || out.failed) console.log(`contact backfill: ${out.users} profiles, ${out.notes} notes checked, ${out.changed} changed, ${out.failed} failed`);
  return out;
}
