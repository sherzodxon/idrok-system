"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useApi } from "@/components/providers/app-providers";
import { Select } from "@/components/ui/field";
import { LOCALES, LOCALE_COOKIE, isLocale } from "@/i18n/locale";
import { cookieLine } from "@/lib/theme";

export function LocaleSwitcher({ persist = true }: { persist?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const api = useApi();
  return (
    <Select
      aria-label={t("shell.language")}
      value={locale}
      compact
      data-testid="locale-switcher"
      onChange={(e) => {
        const next = e.target.value;
        if (!isLocale(next)) return;
        document.cookie = cookieLine(LOCALE_COOKIE, next);
        if (persist) void api.patch("/me/preferences", { locale: next }).catch(() => {});
        router.refresh();
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {t(`locales.${l}`)}
        </option>
      ))}
    </Select>
  );
}
