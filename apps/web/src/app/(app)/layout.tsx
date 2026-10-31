import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getBranding } from "@/lib/server-api";
import { themeFromCookie } from "@/lib/server-prefs";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return <AppShell initialTheme={await themeFromCookie(branding?.defaultThemeMode ?? "SYSTEM")}>{children}</AppShell>;
}
