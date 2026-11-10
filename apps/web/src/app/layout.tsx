import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { PLATFORM_NAME } from "@idrok/shared";
import { AppProviders } from "@/components/providers/app-providers";
import { BrandingProvider } from "@/components/shell/branding-context";
import { apiPublicUrl, getBranding } from "@/lib/server-api";
import { themeFromCookie } from "@/lib/server-prefs";
import { brandStyle, dataTheme } from "@/lib/theme";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  const title = b ? `${b.schoolName} · ${b.platformName}` : PLATFORM_NAME;
  return {
    title,
    // Home-screen app on iPhone (Android reads app/manifest.ts).
    appleWebApp: { capable: true, title: b?.schoolName ?? PLATFORM_NAME, statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

// Self-hosted at build time (no request to Google from the browser; CSP font-src 'self'). Cyrillic for Russian.
const manrope = Manrope({ subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-manrope" });

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return { width: "device-width", initialScale: 1, ...(b ? { themeColor: b.primaryColor } : {}) };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [branding, locale] = await Promise.all([getBranding(), getLocale()]);
  const theme = await themeFromCookie(branding?.defaultThemeMode ?? "SYSTEM");
  return (
    <html
      lang={locale}
      className={manrope.variable}
      data-theme={dataTheme(theme)}
      style={branding ? brandStyle(branding) : undefined}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider>
          <BrandingProvider
            value={{
              schoolName: branding?.schoolName ?? PLATFORM_NAME,
              platformName: branding?.platformName ?? PLATFORM_NAME,
            }}
          >
            <AppProviders apiUrl={apiPublicUrl()}>{children}</AppProviders>
          </BrandingProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
