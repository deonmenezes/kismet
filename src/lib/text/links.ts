// "Text Kismet" entry points. The number comes from KISMET_WHATSAPP_NUMBER (E.164). Shown only when
// KISMET_WHATSAPP_PUBLIC=1 says it is a production number anyone can text (QA2: the public buttons pointed at Meta's
// test number, +1 555 143 7970, which answers at most 5 verified recipients). Otherwise no button and no link
// anywhere (landing, sign-in, /join, the start dialog, linking from /home); the webhook (/api/text/whatsapp) keeps
// working for the numbers already on it either way.

/** True only when KISMET_WHATSAPP_PUBLIC is "1" (or "true"): a live number the public may text. */
export const whatsappPublic = (env: Record<string, string | undefined> = process.env) => /^(1|true)$/i.test(env.KISMET_WHATSAPP_PUBLIC?.trim() ?? "");

export function textLinks(body = "Hi Kismet", env: Record<string, string | undefined> = process.env) {
  if (!whatsappPublic(env)) return { whatsappNumber: null, whatsappUrl: null };
  const raw = env.KISMET_WHATSAPP_NUMBER?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return { whatsappNumber: null, whatsappUrl: null };
  return { whatsappNumber: `+${digits}`, whatsappUrl: `https://wa.me/${digits}?text=${encodeURIComponent(body)}` };
}
