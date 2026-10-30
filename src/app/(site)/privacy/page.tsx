import type { Metadata } from "next";
import { PrivacyPage } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

export default function Privacy() {
  return <PrivacyPage />;
}
