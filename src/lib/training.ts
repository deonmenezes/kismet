import { sql } from "./db";
import type { Client } from "./client";
import { stripContacts } from "./contacts";
import { logActivity } from "./records";
import { shouldAsk, TRAINING_VERSION } from "./training-core";

/** The person's own use: their agent's API, MCP or village traffic never counts as time they spent with Kismet. */
const OWN_CHANNELS = ["web", "ios", "imessage", "android", "whatsapp"];

/** Their current answer (null: not asked yet) and their own time with Kismet open, in minutes. */
export async function trainingState(userId: string) {
  const [r] = await sql`select u.training_opt_in as answer,
      coalesce(sum(c.active_minutes) filter (where c.channel = any(${OWN_CHANNELS}::text[])), 0)::int as minutes
    from users u left join user_channels c on c.user_id = u.id where u.id = ${userId} group by u.id`;
  return { answer: (r?.answer ?? null) as boolean | null, minutes: Number(r?.minutes ?? 0) };
}

/** The one-time question in the website chat: shown once they have used Kismet for a while and never answered. */
export async function trainingOffer(userId: string) {
  const s = await trainingState(userId);
  return shouldAsk(s.answer, s.minutes);
}

/**
 * Saves their answer (the chat card or Profile) in one statement, so the answer and its consent record can't part.
 * A change to yes is a training_data consent row, a change away from yes a training_data_withdrawn row (the current
 * answer is always users.training_opt_in); every answer is an activity row.
 */
export async function setTraining(userId: string, share: boolean, c: Client, from: "chat" | "profile") {
  await sql`with prev as (select training_opt_in as was from users where id = ${userId}),
    upd as (update users set training_opt_in = ${share}, training_answered_at = now() where id = ${userId} returning id)
    insert into consents (user_id, kind, version, channel)
      select ${userId}, case when ${share}::boolean then 'training_data' else 'training_data_withdrawn' end, ${TRAINING_VERSION}, ${c.channel}
      from prev, upd where (${share}::boolean and prev.was is not true) or (not ${share}::boolean and prev.was is true)`;
  await logActivity(userId, c, "training_share", { share, from });
}

/** Optional feedback typed into the question, contact details removed. The activity row holds only its id. */
export async function saveFeedback(userId: string, text: string, c: Client) {
  const [r] = await sql`insert into feedback (user_id, text, channel) values (${userId}, ${stripContacts(text)}, ${c.channel}) returning id`;
  await logActivity(userId, c, "feedback", { feedbackId: Number(r.id) });
}
