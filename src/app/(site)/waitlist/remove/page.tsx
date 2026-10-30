import type { Metadata } from "next";
import { WaitlistRemove } from "@/components/waitlist-remove";

// Its own tab title, as the /app twin (QA8 L2: it read the site's default title).
export const metadata: Metadata = { title: "Leave the waitlist" };

export default function Page() {
  return <WaitlistRemove />;
}
