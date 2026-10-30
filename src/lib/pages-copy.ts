// The text of the Support, Privacy, Terms and waitlist pages, and the sign-up quiz's lines about who Kismet is for, in
// two variants from one source: the website's (names Edge City India) and the neutral one the store apps open under
// /app/* (names no event, place or partner: "the village", "residents' own AI agents"). Only the community naming
// differs; the legal substance, contact, data practices and Terms version are the same text. pages-copy.test.mjs checks
// the neutral variant names none of them and the website's is unchanged.
//
// Inline markup (parseRich below, rendered by components/rich.tsx): [label](href) is a link (mailto: and http(s) open as
// plain links, the rest as in-site links; no "]" in a label, no ")" or space in an href), `code` is code. Plain Unicode
// for the typography (“ ” ·).

import { EDGE_CITY } from "./edge-city.ts";
import { AGENT_PROMPT } from "./options.ts";

export const CONTACT = "deon.menezes@virelity.com";
/** The Terms' "Last updated" (all three pages): records.ts TERMS_VERSION, the version a sign-up agrees to (test-checked). */
export const UPDATED = "October 29, 2026";

/** What the neutral pages may never say (case-insensitive): the event, its place, its agent platform and calendar. */
export const NEUTRAL_BANNED = /edge\s*city|edgeos|mandrem|\bgoa\b|agent\s*village/i;

export type Block = { p: string } | { h2: string } | { ul: string[] } | { faq: [string, string][] };
export type Inline = string | { code: string } | { label: string; href: string };

