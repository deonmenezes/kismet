import type { MetadataRoute } from "next";
import { SITE } from "@/lib/copy";

// The public pages (robots.ts keeps the private ones out).
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/board", "/agents", "/join", "/waitlist", "/support", "/privacy", "/terms", "/llms.txt"].map((p) => ({ url: `${SITE}${p}` }));
}
