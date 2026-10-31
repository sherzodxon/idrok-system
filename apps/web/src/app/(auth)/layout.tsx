import type { ReactNode } from "react";
import { AuthFrame } from "@/components/views/auth-frame";
import { getBranding } from "@/lib/server-api";
import { themeFromCookie } from "@/lib/server-prefs";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return <AuthFrame initialTheme={await themeFromCookie(branding?.defaultThemeMode ?? "SYSTEM")}>{children}</AuthFrame>;
}
