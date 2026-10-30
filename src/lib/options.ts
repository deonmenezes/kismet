// Shared option lists (safe for client and server).

export const REL_STATUS = [
  { id: "single", label: "Single" },
  { id: "relationship", label: "In a relationship" },
  { id: "married", label: "Married" },
  { id: "complicated", label: "It's complicated" },
  { id: "undisclosed", label: "Prefer not to say" },
] as const;

export const OPENNESS = [
  { id: "mono", label: "Monogamous" },
  { id: "poly", label: "Polyamorous" },
  { id: "open", label: "Open relationship" },
  { id: "unsure", label: "Not sure" },
  { id: "undisclosed", label: "Prefer not to say" },
] as const;

export const LOOKING_FOR = [
  { id: "romance", label: "Romance" },
  { id: "friends", label: "Friends" },
  { id: "collaborators", label: "Collaborators" },
  { id: "cofounder", label: "Co-founder" },
  { id: "adventure", label: "Adventure buddy" },
  { id: "vibes", label: "Just vibes" },
] as const;

export const GENDER = [
  { id: "man", label: "A man" },
  { id: "woman", label: "A woman" },
  { id: "nonbinary", label: "Non-binary" },
] as const;

export const INTERESTED_IN = [
  { id: "men", label: "Men" },
  { id: "women", label: "Women" },
  { id: "everyone", label: "Everyone" },
] as const;

// When someone is usually free for a date (the weekly drop's plan picks a time that fits both). Not private, optional.
export const AVAILABILITY = [
  { id: "weekday_evenings", label: "Weekday evenings" },
  { id: "weekends", label: "Weekends" },
  { id: "flexible", label: "Flexible" },
] as const;

export const INTEREST_CHIPS = [
  "AI", "Crypto", "Startups", "Building/hacking", "Content creation", "Music", "Art",
  "Fitness", "Yoga/wellness", "Surfing/beach", "Travel", "Food", "Books", "Philosophy",
  "Science", "Spirituality", "Parties", "Nature", "Gaming", "Photography",
];

export const AGENT_PROMPT =
  "Write my Kismet profile in under 150 words: who I am, what I'm building or exploring, what I want from Edge City India, my vibe, and who I'd love to meet. First person, honest, no contact details.";

export type RelStatus = (typeof REL_STATUS)[number]["id"];
export type Openness = (typeof OPENNESS)[number]["id"];
export type LookingFor = (typeof LOOKING_FOR)[number]["id"];
export type Gender = (typeof GENDER)[number]["id"];
export type InterestedIn = (typeof INTERESTED_IN)[number]["id"];
export type Availability = (typeof AVAILABILITY)[number]["id"];

export const label = (list: readonly { id: string; label: string }[], id: string | null | undefined) =>
  list.find((o) => o.id === id)?.label ?? "";

/** The quiz's Telegram step: a handle, or empty where the account may go without one (lib/validate.ts telegramOptionalFor). */
export const telegramStepOk = (v: string, optional = false) => /^@?[A-Za-z0-9_]{4,32}$/.test(v.trim()) || (optional && !v.trim());

// The quiz answers / editable profile, as sent by the client.
export type ProfileInput = {
  name: string;
  relStatus: RelStatus;
  openness: Openness | null;
  lookingFor: LookingFor[];
  gender: Gender | null;
  interestedIn: InterestedIn | null;
  interests: string[];
  bio: string;
  telegram: string;
  agentProfile: string;
  agentName: string;
  agentPersonality: string;
  publicQuotes: boolean;
  /** The person's OWN X username (optional). */
  xHandle: string;
  /** Opt-in: use their own X profile picture as a photo. */
  useXPhoto: boolean;
  /** Optional: when they are usually free for a date. Left out = unchanged (a new account: flexible). */
  availability?: Availability;
  /** Optional: where they are staying (a village or city). Left out = unchanged. */
  area?: string;
  /** "Are you at Edge City India?" (lib/edge-city.ts). Left out = unchanged (a new account: not asked yet). */
  edgeCity?: boolean;
  /** Optional: which weeks of Edge City India (week1, week2, week3). Left out = unchanged. */
  edgeWeeks?: string[];
};
