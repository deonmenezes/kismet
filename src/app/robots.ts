import type { MetadataRoute } from "next";
import { SITE } from "@/lib/copy";

// Public pages only: private links, sign-in, accounts, chats and the API stay out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/u/", "/verify/", "/admin", "/auth/", "/chat", "/home", "/edit", "/sign-in", "/waitlist/remove"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
