import type { Viewport } from "next";
import { fraunces } from "@/lib/fonts";
import { CHAT_VIEWPORT } from "@/lib/theme";

export const viewport: Viewport = CHAT_VIEWPORT;

// A match chat is full screen, like the Kismet chat it opens from.
export default function MatchChatLayout({ children }: { children: React.ReactNode }) {
  return <main className={`kchat k-shell ${fraunces.variable}`}>{children}</main>;
}
