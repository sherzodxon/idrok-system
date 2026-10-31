"use client";

import type { ReactNode } from "react";
import { useShellBranding } from "@/components/shell/branding-context";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import type { ThemeMode } from "@/lib/theme";

export function AuthFrame({ children, initialTheme }: { children: ReactNode; initialTheme: ThemeMode }) {
  const branding = useShellBranding();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 p-4">
        <LocaleSwitcher persist={false} />
        <ThemeToggle initial={initialTheme} persist={false} />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 md:items-center md:pt-0">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-card bg-primary text-xl font-bold text-on-primary">
              {branding.schoolName.slice(0, 1)}
            </span>
            <div>
              <p className="text-lg font-semibold text-foreground">{branding.schoolName}</p>
              <p className="text-sm text-muted">{branding.platformName}</p>
            </div>
          </div>
          <div className="rounded-card border border-border bg-surface p-6 shadow-card">{children}</div>
        </div>
      </main>
    </div>
  );
}
