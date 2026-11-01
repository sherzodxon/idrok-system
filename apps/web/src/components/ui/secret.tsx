"use client";

import { Copy, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "./button";

/** A temporary password shown exactly once (security-baseline.md S3). */
export function OneTimeSecret({ username, password }: { username: string; password: string }) {
  const t = useTranslations("accounts");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3" data-testid="one-time-secret">
      <p className="rounded-button bg-warning-soft px-3 py-2 text-sm text-foreground">{t("shownOnce")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{t("username")}</dt>
        <dd className="font-mono" data-testid="secret-username">
          {username}
        </dd>
        <dt className="text-muted">{t("temporaryPassword")}</dt>
        <dd className="flex items-center gap-2 font-mono" data-testid="secret-password">
          <KeyRound className="size-4 text-muted" aria-hidden />
          {password}
        </dd>
      </dl>
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(`${username}\t${password}`).then(() => setCopied(true));
        }}
      >
        <Copy className="size-4" aria-hidden />
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}
