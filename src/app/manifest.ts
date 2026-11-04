import type { MetadataRoute } from "next";
import { DEFAULT_BRAND_DESCRIPTION, DEFAULT_BRAND_NAME } from "@/lib/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: DEFAULT_BRAND_NAME,
    short_name: DEFAULT_BRAND_NAME,
    description: DEFAULT_BRAND_DESCRIPTION,
    display: "standalone",
    background_color: "#F6F7EF",
    theme_color: "#0D3033",
    icons: [
      { src: "/brand/conectaflow-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/conectaflow-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
