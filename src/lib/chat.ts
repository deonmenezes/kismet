import type { MeView } from "./views";
import { confirmedPlanText, weeklyHow } from "./copy.ts";

// Chat-ready plain text an agent can relay to its owner as-is. Kept short: agents pay for every token.

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The optional World ID offer: a short-lived one-time link. Never a requirement. */
export const verifyOfferText = (link: string) =>
  `Optional: verify with World ID for a ✓ badge your matches see (and a small boost in matching). One-time link, expires within 15 minutes: ${link}`;

// Without a link (Agent Village partner sign-ups), no web credential is issued or shown.
export function signupText(name: string, link?: string) {
  return [
    `You're in, ${name}! Your agent is signed up for Kismet.`,
    link ? `Private link (keep it secret, it signs you in on the web): ${link}` : "",
    `Start your agent's first chats now? (up to 3 a day)`,
  ].filter(Boolean).join("\n");
}

export const profileUpdatedText = (name: string) => `Updated your Kismet profile, ${name}. New agent chats will use it.`;

export const notSignedUpText = "You're not signed up for Kismet yet. Want me to sign you up? It's a short quiz.";

// Terse plain lines an agent can relay as-is (no markdown, no emoji): typically under 600 characters.
export function summaryText(me: MeView): string {
  for (const n of [3, 2, 1]) {
    const t = buildSummary(me, n);
    if (t.length <= 900) return t;
  }
  return buildSummary(me, 1).slice(0, 900);
}

const v = (p: { worldVerified: boolean }) => (p.worldVerified ? " (verified)" : "");
const shares = (s: string[], n: number) => (s.length ? ` - shares ${s.slice(0, n).join(", ")}` : "");

function buildSummary(me: MeView, maxRecs: number) {
  const out: string[] = [];
  const outside = Boolean(me.edgeCity && !me.edgeCity.member);
  // Out of the Edge City pool (lib/edge-city.ts): the one thing to ask (or tell) their human comes first. Pollers
  // (?since=) get the question too, since nothing new comes until it is answered; a "no" is told only without since.
  const asked = outside && me.edgeCity.question && (!me.since || !me.edgeCity.answered);
  if (asked) {
    out.push(me.edgeCity.answered ? me.edgeCity.question! : `Ask your human first: ${me.edgeCity.question} (then POST /api/me/edge-city {"edgeCity": true|false}).`);
  }
  if (me.since) out.push(`New since ${me.since}:`);
  if (me.matches.length) {
    out.push("Matches (both said yes):");
    for (const m of me.matches.slice(0, 3)) out.push(`- ${m.name}${v(m)}: ${m.contact?.text ?? `t.me/${m.telegram}`}${m.plan ? `. Plan: ${m.plan.text}` : ""}`);
  }
  // Unread counts only: never message text (the owner can ask for the messages explicitly).
  for (const m of me.matches.filter((x) => x.unread > 0).slice(0, 3)) {
    out.push(`${m.unread} unread message${m.unread > 1 ? "s" : ""} from ${m.name} (matchId ${m.dateId})`);
  }
  const recs = me.recommendations;
  if (recs.length) {
    out.push("Your agent recommends meeting (ask yes/no; private, they hear back only if mutual):");
    for (const r of recs.slice(0, maxRecs)) {
      const why = r.myAgent.reason ? `. Why: ${clip(r.myAgent.reason, 100)}` : "";
      const meet = r.plan ? `. This week's Kismet, plan: ${r.plan.text}` : r.myAgent.suggestedMeetup ? `. Meetup: ${clip(r.myAgent.suggestedMeetup, 60)}` : "";
      const photo = r.photos.length ? " (has a photo)" : "";
      out.push(`- ${r.name}${v(r)}${photo}${shares(r.sharedInterests, 3)}${why}${meet}. dateId ${r.dateId}`);
    }
    if (recs.length > maxRecs) out.push(`+${recs.length - maxRecs} more (GET /api/me).`);
  }
  if (me.running) out.push(`Running: ${me.running} agent chat${me.running > 1 ? "s" : ""}, check back in a minute.`);
  const t = me.topPick;
  if (t && !t.recommended && !me.since) out.push(`Top pick to chat with next: ${t.name}${v(t)} ${t.percent}%${shares(t.sharedInterests, 3)}. targetId ${t.targetId}`);
  if (!out.length || (me.since && out.length === 1)) out.push(me.since ? "Nothing new." : "Nothing new yet. Send your agent to meet people?");
  if (me.weekly && !recs.length && !me.since) out.push(`Weekly drop: ${weeklyHow(me.weekly.label)}`);
  if (me.worldId.verifyLink) out.push(`Optional World ID verified badge, one-time link (15 min): ${me.worldId.verifyLink}`);
  // Outside the pool there are no agent chats and no drop to promise (QA6 Q6-L2): only what gets them in.
  if (!outside) out.push(`${me.datesLeftToday}/${me.datesPerDay ?? 3} agent chats left today.`);
  else if (asked && !me.edgeCity.answered && me.dropAsk) out.push(me.dropAsk); // a "no" was just told about the waitlist
  return out.join("\n");
}

export function decideText(name: string, decision: "meet" | "pass", match: { telegram: string; contact?: { text: string } } | null, plan: string | null = null) {
  if (decision === "pass") return `Okay, I won't bring up ${name} again. They'll never know.`;
  if (match) return `It's a match! You and ${name} both said yes (and so did your agents). Message them: ${match.contact?.text ?? `t.me/${match.telegram}`}${plan ? `
${confirmedPlanText(plan)}` : ""}`;
  return `Noted, privately. If ${name} says yes too, I'll tell you and how to reach them. Otherwise you won't hear about it again.`;
}

/** "What your agent knows about you": the notes as plain lines, ids for deleting one. */
export function notesText(notes: { id: string; text: string }[]) {
  if (!notes.length) return "Your agent hasn't saved anything about you yet.";
  return [
    `What your agent knows about you (${notes.length}, private: other agents only see a short summary):`,
    ...notes.slice(0, 20).map((n) => `- ${n.text} (id ${n.id})`),
    ...(notes.length > 20 ? [`+${notes.length - 20} more.`] : []),
    "Say which to forget, or \"forget everything\".",
  ].join("\n");
}
