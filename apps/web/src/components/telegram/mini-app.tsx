"use client";

// Mini App entry (M7, T-92): initData from the URL hash → POST /auth/telegram → bearer tokens for this tab → the
// guardian portal (the same pages as the website). Telegram's light/dark theme is applied.
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type { Me } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { BrandBadge } from "@/components/shell/brand-mark";
import { useShellBranding } from "@/components/shell/branding-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { ApiError } from "@/lib/api-client";
import { isDarkTheme, postTelegramEvent, readLaunchParams, telegramSession, type TelegramTokens } from "@/lib/telegram";
import { ME_KEY } from "@/lib/use-me";

type State = "loading" | "outside" | "notLinked" | "invalid" | "error";

export function MiniAppEntry() {
  const t = useTranslations("telegram.miniApp");
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const branding = useShellBranding();
  const [state, setState] = useState<State>("loading");

  const start = useCallback(async () => {
    setState("loading");
    const launch = readLaunchParams(window.location.hash);
    const dark = isDarkTheme(launch.themeParams);
    if (dark !== null) document.documentElement.dataset.theme = dark ? "dark" : "light";
    const initData = launch.initData ?? telegramSession.initData();
    if (!initData) return setState("outside");
    telegramSession.setInitData(initData);
    postTelegramEvent("web_app_ready");
    postTelegramEvent("web_app_expand");
    try {
      const res = await api.post<{ user: Me; tokens: TelegramTokens }>("/auth/telegram", { initData });
      telegramSession.set(res.tokens);
      qc.setQueryData(ME_KEY, res.user);
      router.replace("/home");
    } catch (err) {
      telegramSession.clear();
      const code = err instanceof ApiError ? err.code : null;
      setState(
        code === "TELEGRAM_NOT_LINKED" ? "notLinked" : code === "TELEGRAM_INVALID_INIT_DATA" ? "invalid" : "error",
      );
    }
  }, [api, qc, router]);

  useEffect(() => {
    // After the first paint: the page shows its loading state while Telegram's data is checked.
    const id = setTimeout(() => void start(), 0);
    return () => clearTimeout(id);
  }, [start]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-4">
      <BrandBadge className="size-12 rounded-button" />
      <p className="font-semibold">{branding.schoolName}</p>
      {state === "loading" ? (
        <div className="w-full" data-testid="mini-app-loading">
          <LoadingState rows={2} />
        </div>
      ) : (
        <Card className="flex w-full flex-col items-center gap-3 p-5 text-center" data-testid={`mini-app-${state}`}>
          <Send className="size-8 text-primary" aria-hidden />
          <p className="font-semibold">{t(`${state}.title`)}</p>
          <p className="text-sm text-muted">{t(`${state}.text`)}</p>
          {(state === "error" || state === "invalid") && <Button onClick={() => void start()}>{t("retry")}</Button>}
        </Card>
      )}
    </main>
  );
}
