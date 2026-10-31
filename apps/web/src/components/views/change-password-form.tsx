"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useErrorText } from "@/lib/use-error-text";

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("auth");
  const api = useApi();
  const errorText = useErrorText();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && repeat !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t("currentPassword")}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("newPassword")} hint={t("passwordRules")}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("repeatPassword")} error={mismatch ? t("passwordsDiffer") : undefined}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            invalid={mismatch}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="rounded-button bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        loading={busy}
        disabled={!current || next.length < PASSWORD_MIN_LENGTH || next !== repeat}
      >
        {t("changeSubmit")}
      </Button>
    </form>
  );
}
