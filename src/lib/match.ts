import { cosineSimilarity } from "ai";
import type { DateRow, User } from "./db";

type Pairable = Pick<User, "id" | "relStatus" | "openness" | "gender" | "interestedIn" | "lookingFor">;

const attracted = (who: Pairable, to: Pairable) =>
  who.interestedIn === "everyone" ||
  (who.interestedIn === "men" && to.gender === "man") ||
  (who.interestedIn === "women" && to.gender === "woman");

const openness = (u: Pairable) => (u.openness === "mono" || u.openness === "poly" || u.openness === "open" ? u.openness : "unsure");

const opennessFits = (a: Pairable, b: Pairable) => {
  const x = openness(a);
  const y = openness(b);
  if (x === "unsure" || y === "unsure") return true;
  return x === "mono" ? y === "mono" : y !== "mono";
};

const available = (u: Pairable) => u.relStatus !== "relationship" && u.relStatus !== "married";

// Romance only between two people who both opted in, are available, attracted to each other and compatible on openness.
export function romanceCompatible(a: Pairable, b: Pairable) {
  return (
    a.lookingFor.includes("romance") &&
    b.lookingFor.includes("romance") &&
    available(a) &&
    available(b) &&
    attracted(a, b) &&
    attracted(b, a) &&
    opennessFits(a, b)
  );
}

const friendlyGoals = (u: Pairable) => u.lookingFor.filter((g) => g !== "romance");

// null = these two should not be sent on a date.
export function dateMode(a: Pairable, b: Pairable): "romance" | "friendly" | null {
  if (a.id === b.id) return null;
  if (romanceCompatible(a, b)) return "romance";
  if (friendlyGoals(a).length && friendlyGoals(b).length) return "friendly";
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Shared chips first, then shared extracted tags that aren't already covered by a chip.
export function sharedInterests(a: User, b: User) {
  const mine = new Map<string, string>();
  for (const s of [...a.interests, ...a.tags]) if (!mine.has(norm(s))) mine.set(norm(s), s);
  const out: string[] = [];
  for (const s of [...b.interests, ...b.tags]) {
    const k = norm(s);
    const covered = out.some((o) => norm(o).split(" ").some((w) => k.split(" ").includes(w)));
    if (mine.has(k) && !covered) out.push(mine.get(k)!);
  }
  return out.slice(0, 6);
}

// Interest similarity: profile embedding cosine plus small bonuses for shared chips and goals.
export function similarity(a: User, b: User) {
  let base: number;
  if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
    base = cosineSimilarity(a.embedding, b.embedding);
  } else {
    const A = new Set([...a.interests, ...a.tags].map(norm));
    const B = new Set([...b.interests, ...b.tags].map(norm));
    const inter = [...A].filter((x) => B.has(x)).length;
    base = A.size + B.size ? (0.6 * inter) / (A.size + B.size - inter || 1) + 0.2 : 0.2;
  }
  const sharedGoals = friendlyGoals(a).filter((g) => g !== "vibes" && b.lookingFor.includes(g)).length;
  const chips = sharedInterests(a, b).length;
  return Math.max(0, Math.min(1, base + 0.04 * sharedGoals + 0.02 * Math.min(chips, 5)));
}

export type Ranked = { user: User; mode: "romance" | "friendly"; sim: number; fit: boolean; score: number; date: DateRow | null };

// Dates below this similarity are skipped (tuned on text-embedding-3-small 256-d profile embeddings:
// good fits score 0.6-0.8, obvious mismatches 0.4-0.55). Without embeddings: at least one shared interest.
export const MIN_SIM = 0.55;

const isFit = (a: User, b: User, sim: number) =>
  a.embedding && b.embedding && a.embedding.length === b.embedding.length ? sim >= MIN_SIM : sharedInterests(a, b).length > 0;

/** Up to `room` candidates that are a fit, best first; if none is, still the single best one (if any). */
export function selectCandidates(ranked: Ranked[], room: number): Ranked[] {
  if (room <= 0 || !ranked.length) return [];
  const fits = ranked.filter((r) => r.fit).slice(0, room);
  return fits.length ? fits : ranked.slice(0, 1);
}

// A World ID verified person ranks a little higher (optional badge, never required).
export const VERIFIED_BOOST = 0.05;

// Combined score: similarity, blended with MY agent's chemistry score once they have dated, plus the small
// verified boost. Never the other agent's verdict: matching is secret until both sides said yes.
export function rank(me: User, others: User[], dates: DateRow[]): Ranked[] {
  const byOther = new Map<string, DateRow>();
  for (const d of dates) byOther.set(d.aId === me.id ? d.bId : d.aId, d);
  const out: Ranked[] = [];
  for (const u of others) {
    const mode = dateMode(me, u);
    if (!mode) continue;
    const sim = similarity(me, u);
    const date = byOther.get(u.id) ?? null;
    let score = sim;
    const mine = date ? (date.aId === me.id ? date.verdictA : date.verdictB) : null;
    if (mine) score = 0.4 * sim + 0.6 * (mine.score / 10);
    if (u.worldVerifiedAt) score = Math.min(1, score + VERIFIED_BOOST);
    out.push({ user: u, mode, sim, fit: isFit(me, u, sim), score, date });
  }
  return out.sort((x, y) => y.score - x.score);
}
