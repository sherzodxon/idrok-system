"use client";

import { ChevronsLeft, ChevronsRight, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import type { Me } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Modal } from "@/components/ui/modal";
import { LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import type { ThemeMode } from "@/lib/theme";
import { can, homePath, isPortalUser, useMe } from "@/lib/use-me";
import { useShellBranding } from "./branding-context";
import { BrandBadge } from "@/components/shell/brand-mark";
import { LocaleSwitcher } from "./locale-switcher";
import { NAV, availableContexts, groupNav, type NavContext } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

const CONTEXT_KEY = "idrok_nav_context";

function NavList({
  me,
  context,
  collapsed,
  onNavigate,
}: {
  me: Me;
  context: NavContext;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-3">
      {groupNav(NAV[context].filter((item) => !item.permission || can(me, item.permission))).map(({ group, items }) => (
        <section
          key={group}
          aria-labelledby={collapsed ? undefined : `nav-group-${group}`}
          className="flex flex-col gap-1"
        >
          {collapsed ? (
            <hr className="mx-2 border-border first:hidden" />
          ) : (
            <h3
              id={`nav-group-${group}`}
              className="px-3 pt-1 text-xs font-semibold tracking-wider text-disabled uppercase"
            >
              {t(`groups.${group}`)}
            </h3>
          )}
          <ul className="flex flex-col gap-1">
            {items.map(({ key, href, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={key}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? t(key) : undefined}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-button px-3 text-sm font-medium text-muted hover:bg-surface-muted hover:text-foreground",
                      active && "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden />
                    <span className={cn(collapsed && "sr-only")}>{t(key)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function AppShell({ children, initialTheme }: { children: ReactNode; initialTheme: ThemeMode }) {
  const t = useTranslations();
  const router = useRouter();
  const api = useApi();
  const branding = useShellBranding();
  const me = useMe();
  // Explicit choices override what the profile says; until then the saved values apply.
  const [collapsedChoice, setCollapsedChoice] = useState<boolean | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [contextChoice, setContextChoice] = useState<NavContext | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem(CONTEXT_KEY);
      return saved === "school" || saved === "teacher" ? saved : null;
    } catch {
      return null; // storage unavailable (private mode): the default context is fine
    }
  });

  useEffect(() => {
    if (me.data && (me.data.mustChangePassword || isPortalUser(me.data))) router.replace(homePath(me.data));
  }, [me.data, router]);

  if (!me.data || me.data.mustChangePassword || isPortalUser(me.data)) return <LoadingState rows={6} />;
  const contexts = availableContexts(me.data.roles);
  const context = contextChoice && contexts.includes(contextChoice) ? contextChoice : contexts[0]!;
  const collapsed = collapsedChoice ?? me.data.preferences.sidebarCollapsed;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsedChoice(next);
    void api.patch("/me/preferences", { sidebarCollapsed: next }).catch(() => {});
  };
  const switchContext = (next: NavContext) => {
    setContextChoice(next);
    try {
      localStorage.setItem(CONTEXT_KEY, next);
    } catch {
      // not persisted; still switched for this session
    }
    router.push("/dashboard");
  };

  const brand = (compact: boolean) => (
    <Link href="/dashboard" className="flex h-14 items-center gap-2 px-3">
      <BrandBadge className="size-9 rounded-button" />
      {!compact && (
        <span className="truncate text-sm font-semibold leading-tight text-foreground">{branding.schoolName}</span>
      )}
    </Link>
  );

  const contextSwitch = contexts.length > 1 && (
    <div
      role="radiogroup"
      aria-label={t("shell.context")}
      className="grid grid-cols-2 gap-1 rounded-button bg-surface-muted p-1"
    >
      {contexts.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={context === c}
          onClick={() => switchContext(c)}
          className={cn(
            "rounded-[6px] px-2 py-1 text-xs font-medium text-muted",
            context === c && "bg-surface text-foreground shadow-card",
          )}
        >
          {t(c === "school" ? "shell.contextSchool" : "shell.contextTeacher")}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-button focus:bg-surface focus:p-2"
      >
        {t("shell.skipToContent")}
      </a>
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] md:flex"
        style={{ width: collapsed ? "var(--sidebar-collapsed)" : "var(--sidebar-width)" }}
      >
        {brand(collapsed)}
        <nav aria-label={t("nav.mainMenu")} className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
          {!collapsed && contextSwitch}
          <NavList me={me.data} context={context} collapsed={collapsed} />
        </nav>
        <button
          type="button"
          onClick={toggleCollapsed}
          data-testid="sidebar-toggle"
          aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
          title={t(collapsed ? "nav.expand" : "nav.collapse")}
          className="m-3 flex h-9 items-center justify-center rounded-button text-muted hover:bg-surface-muted"
        >
          {collapsed ? (
            <ChevronsRight className="size-5" aria-hidden />
          ) : (
            <ChevronsLeft className="size-5" aria-hidden />
          )}
        </button>
      </aside>

      <Modal open={drawer} onClose={() => setDrawer(false)} title={branding.schoolName} side="left">
        <nav aria-label={t("nav.mainMenu")} className="flex flex-col gap-4">
          {contextSwitch}
          <NavList me={me.data} context={context} collapsed={false} onNavigate={() => setDrawer(false)} />
        </nav>
      </Modal>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 md:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            data-testid="drawer-open"
            aria-label={t("nav.openMenu")}
            className="rounded-button p-2 text-muted hover:bg-surface-muted md:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="truncate text-sm font-semibold md:hidden">{branding.schoolName}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <LocaleSwitcher />
            </div>
            <ThemeToggle initial={initialTheme} />
            <UserMenu me={me.data} profileHref="/profile" />
          </div>
        </header>
        <main id="content" className="mx-auto w-full max-w-7xl flex-1 p-[var(--space-page)]">
          {children}
        </main>
      </div>
    </div>
  );
}
