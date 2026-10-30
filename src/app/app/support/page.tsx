import type { Metadata } from "next";
import { SupportPage } from "@/components/legal";

export const metadata: Metadata = { title: "Support", alternates: { canonical: "/app/support" } };

export default function AppSupport() {
  return <SupportPage neutral />;
}
