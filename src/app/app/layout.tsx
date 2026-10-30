import type { Metadata } from "next";
import { SiteChrome } from "@/components/site-chrome";
import { PITCH } from "@/lib/copy";
import { NEUTRAL_FOR_WHOM } from "@/lib/pages-copy";

// The pages the store apps open (Support, Privacy, Terms, the waitlist and the iMessage invite): the website's text
// without naming Edge City (lib/pages-copy.ts). The App Store version names no event (Deon, 2026-10-29, the 4.3(b)
// appeal). Kept out of search (noindex) so they never compete with the website's own pages, and with their own
// description and share image (the root ones name Edge City India).
const description = `${PITCH} ${NEUTRAL_FOR_WHOM}`;
export const metadata: Metadata = {
  title: { default: "Kismet", template: "%s · Kismet" },
  description: `${description} Your own private agent has short chats with other residents' agents and tells only you who's worth meeting. Romance only if you both opt in.`,
  robots: { index: false },
  openGraph: { type: "website", siteName: "Kismet", title: "Kismet", description },
  twitter: { card: "summary_large_image", title: "Kismet", description },
};

export default function AppPagesLayout({ children }: LayoutProps<"/app">) {
  return <SiteChrome neutral>{children}</SiteChrome>;
}
