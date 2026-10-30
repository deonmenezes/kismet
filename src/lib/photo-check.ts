// Photo moderation: a cheap vision check decides whether a profile photo may be stored. The model call is
// injected (lib/photos.ts uses the AI Gateway), so the rules are unit-tested directly. Fails closed.

export const MODERATION_PROMPT = `You check a dating-app profile photo that the uploader says shows themselves.
Reply with JSON only: {"person": boolean, "nudity": boolean, "minor": boolean, "violence": boolean}
- person: at least one real human is clearly visible (not a drawing, logo, pet only, meme, screenshot or landscape).
- nudity: any nudity, underwear-focused or sexual content.
- minor: anyone in the photo looks under 18.
- violence: weapons pointed at people, blood, gore or violence.`;

export type Moderation = { ok: true } | { ok: false; reason: string };

const REASONS: [key: "nudity" | "minor" | "violence", reason: string][] = [
  ["nudity", "Photos can't contain nudity or sexual content."],
  ["minor", "Photos can't show anyone who looks under 18."],
  ["violence", "Photos can't show violence or weapons."],
];

/** Parses the model's JSON verdict; anything unreadable is a rejection (never stored unchecked). */
export function judge(text: string): Moderation {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, reason: "We couldn't check this photo. Please try another one." };
  }
  if (!v || typeof v !== "object") return { ok: false, reason: "We couldn't check this photo. Please try another one." };
  for (const [key, reason] of REASONS) if (v[key] !== false) return { ok: false, reason };
  if (v.person !== true) return { ok: false, reason: "Use a photo where you are clearly visible." };
  return { ok: true };
}

export async function moderate(check: (jpeg: Uint8Array) => Promise<string>, jpeg: Uint8Array): Promise<Moderation> {
  try {
    return judge(await check(jpeg));
  } catch {
    return { ok: false, reason: "We couldn't check this photo right now. Please try again in a minute." };
  }
}
