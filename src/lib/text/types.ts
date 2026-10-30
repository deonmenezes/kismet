// "Kismet by text": a resident texts Kismet like a contact (no app) and their agent texts them first when
// someone is worth meeting. Providers plug in as adapters (WhatsApp Cloud API today; an iMessage provider
// can be added behind the same interface; the website's chat is the "web" channel). Pure types, no imports.

export type TextChannel = "whatsapp" | "web";

/** One inbound message, normalized across providers. */
export type Inbound = {
  channel: TextChannel;
  /** The sender, E.164 ("+15550100199"); on the web, the thread key ("web:u:<user id>" or "web:a:<sign-in id>"). */
  from: string;
  /** Message text ("" for media or unsupported types). */
  text: string;
  /** The id of a tapped reply button (e.g. "kismet:yes:<dateId>"), if any. */
  buttonId: string | null;
  /** The provider's message id: inbound handling is idempotent on it. */
  providerId: string;
  /** Group chats are ignored. */
  isGroup: boolean;
  /** The sender's display name, when the provider sends one (never stored as their profile name). */
  displayName?: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string; code?: number };

/** A yes/no prompt about one recommendation. */
export type YesNo = { text: string; dateId: string; name: string; why: string };

export interface TextAdapter {
  channel: TextChannel;
  /**
   * The person is looking at the conversation (the website's chat): recommendations and notices show up
   * right away, with no quiet hours, no daily push cap, no templates and no STOP opt-out.
   */
  live?: boolean;
  /** False when its env is not configured: the webhook answers 503 and nothing is sent. */
  configured(): boolean;
  /** Checks the webhook signature over the raw body. */
  verify(headers: Headers, raw: string): boolean;
  /** Inbound messages in a webhook body (delivery statuses and other events are skipped). */
  parse(body: unknown): Inbound[];
  sendText(to: string, text: string): Promise<SendResult>;
  /**
   * Yes/no buttons. windowOpen: the person messaged within the provider's free-form window (WhatsApp: 24 h);
   * outside it WhatsApp sends the approved template instead.
   */
  sendYesNo(to: string, prompt: YesNo, windowOpen: boolean): Promise<SendResult>;
  /** Outside the free-form window: the partner-free "you have a new match, reply MATCHES" template. */
  sendMatchTemplate(to: string): Promise<SendResult>;
  /** Optional: mark the inbound message read and show a typing indicator. */
  typing?(inbound: Inbound): Promise<void>;
  /** True when free-form text can reach this person now (WhatsApp: last inbound within 24 h). */
  windowOpen(lastInboundAt: Date | null, now: Date): boolean;
}
