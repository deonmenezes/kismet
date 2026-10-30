import { publicInterests, stripContacts } from "./contacts.ts";
import { LOOKING_FOR } from "./options.ts";
import type { User } from "./db.ts";

/**
 * What a person said about themselves that the people their agent recommends them to may read: their own bio
 * (contacts stripped), what they're here for and their interests. Never contact details, gender, who they're into,
 * relationship status, openness, area, availability, agent notes or signals. "Romance" shows only on a romance date
 * (both opted in), so a friends match never learns someone is dating.
 */
export function publicAbout(u: Pick<User, "bio" | "lookingFor" | "interests">, mode: string | null) {
  return {
    bio: stripContacts(u.bio ?? "").replace(/\s*\[removed\]\s*/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    lookingFor: LOOKING_FOR.filter((o) => u.lookingFor.includes(o.id) && (o.id !== "romance" || mode === "romance")).map((o) => o.label),
    interests: publicInterests(u.interests).slice(0, 8),
  };
}
export type PublicAbout = ReturnType<typeof publicAbout>;
