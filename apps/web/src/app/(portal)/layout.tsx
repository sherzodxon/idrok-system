import type { ReactNode } from "react";
import { PortalShell } from "@/components/shell/portal-shell";
import { getBranding } from "@/lib/server-api";
import { themeFromCookie } from "@/lib/server-prefs";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return (
    <PortalShell initialTheme={await themeFromCookie(branding?.defaultThemeMode ?? "SYSTEM")}>{children}</PortalShell>
  );
}
