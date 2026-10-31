"use client";

import { Home, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import type { ThemeMode } from "@/lib/theme";
import { homePath, isPortalUser, useMe } from "@/lib/use-me";
import { useShellBranding } from "./branding-context";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

const TABS = [
  { key: "home", href: "/home", icon: Home },
  { key: "profile", href: "/me", icon: UserRound },
] as const;

/** Mobile-first shell for students and guardians: compact header, bottom tab bar (top links on wide screens). */
export function PortalShell({ children, initialTheme }: { children: ReactNode; initialTheme: ThemeMode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const branding = useShellBranding();
  const me = useMe();

  useEffect(() => {
    if (me.data && (me.data.mustChangePassword || !isPortalUser(me.data))) router.replace(homePath(me.data));
  }, [me.data, router]);

  if (!me.data || me.data.mustChangePassword || !isPortalUser(me.data)) return <LoadingState rows={4} />;

  const tabs = TABS.map(({ key, href, icon: Icon }) => {
    const active = pathname === href;
    return (
      <Link
        key={key}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted md:flex-row md:gap-2 md:px-3 md:text-sm",
          active && "text-primary",
        )}
      >
        <Icon className="size-5" aria-hidden />
        {t(key)}
      </Link>
    );
  });

  return (
    <div className="min-h-dvh pb-16 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <span className="truncate font-semibold">{branding.schoolName}</span>
          <nav aria-label={t("mainMenu")} className="ml-4 hidden md:flex">
            {tabs}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle initial={initialTheme} />
          </div>
        </div>
      </header>
      <main id="content" className="mx-auto w-full max-w-3xl p-4">
        {children}
      </main>
      <nav
        aria-label={t("mainMenu")}
        data-testid="tab-bar"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface md:hidden"
      >
        {tabs}
      </nav>
    </div>
  );
}
