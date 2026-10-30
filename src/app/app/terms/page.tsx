import type { Metadata } from "next";
import { TermsPage } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of Use", alternates: { canonical: "/app/terms" } };

export default function AppTerms() {
  return <TermsPage neutral />;
}
