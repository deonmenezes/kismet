import { sql } from "./db";
import { isOwnWords, wordsOf } from "./text/parse";

// Signals, after Index Network (Agent Village's matching): a want in the person's own words ("a co-founder for an
// AI music app", "someone to surf with at sunrise"). Several at once, each paused, resumed or dropped on its own;
// a new one refreshes their agent card, which is what matching and dates read. Private like agent notes: never
// shown to anyone else, deleted with the account.

export const MAX_ACTIVE = 5;
export type Signal = { id: string; text: string; status: "active" | "paused" | "archived"; createdAt: string };

const same = (a: string, b: string) => wordsOf(a).join(" ") === wordsOf(b).join(" ");

export async function listSignals(userId: string, all = false): Promise<Signal[]> {
  const rows = all
    ? await sql`select * from signals where user_id = ${userId} and status <> 'archived' order by created_at`
    : await sql`select * from signals where user_id = ${userId} and status = 'active' order by created_at`;
  return rows.map((r) => ({ id: r.id as string, text: r.text as string, status: r.status as Signal["status"], createdAt: new Date(r.created_at as string).toISOString() }));
}

/** Saves a signal in the person's own words. Null when it isn't their words, repeats one, or 5 are active. */
export async function addSignal(userId: string, text: string, message: string) {
  const clean = text.replace(/\s+/g, " ").trim().replace(/^["“']|["”']$/g, "");
  if (!isOwnWords(clean, message)) return null;
  const current = await listSignals(userId, true);
  if (current.some((s) => same(s.text, clean))) return null;
  if (current.filter((s) => s.status === "active").length >= MAX_ACTIVE) return null;
  const [r] = await sql`insert into signals (user_id, text) values (${userId}, ${clean.slice(0, 280)}) returning id`;
  return r ? { id: r.id as string, text: clean } : null;
}

/** Pause, resume or drop one signal (by id, or by its number in the list). True when something changed. */
export async function setSignal(userId: string, which: { id: string } | { n: number }, action: "pause" | "resume" | "drop") {
  const list = await listSignals(userId, true);
  const s = "id" in which ? list.find((x) => x.id === which.id) : list[which.n - 1];
  if (!s) return false;
  const status = action === "pause" ? "paused" : action === "resume" ? "active" : "archived";
  if (action === "resume" && list.filter((x) => x.status === "active").length >= MAX_ACTIVE) return false;
  const rows = await sql`update signals set status = ${status}, updated_at = now() where id = ${s.id} and user_id = ${userId} and status <> ${status} returning id`;
  return rows.length > 0;
}

export function signalsText(list: Signal[]) {
  if (!list.length) return "No signals yet. Tell me what you want, in your own words (\"a co-founder for an AI music app\"), and I'll look for it.";
  return [
    "Your signals (private: they only shape your agent's search):",
    ...list.map((s, i) => `${i + 1}. ${s.text}${s.status === "paused" ? " (paused)" : ""}`),
    "Change one: PAUSE SIGNAL 1, RESUME SIGNAL 1, DROP SIGNAL 1.",
  ].join("\n");
}
