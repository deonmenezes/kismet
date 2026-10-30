// Secret double opt-in: what one resident may ever learn about a date. No imports (unit-tested directly).
//
// - A human hears about a finished date only from THEIR OWN agent, and only when it recommends meeting:
//   the other person, their own agent's reason and meetup idea, shared interests. Nothing else.
// - Never the other agent's verdict, score or reason, the other human's decision (yes, no or not yet),
//   the transcript, or the date's kind before a match. A date their own agent did not recommend is
//   never mentioned at all, and an answered recommendation disappears unless it became a match.
// - A match (both agents recommended AND both humans said yes) is revealed to both: Telegram, transcript.

export type SecretVerdict = { score: number; meet: boolean; reason: string; bestLine: string; suggestedMeetup: string };
export type SecretDate = {
  id: string;
  aId: string;
  bId: string;
  mode: "romance" | "friendly";
  status: "running" | "done";
  transcript: { speaker: "a" | "b"; text: string }[];
  verdictA: SecretVerdict | null;
  verdictB: SecretVerdict | null;
  decisionA: "meet" | "pass" | null;
  decisionB: "meet" | "pass" | null;
  matchedAt: string | null;
  finishedAt?: string | null;
  chatClosedAt?: string | null;
  createdAt: string;
  /** Weekly drop (lib/drop.ts): a date finished in weekly mode is held until it is released to that side. */
  held?: boolean;
  dropAAt?: string | null;
  dropBAt?: string | null;
  /** When each side was first shown it (records.ts markShown). */
  shownAAt?: string | null;
  shownBAt?: string | null;
};

export function mySide(d: SecretDate, meId: string) {
  const mine = d.aId === meId;
  return {
    verdict: mine ? d.verdictA : d.verdictB,
    decision: mine ? d.decisionA : d.decisionB,
    otherId: mine ? d.bId : d.aId,
  };
}

/** Both agents recommended meeting and both humans said yes. */
export const isMutual = (d: SecretDate) =>
  Boolean(d.verdictA?.meet && d.verdictB?.meet && d.decisionA === "meet" && d.decisionB === "meet");

/** A match whose conversation is still open (nobody unmatched, blocked or reported). Closed matches vanish for both. */
export const isOpenMatch = (d: SecretDate) => isMutual(d) && !d.chatClosedAt;

/**
 * Photos of `ownerId` may be shown to `viewerId` only when it is the viewer themself, the viewer's own agent
 * recommends the owner (an open recommendation), or the two are an open match. Never for a date the viewer's
 * agent did not recommend, an answered recommendation, the top pick, or anyone else. Visibility (blocks, bans)
 * is checked separately.
 */
export function canSeePhotos(dates: SecretDate[], viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return true;
  return dates.some((d) => {
    const pair = (d.aId === viewerId && d.bId === ownerId) || (d.bId === viewerId && d.aId === ownerId);
    return pair && (isRecommendation(d, viewerId) || isOpenMatch(d));
  });
}

/**
 * The one photo a view shows of `ownerId` (a card, a chat avatar), or null. Only when the viewer sees others' photos
 * at all yet (views.ts seesPhotos, passed in as `sees`) and canSeePhotos allows this person on these dates. The
 * caller has already left out blocked, banned and hidden people.
 */
export function visiblePhoto(dates: SecretDate[], viewerId: string, ownerId: string, photos: Map<string, { url: string }[]>, sees: boolean) {
  if (!sees || !canSeePhotos(dates, viewerId, ownerId)) return null;
  return photos.get(ownerId)?.[0]?.url ?? null;
}

/**
 * Weekly drop: held from `meId` until it was released to them as their drop, or they were already shown it (while
 * nothing was held). Per side: what one person saw never makes it visible to the other. A held date is never shown,
 * counted or answerable, so nothing hints at it. Dates from before weekly mode (or with it off) are never held.
 */
export function heldFrom(d: SecretDate, meId: string) {
  const mine = d.aId === meId;
  return Boolean(d.held) && !(mine ? d.dropAAt : d.dropBAt) && !(mine ? d.shownAAt : d.shownBAt);
}

/** A finished date this resident's own agent recommended and they have not answered yet (and that is not held). */
export function isRecommendation(d: SecretDate, meId: string) {
  const s = mySide(d, meId);
  return d.status === "done" && Boolean(s.verdict?.meet) && !s.decision && !heldFrom(d, meId);
}

/**
 * For ?since=<iso>: a recommendation is new once its date finished after `since` (a weekly drop: once it was
 * released to `meId`), a match once it matched after it. No since: everything counts. Invalid times never reach
 * here (the route answers 400).
 */
export function isNewSince(d: SecretDate, since?: string | null, meId?: string) {
  if (!since) return true;
  const t = Date.parse(since);
  // A weekly drop is new when they first saw it: released to them, or shown earlier (a recommendation they already had).
  const mine = meId ? d.aId === meId : null;
  const dropped = mine === null ? null : mine ? d.dropAAt : d.dropBAt;
  const shown = mine === null ? null : mine ? d.shownAAt : d.shownBAt;
  const seen = dropped && shown ? (Date.parse(shown) < Date.parse(dropped) ? shown : dropped) : dropped;
  const when = isMutual(d) ? d.matchedAt : (seen ?? d.finishedAt ?? d.createdAt);
  return Boolean(when) && Date.parse(when!) > t;
}

/** ?since= value: undefined when absent, false when not a valid time, else the time as ISO. */
export function parseSince(v: string | null | undefined): string | undefined | false {
  if (v === null || v === undefined || v === "") return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) && v.length <= 40 ? new Date(t).toISOString() : false;
}

/** Dates this resident started that are still running: a count, never who with. */
export const runningStarted = (dates: SecretDate[], meId: string) => dates.filter((d) => d.status === "running" && d.aId === meId).length;

export type PublicPerson = { name: string; summary: string; interests: string[] };

/** "My agent recommends you meet <name>": only this resident's own agent's view. */
export function recommendationView(d: SecretDate, meId: string, other: PublicPerson, sharedInterests: string[]) {
  const v = mySide(d, meId).verdict!;
  return {
    dateId: d.id,
    createdAt: d.createdAt,
    name: other.name,
    summary: other.summary,
    interests: other.interests.slice(0, 6),
    sharedInterests,
    myAgent: { score: v.score, reason: v.reason, suggestedMeetup: v.suggestedMeetup },
  };
}

export type MatchedPerson = { name: string; agentName: string; telegram: string };

/**
 * Only for a mutual match: the handle, the kind of date and the transcript, to both sides alike. Never the
 * other person's relationship status or openness (private, even to a match). No Telegram (they chose WhatsApp, or
 * have none): telegram "" and no link, never a bare "https://t.me/". telegram stays "" rather than null because
 * the App Store build interpolates it into a t.me URL, where null would become "t.me/null".
 */
export function matchView(d: SecretDate, meId: string, other: MatchedPerson, myAgentName: string) {
  const mine = d.aId === meId;
  return {
    dateId: d.id,
    name: other.name,
    telegram: other.telegram,
    link: other.telegram ? `https://t.me/${other.telegram}` : null,
    matchedAt: d.matchedAt ?? d.createdAt,
    kind: d.mode,
    myAgentName,
    theirAgentName: other.agentName,
    transcript: d.transcript.map((t) => ({ who: (t.speaker === "a") === mine ? ("mine" as const) : ("theirs" as const), text: t.text })),
  };
}
