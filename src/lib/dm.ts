import { isMutual, type SecretDate } from "./secret.ts";

// Direct messages, only between matched people (both agents and both humans said yes). A conversation is
// its match (the date row). Unmatch, block or report closes it for both with the same neutral notice, so
// nobody learns who ended it. Logic runs against an injected store (Neon in production, memory in tests).

export const MESSAGE_MAX = 1000;
export const PER_MINUTE = 30;
export const PER_DAY = 500;
export const ENDED = "This chat has ended.";

export type ChatDate = SecretDate & { readA: number; readB: number };
/** kind "agent": a line from the sender's own agent (lib/match-agents.ts), stored under its owner's id. */
export type Message = { id: number; senderId: string; text: string; createdAt: string; kind?: "human" | "agent" };
export type DmStore = {
  date(id: string): Promise<ChatDate | null>;
  /** A block either way, or either person banned or hidden. */
  blocked(aId: string, bId: string): Promise<boolean>;
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
  insert(dateId: string, senderId: string, text: string): Promise<Message>;
  list(dateId: string, afterId: number, limit: number): Promise<Message[]>;
  markRead(dateId: string, side: "a" | "b", upToId: number): Promise<void>;
  close(dateId: string): Promise<void>;
};

/** Control characters out (newlines and tabs stay); 1-1000 characters after trimming, else null. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim();
  return t && t.length <= MESSAGE_MAX ? t : null;
}

/** null: not this person's match (one answer for unknown, someone else's, or never matched: no probing). */
export function chatState(d: ChatDate | null, meId: string, blocked: boolean): "open" | "ended" | null {
  if (!d || (d.aId !== meId && d.bId !== meId) || !isMutual(d)) return null;
  return d.chatClosedAt || blocked ? "ended" : "open";
}

type Fail = { ok: false; status: number; error: string };
const notFound: Fail = { ok: false, status: 404, error: "No match with that matchId." };

async function load(store: DmStore, meId: string, matchId: string) {
  const d = await store.date(matchId);
  if (!d || (d.aId !== meId && d.bId !== meId)) return { d: null, state: null };
  const state = chatState(d, meId, await store.blocked(d.aId, d.bId));
  return { d, state };
}

const view = (m: Message, meId: string) => ({ id: m.id, mine: m.senderId === meId, agent: m.kind === "agent", text: m.text, createdAt: m.createdAt });

/** Messages after `afterId` (oldest first, up to 100) and marks them read. */
export async function readMessages(store: DmStore, meId: string, matchId: string, afterId = 0) {
  const { d, state } = await load(store, meId, matchId);
  if (!d || !state) return notFound;
  if (state === "ended") return { ok: true as const, ended: true, text: ENDED, messages: [] };
  const list = await store.list(matchId, Math.max(0, afterId), 100);
  const last = list.at(-1)?.id ?? 0;
  const side = d.aId === meId ? "a" : "b";
  if (last > (side === "a" ? d.readA : d.readB)) await store.markRead(matchId, side, last);
  return { ok: true as const, ended: false, messages: list.map((m) => view(m, meId)) };
}

export async function sendMessage(store: DmStore, meId: string, matchId: string, body: unknown) {
  const text = cleanText((body as { text?: unknown } | null)?.text);
  if (!text) return { ok: false, status: 400, error: `Send {"text": "..."} with 1-${MESSAGE_MAX} characters.` } as Fail;
  const { d, state } = await load(store, meId, matchId);
  if (!d || !state) return notFound;
  if (state === "ended") return { ok: false, status: 409, error: ENDED } as Fail;
  if (!(await store.hit(`dm-min:${meId}`, PER_MINUTE, 60)) || !(await store.hit(`dm-day:${meId}`, PER_DAY, 86400))) {
    return { ok: false, status: 429, error: "You're sending messages too fast. Try again in a bit." } as Fail;
  }
  const m = await store.insert(matchId, meId, text);
  await store.markRead(matchId, d.aId === meId ? "a" : "b", m.id);
  return { ok: true as const, message: view(m, meId) };
}

/** Ends the match for both: it leaves both match lists and the conversation closes. The other side sees only ENDED. */
export async function unmatch(store: DmStore, meId: string, matchId: string) {
  const { d, state } = await load(store, meId, matchId);
  if (!d || !state) return notFound;
  if (!d.chatClosedAt) await store.close(matchId);
  return { ok: true as const, ended: true, text: "Unmatched. You won't see each other again." };
}
