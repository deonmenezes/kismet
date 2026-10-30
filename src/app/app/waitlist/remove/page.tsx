import type { Metadata } from "next";
import { WaitlistRemove } from "@/components/waitlist-remove";

export const metadata: Metadata = { title: "Leave the waitlist" };

export default function AppWaitlistRemove() {
  return <WaitlistRemove />;
}
