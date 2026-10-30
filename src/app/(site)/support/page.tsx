import type { Metadata } from "next";
import { SupportPage } from "@/components/legal";

export const metadata: Metadata = { title: "Support", alternates: { canonical: "/support" } };

export default function Support() {
  return <SupportPage />;
}
