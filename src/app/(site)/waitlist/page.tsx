import type { Metadata } from "next";
import { WaitlistPage } from "@/components/waitlist-page";

export const metadata: Metadata = { title: "Join the waitlist", alternates: { canonical: "/waitlist" } };

export default function Waitlist({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  return <WaitlistPage searchParams={searchParams} />;
}
