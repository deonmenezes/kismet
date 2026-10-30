import type { Metadata } from "next";
import { WaitlistPage } from "@/components/waitlist-page";

export const metadata: Metadata = { title: "Join the waitlist", alternates: { canonical: "/app/waitlist" } };

export default function AppWaitlist({ searchParams }: PageProps<"/app/waitlist">) {
  return <WaitlistPage searchParams={searchParams} neutral />;
}
