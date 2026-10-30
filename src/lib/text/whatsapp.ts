import { createHmac, timingSafeEqual } from "node:crypto";
import type { Inbound, SendResult, TextAdapter, YesNo } from "./types.ts";

// WhatsApp Cloud API adapter (Meta Graph). Webhooks are signed with the Meta app secret
// (X-Hub-Signature-256: sha256=<hex HMAC of the raw body>). Free-form messages reach a person only within
// 24 h of their last message; outside it the yes/no prompt goes out as the approved utility template.
// fetch is injected so the adapter is unit-tested without the network.

export type WhatsAppConfig = {
  token?: string;
  phoneNumberId?: string;
  appSecret?: string;
  verifyToken?: string;
  apiVersion?: string;
  template?: string;
  templateLang?: string;
  /** The partner-free match notice for outside the 24 h window (default kismet_match_ready). */
  matchTemplate?: string;
  /** Prepended to free-form texts (e.g. "[Kismet test] " while testing on a real phone). */
  prefix?: string;
};

export const WINDOW_MS = 24 * 3600 * 1000;
export const YES_ID = (dateId: string) => `kismet:yes:${dateId}`;
export const NO_ID = (dateId: string) => `kismet:no:${dateId}`;
export const MATCHES_ID = "kismet:matches";

export function verifySignature(raw: string, header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(raw, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Meta's GET handshake: the challenge when the verify token matches, else null. */
export function handshake(params: URLSearchParams, verifyToken: string | undefined) {
  if (!verifyToken || params.get("hub.mode") !== "subscribe") return null;
  const t = params.get("hub.verify_token") ?? "";
  const a = Buffer.from(t);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? params.get("hub.challenge") ?? "" : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Inbound messages for our phone number (other numbers on the same WABA are ignored). */
export function parseWebhook(body: unknown, phoneNumberId?: string): Inbound[] {
  const out: Inbound[] = [];
  const entries = (body as any)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) for (const ch of e?.changes ?? []) {
    const v = ch?.value;
    if (ch?.field !== "messages" || !v || !Array.isArray(v.messages)) continue;
    if (phoneNumberId && v.metadata?.phone_number_id && v.metadata.phone_number_id !== phoneNumberId) continue;
    const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [c?.wa_id, c?.profile?.name]));
    for (const m of v.messages) {
      if (typeof m?.from !== "string" || typeof m?.id !== "string") continue;
      let text = "";
      let buttonId: string | null = null;
      if (m.type === "text") text = String(m.text?.body ?? "");
      else if (m.type === "interactive") {
        const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
        buttonId = typeof r?.id === "string" ? r.id : null;
        text = String(r?.title ?? "");
      } else if (m.type === "button") {
        buttonId = typeof m.button?.payload === "string" ? m.button.payload : null;
        text = String(m.button?.text ?? "");
      }
      // The match template's quick reply means "MATCHES".
      if (buttonId === MATCHES_ID) {
        buttonId = null;
        text = "MATCHES";
      }
      out.push({
        channel: "whatsapp",
        from: `+${m.from.replace(/\D/g, "")}`,
        text: text.slice(0, 4000),
        buttonId,
        providerId: m.id,
        isGroup: Boolean(m.group_id || m.context?.group_id),
        displayName: names.get(m.from) ?? undefined,
      });
    }
  }
  return out;
}
/** Delivery statuses in a webhook body (for the logs: a failed send shows its error code here). */
export function statusesOf(body: unknown): { id: string; status: string; error: number | null }[] {
  const out: { id: string; status: string; error: number | null }[] = [];
  for (const e of (body as any)?.entry ?? []) for (const ch of e?.changes ?? []) for (const st of ch?.value?.statuses ?? []) {
    out.push({ id: String(st?.id ?? ""), status: String(st?.status ?? ""), error: typeof st?.errors?.[0]?.code === "number" ? st.errors[0].code : null });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Template parameters may not contain newlines, tabs or 4+ spaces in a row.
const param = (s: string, max: number) => s.replace(/[\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max) || "-";

export function textBody(to: string, text: string) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "text", text: { body: text, preview_url: false } };
}

export function buttonsBody(to: string, p: YesNo) {
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "interactive",
    interactive: {
      type: "button",
      body: { text: p.text.slice(0, 1024) },
      action: { buttons: [{ type: "reply", reply: { id: YES_ID(p.dateId), title: "Yes" } }, { type: "reply", reply: { id: NO_ID(p.dateId), title: "No" } }] },
    },
  };
}

/** kismet_match_ready: "You have a new Kismet match..." + quick reply "Show my match" (no partner data). */
export function matchTemplateBody(to: string, name: string, lang: string) {
  return {
    messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
    template: { name, language: { code: lang }, components: [{ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: MATCHES_ID }] }] },
  };
}

/** kismet_new_recommendation: "...a date with {{1}}'s agent. Why it clicked: {{2}} ..." + quick replies Yes / No. */
export function templateBody(to: string, p: YesNo, name: string, lang: string) {
  return {
    messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
    template: {
      name, language: { code: lang },
      components: [
        { type: "body", parameters: [{ type: "text", text: param(p.name, 60) }, { type: "text", text: param(p.why, 200) }] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: YES_ID(p.dateId) }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: NO_ID(p.dateId) }] },
      ],
    },
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function whatsappAdapter(cfg: WhatsAppConfig, fetchFn: Fetch = fetch): TextAdapter {
  const version = cfg.apiVersion || "v23.0";
  const post = async (body: unknown): Promise<SendResult> => {
    try {
      const res = await fetchFn(`https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
      const id = j.messages?.[0]?.id;
      if (res.ok && id) return { ok: true, id };
      return { ok: false, error: j.error?.message ?? `HTTP ${res.status}`, code: j.error?.code };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "network error" };
    }
  };
  return {
    channel: "whatsapp",
    configured: () => Boolean(cfg.token && cfg.phoneNumberId && cfg.appSecret),
    verify: (headers, raw) => verifySignature(raw, headers.get("x-hub-signature-256"), cfg.appSecret),
    parse: (body) => parseWebhook(body, cfg.phoneNumberId),
    sendText: (to, text) => post(textBody(to, `${cfg.prefix ?? ""}${text}`)),
    sendYesNo: (to, p, windowOpen) =>
      post(windowOpen ? buttonsBody(to, { ...p, text: `${cfg.prefix ?? ""}${p.text}` }) : templateBody(to, p, cfg.template || "kismet_new_recommendation", cfg.templateLang || "en")),
    sendMatchTemplate: (to) => post(matchTemplateBody(to, cfg.matchTemplate || "kismet_match_ready", cfg.templateLang || "en")),
    typing: async (m) => {
      await post({ messaging_product: "whatsapp", status: "read", message_id: m.providerId, typing_indicator: { type: "text" } });
    },
    windowOpen: (last, now) => Boolean(last && now.getTime() - last.getTime() < WINDOW_MS - 60_000),
  };
}
