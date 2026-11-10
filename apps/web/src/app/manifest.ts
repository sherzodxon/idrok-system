import type { MetadataRoute } from "next";
import { PLATFORM_NAME } from "@idrok/shared";
import { getBranding } from "@/lib/server-api";

// Installable web app (PWA) for guardians, students and staff: "Add to Home Screen" opens it full screen like an app.
// No service worker on purpose: pages hold personal data and must not be cached offline on shared phones.
// Name and colour come from the school's branding (Settings → Branding), so nothing school-specific is hardcoded.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBranding();
  return {
    name: b ? `${b.schoolName} · ${b.platformName}` : PLATFORM_NAME,
    short_name: b?.schoolName ?? PLATFORM_NAME,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    ...(b ? { theme_color: b.primaryColor, background_color: b.primarySoftColor } : {}),
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
