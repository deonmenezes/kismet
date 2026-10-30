import type { Metadata } from "next";
import { PrivacyPage } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/app/privacy" } };

export default function AppPrivacy() {
  return <PrivacyPage neutral />;
}
