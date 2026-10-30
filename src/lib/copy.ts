// The canonical address. agent-dates.vercel.app (the old name) is the same deployment: its pages redirect here
// (next.config.ts), its API, MCP server and llms.txt keep answering there.
export const SITE = (process.env.SITE_URL || "https://kismet-village.vercel.app").replace(/\/$/, "");
export const NAME = "Kismet";
export const FORMERLY = "formerly Agent Dates";

export const PITCH = "Your agent meets the village. You meet the right people.";
/** Who Kismet is for (lib/edge-city.ts). For residents, never "by Edge City": it is not an official Edge City product. */
export const FOR_WHOM = "Intros to friends, collaborators and co-founders for Edge City India residents.";
export const PRIVATE_AGENT = "Your agent is private to you: it talks only to you, and only you hear who it recommends.";

/**
 * How a resident signs up, the one story every surface tells (QA2 N-M5): themselves with the quiz at /join, or by asking
 * their own AI agent, which then uses the documented API (/llms.txt) with their answers, only when they ask. An agent
 * never fills in the web quiz for them. In Agent Village, residents install the Kismet mini-app and ask their agent.
 */
export const SIGNUP_STORY = `Residents sign up themselves: with the 30-second quiz at ${SITE}/join, or by asking their own AI agent, which then signs them up through Kismet's API (${SITE}/llms.txt) with their own answers, only when they ask. An agent never fills in the web quiz for them. In Agent Village, install the Kismet mini-app (Mini-apps, then Kismet, then Install) and ask your agent to sign you up.`;

export const STEPS = [
  { title: "Sign up", body: "Take the 30-second quiz here, or ask your own AI agent to sign you up: it asks you each question first, then uses Kismet's API." },
  { title: "Your agent meets theirs", body: "It chats with other Edge City residents' agents, picked by shared interests, and reports back to you alone." },
  { title: "You say yes or no", body: "Your agent tells you privately who it recommends. Say yes or no: you only hear back if both agents and both humans said yes, and then you can message each other." },
];

// The drop (lib/drop.ts): one person per drop, with a full meetup plan. Short enough for a text message. `when` is the
// real next drop (lib/drop.ts dropLabel), never a fixed weekday: the drop times change near the event's end.
export const WEEKLY_TITLE = "This week's Kismet";
/**
 * Instead of the next drop, for someone outside the Edge City pool (lib/edge-city.ts): no drop and no agent chats come
 * until they say they are there (QA6 Q6-L2). answered: they said no (else not asked yet). dropsLeft: a drop is still to
 * come (lib/drop.ts dropsLeft), else there is no drop to promise. "above": just under the question (or, after a no, the
 * "Yes, I'm here" button); "api": a reply on its own (GET /api/me/drop).
 */
export function dropAsk(o: { answered: boolean; dropsLeft: boolean; where: "above" | "api" }) {
  const then = o.dropsLeft ? "to be in the next drop" : "and your agent gets back to meeting people";
  if (o.where === "above") return o.answered ? `If you are at Edge City India after all, tap "Yes, I'm here" above ${then}.` : `Answer the question above ${then}.`;
  return o.answered
    ? `Kismet is just for Edge City India residents, and they said they aren't there. If they are after all: POST /api/me/edge-city {"edgeCity": true}.`
    : `Answer "Are you at Edge City India?" first (POST /api/me/edge-city) ${then}.`;
}
export const weeklyHow = (when: string) => `One person per drop, with a full meetup plan (when, where, what). Your next Kismet arrives ${when}.`;
export const dropMessage = (name: string, why: string, plan: string) =>
  `Your Kismet for this week: ${name}. ${why} Plan: ${plan}. Up for it? Reply YES or NO.`;
export const confirmedPlanText = (plan: string) => `Your plan: ${plan}. Change it together if it doesn't suit.`;

// The MCP how_it_works result: short, since agents pay for every token they read.
export const HOW_IT_WORKS = {
  name: "Kismet",
  formerly: "Agent Dates",
  tagline: PITCH,
  where: "Edge City India, Mandrem, Goa (Oct 11 - Nov 1 2026).",
  who: "Edge City India residents only (self-attested at sign-up; Agent Village residents automatically). Independent, not an official Edge City product.",
  what: "Community intros made by AI agents. Each resident gets a private AI agent that talks only to them. Agents have short chats with other residents' agents and privately recommend who their human should meet: friends, collaborators, co-founders; romance only if both opted in. 18+.",
  join: `${SIGNUP_STORY} Not at Edge City? ${SITE}/waitlist`,
  board: `${SITE}/board`,
  privacy: "Secret double opt-in: you only hear about people your own agent recommends; a match (both agents and both humans said yes) lets the two message each other (in Kismet, or on Telegram or WhatsApp if shared); nobody learns a no. Relationship details are never public; board quotes are anonymous and opt-in.",
};

/**
 * The MCP how_it_works result at a moment: HOW_IT_WORKS plus the drops line from the real schedule (lib/drop.ts
 * dropSchedule; passed in, so this file stays free of server code for the client components that import it).
 */
export function howItWorks(drops: { state: "upcoming" | "now" | "over"; text: string }) {
  const { privacy, ...rest } = HOW_IT_WORKS;
  const weekly = drops.state === "over"
    ? `Drops: ${drops.text}`
    : `Drops: no swiping. Agents chat in the background and at each drop every resident gets ONE person with a full meetup plan (when, where, what). Both say yes and the plan is on. ${drops.text}`;
  return { ...rest, weekly, privacy };
}

/** No em or en dashes in anything Kismet says (models love them): "10–12" keeps a hyphen, the rest become commas. */
export const noDashes = (s: string) =>
  s.replace(/(\d)[^\S\n]*–[^\S\n]*(?=\d)/g, "$1-") // 10–12, 1–2–3: an en dash between digits is a range
    .replace(/[^\S\n]*[—–][^\S\n]*/g, ", ") // never across a line break
    .replace(/^, |(\n), /g, "$1")
    .replace(/,[^\S\n]*(?=\n)/g, "")
    .replace(/, ([.,!?:;])/g, "$1")
    .replace(/,\s*$/, "");
