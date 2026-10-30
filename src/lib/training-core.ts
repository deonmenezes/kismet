import { stripContacts, withoutNames } from "./contacts.ts";

// Sharing for feedback and training: the rules, without the database (lib/training.ts has the queries).

/** Asked once, after this much time with Kismet open (all channels together, lib/records.ts touchSeen). */
export const ASK_AFTER_MINUTES = 90;
/** The version of the question someone said yes to (consents.version). */
export const TRAINING_VERSION = "2026-10-20";
export const FEEDBACK_MAX = 2000;

/** null: never answered. Someone who answered (yes or no) is never asked again; Profile is where they change it. */
export const shouldAsk = (answer: boolean | null, minutes: number) => answer === null && minutes >= ASK_AFTER_MINUTES;

/** The optional feedback text: trimmed, capped, and nothing when it is empty. */
export function cleanFeedback(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, FEEDBACK_MAX);
  return t || null;
}

/**
 * What any use of shared data must go through: names become "someone" and contact details are removed. Photos are
 * never shared. A date is used only when both people said yes (bothShared), because it holds what both agents knew.
 */
export const scrubForTraining = (text: string, names: (string | null | undefined)[]) => stripContacts(withoutNames(text, names));
export const bothShared = (a: boolean | null, b: boolean | null) => a === true && b === true;
