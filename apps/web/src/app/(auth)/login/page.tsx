"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Me } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LOCALE_COOKIE } from "@/i18n/locale";
import { applyTheme, cookieLine } from "@/lib/theme";
import { useErrorText } from "@/lib/use-error-text";
import { homePath, useSetMe } from "@/lib/use-me";

export default function LoginPage() {
  const t = useTranslations("auth");
  const api = useApi();
  const router = useRouter();
  const setMe = useSetMe();
  const errorText = useErrorText();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: Me }>("/auth/login", { username, password, clientType: "WEB" });
      // The user's saved look and language follow them to this device.
      applyTheme(user.preferences.themeMode);
      if (user.preferences.locale) document.cookie = cookieLine(LOCALE_COOKIE, user.preferences.locale);
      setMe(user);
      router.replace(homePath(user));
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("loginTitle")}</h1>
        <p className="text-sm text-muted">{t("loginSubtitle")}</p>
      </div>
      <Field label={t("username")} hint={t("usernameHint")}>
        {(id, describedBy) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("password")}>
        {(id) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" loading={busy} disabled={!username || !password}>
        {t("submit")}
      </Button>
    </form>
  );
}
