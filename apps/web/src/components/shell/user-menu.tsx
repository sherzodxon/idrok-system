"use client";

import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Me } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Avatar } from "@/components/ui/avatar";

export function useLogout() {
  const api = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  return async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    router.replace("/login");
  };
}

export function UserMenu({ me, profileHref }: { me: Me; profileHref: string }) {
  const t = useTranslations();
  const logout = useLogout();
  return (
    <details className="group relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-button p-1 hover:bg-surface-muted"
        data-testid="user-menu"
      >
        <Avatar name={me.displayName} size={32} />
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-medium text-foreground">{me.displayName}</span>
          <span className="block text-xs text-muted">
            {me.roles.map((r) => (t.has(`roles.${r}`) ? t(`roles.${r}`) : r)).join(", ")}
          </span>
        </span>
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-52 rounded-card border border-border bg-surface p-1 shadow-card">
        <Link
          href={profileHref}
          className="flex items-center gap-2 rounded-button px-3 py-2 text-sm hover:bg-surface-muted"
        >
          <UserRound className="size-4" aria-hidden />
          {t("nav.profile")}
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex w-full items-center gap-2 rounded-button px-3 py-2 text-sm text-danger hover:bg-danger-soft"
        >
          <LogOut className="size-4" aria-hidden />
          {t("common.logout")}
        </button>
      </div>
    </details>
  );
}
