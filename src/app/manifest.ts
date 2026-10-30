import type { MetadataRoute } from "next";
import { FOR_WHOM, PITCH } from "@/lib/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kismet",
    short_name: "Kismet",
    description: `${PITCH} ${FOR_WHOM}`,
    start_url: "/chat",
    display: "standalone",
    background_color: "#FBE5F5",
    theme_color: "#FBE5F5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