const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
/** A text's plain runs, links and code. */
export function parseRich(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[3] !== undefined ? { code: m[3] } : { label: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export type Doc = { title: string; updated: string; blocks: Block[] };

/** The address of a sibling page: /privacy on the website, /app/privacy in the neutral variant. */
export const pagePath = (neutral: boolean, path: string) => (neutral ? `/app${path}` : path);

const mail = `[${CONTACT}](mailto:${CONTACT})`;

/** The website's naming, or the neutral one. */
const pick = (neutral: boolean) => (site: string, app: string) => (neutral ? app : site);

export function support(neutral: boolean): Doc {
  const v = pick(neutral);
  const link = (path: string) => pagePath(neutral, path);
  return {
    title: "Support",
    updated: UPDATED,
    blocks: [
      { p: `Email ${mail}. We answer within a day, and review safety reports within 24 hours.` },
      { h2: "FAQ" },
      {
        faq: [
          ["Who is Kismet for?", v(
            `People at Edge City India in Mandrem, Goa (October 11 to November 1, 2026), and only them for now. Kismet asks once whether you are there; only Edge City residents are paired for agent chats, recommended or shown. Not there? [Join the waitlist](${link("/waitlist")}). Kismet is independent, made for Edge City residents, not an official Edge City product.`,
            `The residents of one village, and only them for now, so everyone it suggests is someone you can meet in person. Kismet asks once whether you live in the village; only its residents are paired for agent chats, recommended or shown. Not there? [Join the waitlist](${link("/waitlist")}). Kismet is independent, not an official product of the village or its organisers.`,
          )],
          ["Is my agent private?", "Yes. Your agent talks only to you: other residents never see your chat with it, and only you hear who it recommends. In its chats with other agents it brings a short card about you, never your private answers or contact."],
          ["How does it work?", "Your AI agent has short chats with other residents' agents and privately recommends people to meet: friends, collaborators, co-founders. Say yes or no; you hear back only if both of you said yes, and then you can message each other in the Kismet app or website, or on their Telegram or WhatsApp if they shared one."],
          ["What about romance?", "Kismet is mostly for meeting friends, collaborators and co-founders. Romance is opt-in: your agent only suggests it between two people who both picked Romance and fit what each is open to, and those answers stay private."],
          ["Who can see my answers?", `Relationship status, openness, gender and who you're interested in are private. See the [Privacy Policy](${link("/privacy")}).`],
          ["How do I report or block someone?", "In the Kismet app, tap the “···” on their card, match or chat, then Report or Block. On the website, use Report or Block on a recommendation or match on your home page. Or ask your own agent. They are never told, and reporting also blocks them for good."],
          ["How do I delete my account?", `In the Kismet app: Me, then Delete account. On the website: your home page, “Delete my account”. If you use Kismet on WhatsApp: text DELETE ME. Or ask your agent. Everything is deleted immediately, except reports other people made about you, which we keep for up to 12 months with your contacts only as one-way hashes (see the [Privacy Policy](${link("/privacy")})).`],
          ["What does my agent know about me?", "Facts your agent saved about you are listed at `GET /api/me/notes` (ask your agent “what do you know about me?”). Ask it to forget one or all of them, or use `DELETE /api/me/notes`."],
          // The sign-in page names the event, so the neutral variant does not link it (the apps sign in on their own).
          ["I lost my private link.", `If you ever signed in with Google or an emailed code, ${v("[sign in](/sign-in)", "sign in")} the same way again: it opens the same account, no link needed. Otherwise email us from the address or Telegram you can prove is yours and we'll help. A private link that goes unused for 90 days stops working, and a sign-in in a browser lasts 30 days, then you sign in again.`],
          ["Why didn't my agent chat with anyone?", "Up to 3 agent chats a day in all (so at most 3 new people a day), never the same person twice, and only with people who are a reasonable fit."],
        ],
      },
    ],
  };
}

export function privacy(neutral: boolean): Doc {
  const v = pick(neutral);
  // Agent Village: the event's own agent platform, where residents already have an AI agent.
  const platform = v("Agent Village", "the village's own agent platform");
  const platformKey = v("Agent Village key", "village agent platform key");
  return {
    title: "Privacy Policy",
    updated: UPDATED,
    blocks: [
      { p: `Kismet (formerly Agent Dates) is run by Virelity Inc. for ${v("Edge City India residents", "the residents of the village it serves")}. This page says what we store, why, who processes it, how long we keep it and how to delete it. Questions: ${mail}.` },
      { h2: "What we store" },
      {
        ul: [
          v(
            "Whether you are at Edge City India (your own answer, and which weeks if you said), since Kismet is only for its residents right now. Agent Village sign-ups count as residents. So do sign-ups from our iPhone, iMessage and Android apps that leave the question out (those apps don't ask it yet): they are recorded as at Edge City without an answer from you, until you answer it yourself. Not there? Tell Kismet or your agent, and you are taken out at once.",
            "Whether you live in the village (your own answer, and which weeks if you said), since Kismet is only for its residents right now. Sign-ups from the village's own agent platform count as residents. So do sign-ups from our iPhone, iMessage and Android apps that leave the question out (those apps don't ask it yet): they are recorded as in the village without an answer from you, until you answer it yourself. Not there? Tell Kismet or your agent, and you are taken out at once.",
          ),
          "Your quiz answers: name, relationship status, openness, what you are looking for, gender and who you are interested in (only if you chose Romance), interests, your one-line bio.",
          "Profile text you or your agent add (up to 1,500 characters), your agent's name and personality line, and a short summary (“persona card”) and interest tags we generate from it.",
          `The history of your profile: when you or your agent change an answer, we keep the previous value, the new value, the time and where the change came from (web, app, ${platform} or your agent).`,
          `What your agent knows about you: short facts your agent (${v("in Agent Village", "on the village's own agent platform")}, our apps or your own agent) saves about you, up to 50, with when and from where. They are private to you, are only used to write your persona card, and you can see and erase them at any time (\`GET\` / \`DELETE /api/me/notes\`, or ask your agent).`,
          "Your signals: wants you state in the chat in your own words (“a co-founder for an AI music app”), up to 5 active. Kismet saves only your own words, never its paraphrase. They are private: they shape your agent's card and who it looks for, and you can list, pause or drop them anytime (SIGNALS).",
          "Your agent's own box: your agent can run in its own isolated sandbox at Daytona (a cloud sandbox provider), with all network access blocked. It holds only your agent card (never your contact details, relationship status, gender or who you're into) and your agent's memory of its past agent chats (topics and scores, never anyone's name). In an agent chat, each agent sees only its own card and what the other agent says. The box is deleted with your account.",
          "Your Telegram username, and your X username if you add it.",
          "If you use Kismet by text on WhatsApp: your phone number, our conversation (your messages and Kismet's replies), whether you paused or opted out (STOP), and when you last messaged us (WhatsApp lets us reply freely only within 24 hours of your last message). Your number is shared with a match only if you chose that during sign-up or with “EDIT contact phone”; otherwise matches get your Telegram.",
          "Photos you add (up to 3): uploads, your own X profile picture if you link your X username and opt in, or the profile picture of your Google sign-in if you tap “Use it” when Kismet asks (once; never added without asking). We re-encode them and remove EXIF and location data. Each photo is checked by an AI model (through the Vercel AI Gateway) for nudity, minors and violence before it is stored.",
          "Messages you send to your matches in Kismet.",
          "An embedding (a list of numbers) computed from your profile, used to rank who your agent chats with.",
          "Your agent chats: the chat transcripts your agent had, each agent's private verdict, which AI model wrote it, when each recommendation was first shown to you, your yes/no answers, matches, blocks and reports.",
          `If someone reports you: their report (the reason and their note) and a one-way hash of each of your contacts (Telegram username, phone number, sign-in email, ${platformKey}), never the contacts themselves. The hashes are made with a secret key that only Kismet's servers hold; they only let us see when an account (a new one, or one that changes its contact) uses the same contact (see Deletion).`,
          `How you signed up and use Kismet: the channel you signed up from (web, iPhone app, iMessage, Android, ${platform} or your own agent) and the app version if the app sends it; your 18+ confirmation and agreement to the Terms, with the Terms version and time; and when you were last seen on each channel.`,
          "An activity log of what you do in Kismet: sign-up, sign-in, profile edits (which fields changed), agent chats started, recommendations shown, your yes/no answers, matches, unmatches, blocks, reports, messages sent, photos added or removed, agent notes added or erased, World ID verification. Each entry has the time, the channel and small details such as ids (of the agent chat, message or photo). It never contains message text, profile text or photos.",
          "Salted hashes of IP addresses (never the raw IP), for rate limits and daily caps, deleted after a few days.",
          "If you verify with World ID (optional, only when it is available): the World ID nullifier for this app, the credential type and the time. No biometrics or World ID account data.",
          "A hashed sign-in token. Your private link and token are shown once and never stored in readable form. A private link (and its API token) that goes unused for 90 days stops working; a sign-in in a browser lasts 30 days, then you sign in again.",
          "If you sign in on the website with Google or an emailed code: your email address and name from that sign-in, kept by our sign-in provider Neon Auth (in our own database) and linked to your Kismet account, plus the chat with Kismet on the website (your messages and Kismet's replies; anything about other residents is stored only as a reference to the agent chat). Your email is never shown to other residents. Google tells us only your name, email and profile picture.",
          "If you use the website chat: whether Kismet asked you, about a day after a match, if you met, and your answer (met, not useful, missed). It is in your own activity log only; your match never sees it. Kismet also posts a short daily summary (counts only) in your chat.",
          "How long you have used Kismet, in minutes per channel (on the website only while its tab is visible; a break longer than 5 minutes isn't counted). Your own agent's use of the API doesn't count toward it. After about 90 minutes, Kismet asks you once whether you want to help improve it (below). We keep your answer, every change to it with the time, and any feedback you typed with it (contact details removed). Feedback is read by our staff to improve Kismet, whatever you answered.",
        ],
      },
      { h2: "Who sees what" },
      {
        ul: [
          "Your agent is private to you: it talks only to you. Other residents never see your conversation with it, and only you hear who it recommends.",
          v(
            "Only Edge City India residents are paired for agent chats, recommended or shown to each other. If you say you are not at Edge City, or have not answered yet, nobody is recommended to you and you are recommended to nobody (matches you already made stay).",
            "Only village residents are paired for agent chats, recommended or shown to each other. If you say you don't live in the village, or have not answered yet, nobody is recommended to you and you are recommended to nobody (matches you already made stay).",
          ),
          "Private, never shown to other residents: relationship status, openness, gender, who you are interested in, your full profile text, what your agent knows about you, your profile history, activity log and your Telegram (until a mutual match).",
          "Other residents can see your name and your own answers about yourself (your one-line bio, what you are here for and your interests; “romance” only on a romance intro, where you both opted in), and shared interests, only when their agent recommends you. They can also ask Kismet about those answers, and nothing else.",
          "Your Telegram username and the agent chat transcript are revealed only to a mutual match (both agents and both humans said yes).",
          "Your photos are shown only to people your agent recommends you to and to your matches, in a private store behind sign-in. Never on the public board, never to anyone else.",
          "Messages are visible only to you and that match. Unmatching, blocking or reporting ends the chat for both; its messages are deleted 30 days later.",
          "Kismet in a match chat is opt-in: Kismet asks each of you once per match, and joins only if you both say yes. Then your agents act as one shared helper: an AI model reads the recent messages and Kismet steps in only when it helps (a stalled chat, a plan that won't land, or when you ask it), with a line shown to both of you and marked as Kismet. The model sees only first names, your own public answers, a plan you both confirmed, your agents' chat (which you can both already read, and which was written from what your agents knew about you) and the recent messages: never contact details, anything you marked private, notes or signals. Nothing from the chat is saved to your agent's memory or used in other agent chats. Either of you can take Kismet out at any time, which stops it reading and writing at once.",
          "Helping improve Kismet is optional and off unless you say yes (Kismet asks once, after about 90 minutes of use; change it any time in Profile). If you say yes, we may use your chats with Kismet and your agent's chats with other agents to find what isn't working and to improve and train Kismet's models. We don't use anyone's data this way yet; when we do, names, contact details and photos are taken out first, an agent chat is used only if both people said yes, and nothing is shared with other residents or sold. Only you can turn it on, in your own browser, never your agent. Saying no changes nothing about how Kismet works for you. Turning it off keeps your data out of anything we build or train after that.",
          "Nobody learns another person's verdict or a “no”. The public board shows anonymous lines only from agent chats where both people opted in.",
          "Our admins (Virelity staff) can see account records (profiles, sign-up source, consents, profile history, agent notes, last seen and the activity log) to run and support the service, and read reports to moderate. They do not read your messages.",
        ],
      },
      { h2: "Processing by AI providers" },
      { p: `Agent chats, persona cards and tags are written by AI models: DeepSeek V4.1 Flash and Google Gemini 3.5 Flash Lite hosted by GMI Cloud, and, when those are unavailable, Anthropic's Claude through the Vercel AI Gateway. Embeddings come from OpenAI's embedding model and the photo check from Anthropic's Claude, both through the Vercel AI Gateway. Only the text needed for a request is sent (persona cards for agent chats; profile text and agent notes when your card is written; a small copy of a photo for the check). Data is hosted on Vercel and Neon (Postgres). Village event suggestions come from ${v("Edge City's public event calendar (EdgeOS)", "the village's public event calendar")}; we only read that public feed and send nothing about you to it. If you link your X username and opt in to its picture, we fetch your public X profile picture through FxTwitter (api.fxtwitter.com) or, when that fails, unavatar.io; they receive only your X username. Kismet-by-text messages are carried by Meta's WhatsApp Business Platform (Cloud API), and the conversation is read by the same AI models to understand your answers. We do not sell data or use it for advertising.` },
      { h2: "How long we keep it" },
      { p: "Everything above is kept while your account exists, unless a shorter time is stated here: messages of ended chats are deleted 30 days after the chat ended, IP hashes after a few days, one-time verify links within a day, WhatsApp link codes after 15 minutes, and a WhatsApp sign-up that was never finished 30 days after its last message. Agent notes keep the newest 50. When you delete your account, all of it goes at once, except reports other people made about you, which we keep for up to 12 months (see Deletion)." },
      { h2: "Deletion" },
      { p: "Delete your account any time: on your home page (“Delete my account”), by asking your agent, by texting “DELETE ME” to Kismet on WhatsApp (that also deletes the conversation), or with `DELETE /api/me`. This immediately and permanently deletes your profile and its history, your agent chats, matches, messages and photos, your sign-in (your Google or email sign-in too), what your agent knows about you, your consent records, channels and activity log, blocks you made, your World ID link and your waitlist entry if it has your sign-in email. If a photo file, your sign-in or your agent's box can't be deleted at that moment (the provider is down), we retry every day until it is gone; until then it is not linked to any account." },
      { p: `What we keep, for safety: reports other people made about you (and, if we banned you, a record of the ban), for up to 12 months after you delete your account, with a one-way hash of each of your contacts (Telegram username, phone number, sign-in email, ${platformKey}) instead of the contacts. The hashes are made with a secret key that only Kismet's servers hold. We take your name, usernames, contact details and photos out of those reports. The hashes let us tell when an account uses one of the same contacts, so someone who was banned, or reported by several people, can't delete their account and rejoin with a clean record: an account with the same phone number, sign-in email or ${platformKey} is hidden from others until we review it. A matching Telegram username alone never hides anyone (anyone can type a username); we only look at it. After 12 months these reports are deleted. Also kept: reports you made (without your identity), salted counters with no user id, and one anonymous log entry that an account was deleted (the time and channel only). You can also email us to delete your data.` },
      { h2: "Waitlist" },
      { p: `If you join the waitlist we store your email, and anything optional you add (name, where you are, Instagram or X handle, interests, which platforms you would use), your referral code and who referred you, the channel you joined from, a salted hash of your IP address (for rate limits), the time and an activity log entry. We use it only to email you when Kismet opens for you. To be removed, use the one-time removal link shown when you joined (this deletes the entry and its log entry), or email ${mail}.` },
      { h2: "Age" },
      { p: "Kismet is for adults (18+) only. We delete accounts we learn belong to anyone younger." },
    ],
  };
}

export function terms(neutral: boolean): Doc {
  const v = pick(neutral);
  return {
    title: "Terms of Use",
    updated: UPDATED,
    blocks: [
      { p: `By signing up for Kismet (formerly Agent Dates; on the web, through an app, or through your AI agent) you agree to these terms. Kismet is run by Virelity Inc. Contact: ${mail}.` },
      { h2: "Who can use it" },
      {
        ul: [
          "You must be 18 or older.",
          v(
            "Kismet makes introductions between people at Edge City India (Mandrem, Goa, October 11 to November 1, 2026): friends, collaborators and co-founders, and romance only between two people who both opted in to it. It is only for them right now. You tell us at sign-up that you are there; only Edge City India residents are paired for agent chats, recommended or shown to each other. Everyone else can join the waitlist. Kismet is an independent service made for Edge City India residents; it is not an official Edge City product.",
            "Kismet makes introductions between the residents of one pop-up village: friends, collaborators and co-founders, and romance only between two people who both opted in to it. It is only for them right now. You tell us at sign-up that you live there; only its residents are paired for agent chats, recommended or shown to each other. Everyone else can join the waitlist. Kismet is an independent service; it is not an official product of the village or its organisers.",
          ),
          "One account per person. Give honest answers; don't impersonate anyone.",
        ],
      },
      { h2: "Zero tolerance for objectionable content and abusive users" },
      {
        ul: [
          "No harassment, threats, hate, bullying or discrimination.",
          "No sexually explicit, violent or otherwise objectionable content in your profile, names or anything you send.",
          "No spam, scams, advertising, fake profiles or attempts to collect other people's contact details.",
          "Don't try to manipulate other residents' agents (for example, instructions hidden in your profile).",
        ],
      },
      { p: "We may remove content, hide profiles and ban accounts that break these rules, without notice. We review reports promptly (within 24 hours) and act on objectionable content by removing it and banning the user who posted it." },
      { h2: "Reporting and blocking" },
      { p: `Report or block anyone you were shown: on your home page (“Report” / “Block”), in the app, by asking your agent, or with \`POST /api/me/report\` and \`POST /api/me/block\`. A block is silent and works both ways: you will not be matched or recommended to each other again. Reporting also blocks the person. Someone reported by several people is hidden right away until we review them. You can also email ${mail}.` },
      { p: `Deleting your account doesn't erase reports other people made about you, or a ban: we keep them for up to 12 months, with a one-way hash of your contacts instead of the contacts (see the Privacy Policy). An account with the same phone number, sign-in email or ${v("Agent Village key", "village agent platform key")} as someone who was banned, or reported by several people, is hidden until we review it. A matching Telegram username alone never hides an account; we only review it.` },
      { h2: "Your agent and AI-written chats" },
      { p: "Agent chats are short conversations written by AI on behalf of you and the other resident, based on your profiles. They can be wrong. Meeting in person is your choice: meet in public places and use your judgement. Kismet does not run background checks." },
      { h2: "Other" },
      {
        ul: [
          "You can delete your account at any time (see the Privacy Policy). Reports others made about you are kept for up to 12 months, for safety.",
          `The service is provided as is and may change or end. It began at ${v("the Edge City India pop-up village", "a pop-up village")} and is, for now, only for its residents.`,
          "We may update these terms; continued use means you accept the update.",
        ],
      },
    ],
  };
}

/** The waitlist page's lines. */
export const waitlistCopy = (neutral: boolean) => ({
  kicker: neutral ? "Not in the village?" : "Not at Edge City?",
  title: "Get your agent on Kismet next",
  body: "We're bringing agent intros to more communities and pop-up cities, and to iPhone and Android. Join the list and we'll email you when it opens.",
});

/**
 * The sign-up quiz's lines about who Kismet is for (components/quiz.tsx). The neutral ones are the iOS app's own
 * wording (kismet-mobile, "Are you living in the village right now?"); a yes means the same as on the website.
 */
export function quizCopy(neutral: boolean) {
  return neutral
    ? {
      question: "Are you living in the village right now?",
      hint: "Kismet connects the residents of one village, and only them right now, so everyone it suggests is someone you can meet in person.",
      weeks: false,
      areaPlaceholder: "Where are you staying? (optional)",
      pasteTitle: "Paste what your own AI agent says about you",
      askAgent: "Ask your own AI agent:",
      agentPrompt: AGENT_PROMPT.replace(`from ${EDGE_CITY.name},`, "from the village,"),
      notHereTitle: "Kismet is just for village residents, for now",
      notHereBody: "It connects the people living in the village. Join the waitlist and we'll tell you when it opens up.",
      notHereBack: "Actually, I am here",
    }
    : {
      question: `Are you at ${EDGE_CITY.name}?`,
      hint: `Kismet makes intros between the people at ${EDGE_CITY.name} in ${EDGE_CITY.place} (${EDGE_CITY.dates}), and is only for them right now.`,
      weeks: true,
      areaPlaceholder: "Where are you staying? e.g. Mandrem (optional)",
      pasteTitle: "Paste what your Edge City agent says about you",
      askAgent: "Ask your Agent Village agent:",
      agentPrompt: AGENT_PROMPT,
      notHereTitle: "Kismet is Edge City only, for now",
      notHereBody: `It makes intros between the people at ${EDGE_CITY.name} in ${EDGE_CITY.place}. Join the waitlist and we'll tell you when it opens up.`,
      notHereBack: "Actually, I am at Edge City",
    };
}

/** The neutral pages' description (layout metadata, link previews): copy.ts FOR_WHOM without the event's name. */
export const NEUTRAL_FOR_WHOM = "Intros to friends, collaborators and co-founders for the residents of your village.";
