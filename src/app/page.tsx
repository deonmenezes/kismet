import type { Metadata, Viewport } from "next";
import { CHAT_VIEWPORT } from "@/lib/theme";
import { textLinks } from "@/lib/text/links";
import { KismetChat } from "@/components/kismet-chat";
import { neonAuth } from "@/lib/identity";

export const metadata: Metadata = { alternates: { canonical: "/" } };
export const viewport: Viewport = CHAT_VIEWPORT;

// The website is the chat. Signed-in browsers go straight to /chat (src/proxy.ts); everyone else starts here:
// type, talk or hand a prompt to their own AI, and sign in when they send.
export default function Home() {
  return <KismetChat initial={null} whatsappUrl={textLinks().whatsappUrl} signInEnabled={Boolean(neonAuth)} />;
}
