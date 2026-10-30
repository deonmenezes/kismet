import type { Metadata, Viewport } from "next";
import { CHAT_VIEWPORT } from "@/lib/theme";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth";
import { syncChat, viewerFor } from "@/lib/text/web-chat";
import { KismetChat } from "@/components/kismet-chat";
import { textLinks } from "@/lib/text/links";

export const metadata: Metadata = { title: "Chat", robots: { index: false } };
export const viewport: Viewport = CHAT_VIEWPORT;
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const v = await viewerFor();
  // A private-link cookie that no longer opens an account is dropped on the way to sign-in.
  if (!v) redirect((await cookies()).has(COOKIE) ? "/api/signout" : "/sign-in");
  return <KismetChat initial={await syncChat(v, true)} whatsappUrl={textLinks().whatsappUrl} />;
}
