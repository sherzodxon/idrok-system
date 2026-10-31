"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useApi } from "@/components/providers/app-providers";
import { cn } from "@/lib/cn";
import { applyTheme, type ThemeMode } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; icon: typeof Sun; label: "themeLight" | "themeDark" | "themeSystem" }[] = [
  { mode: "LIGHT", icon: Sun, label: "themeLight" },
  { mode: "DARK", icon: Moon, label: "themeDark" },
  { mode: "SYSTEM", icon: Monitor, label: "themeSystem" },
];

export function ThemeToggle({ initial, persist = true }: { initial: ThemeMode; persist?: boolean }) {
  const t = useTranslations("shell");
  const api = useApi();
  const [mode, setMode] = useState(initial);
  const choose = (next: ThemeMode) => {
    setMode(next);
    applyTheme(next);
    if (persist) void api.patch("/me/preferences", { themeMode: next }).catch(() => {});
  };
  return (
    <div
      role="radiogroup"
      aria-label={t("theme")}
      className="inline-flex rounded-button border border-border bg-surface p-0.5"
    >
      {OPTIONS.map(({ mode: m, icon: Icon, label }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={t(label)}
          title={t(label)}
          data-theme-option={m}
          onClick={() => choose(m)}
          className={cn(
            "rounded-[6px] p-1.5 text-muted hover:text-foreground",
            mode === m && "bg-primary-soft text-primary-strong",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
