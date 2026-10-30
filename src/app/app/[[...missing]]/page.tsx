import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Its own title: without one, the tab reads "Kismet · Kismet" once the page hydrates (the layout's default through
// its template), though the server sent "Page not found · Kismet" (QA6 Q6-L3).
export const metadata: Metadata = { title: "Page not found" };

// /app and any mistyped /app/... URL: the neutral 404 (../not-found.tsx), not the website's.
export default function AppMissing() {
  notFound();
}
