import { randomUUID } from "node:crypto";
import type { SendResult, TextAdapter } from "./types.ts";

// The website's chat as a Kismet-by-text provider. Nothing leaves the server: every "sent" message is the
// transcript row the agent records (conversation_messages), and the chat page reads that back (lib/text/web-chat.ts).
const sent = async (): Promise<SendResult> => ({ ok: true, id: `web:${randomUUID()}` });

export const webAdapter: TextAdapter = {
  channel: "web",
  live: true,
  configured: () => true,
  verify: () => false, // no webhook: messages arrive through POST /api/chat
  parse: () => [],
  sendText: sent,
  sendYesNo: sent,
  sendMatchTemplate: sent,
  windowOpen: () => true,
};
