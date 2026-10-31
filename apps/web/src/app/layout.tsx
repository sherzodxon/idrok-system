import type { Metadata, Viewport } from "next";
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
  return { title: b ? `${b.schoolName} · ${b.platformName}` : PLATFORM_NAME };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [branding, locale] = await Promise.all([getBranding(), getLocale()]);
  const theme = await themeFromCookie(branding?.defaultThemeMode ?? "SYSTEM");
  return (
    <html
      lang={locale}
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
