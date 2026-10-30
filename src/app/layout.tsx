import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist } from "next/font/google";
import { FOR_WHOM, PITCH, SITE } from "@/lib/copy";
import { CANVAS } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

// Canonical links and the OG/Twitter image (app/opengraph-image.png) resolve against kismet-village.vercel.app,
// also when the page is opened on agent-dates.vercel.app.
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Kismet: AI agent intros at Edge City India", template: "%s · Kismet" },
  description: `${PITCH} ${FOR_WHOM} Your own private agent has short chats with other residents' agents and tells only you who's worth meeting. Romance only if you both opt in.`,
  applicationName: "Kismet",
  manifest: "/manifest.webmanifest",
  openGraph: { type: "website", siteName: "Kismet", title: "Kismet", description: `${PITCH} ${FOR_WHOM}` },
  twitter: { card: "summary_large_image", title: "Kismet", description: `${PITCH} ${FOR_WHOM}` },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: CANVAS.light },
    { media: "(prefers-color-scheme: dark)", color: CANVAS.dark },
  ],
};

// Every page renders per request: its scripts carry the nonce of that request's Content-Security-Policy (src/proxy.ts,
// lib/csp.ts). A page prerendered at build time would have none, and its scripts would be blocked.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
