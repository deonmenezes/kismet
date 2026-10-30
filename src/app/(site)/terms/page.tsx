import type { Metadata } from "next";
import { TermsPage } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of Use", alternates: { canonical: "/terms" } };

export default function Terms() {
  return <TermsPage />;
}
