"use client";

import { useTranslations } from "next-intl";
import { ApiError } from "./api-client";

/** Turns any thrown error into a translated sentence (API codes → errors.<CODE>). */
export function useErrorText() {
  const t = useTranslations("errors");
  return (error: unknown): string => {
    if (!(error instanceof ApiError)) return t("INTERNAL_ERROR");
    if (error.code === "AUTH_RATE_LIMITED") {
      const seconds = Number(error.details?.retryAfterSec ?? 60);
      return t("AUTH_RATE_LIMITED", { minutes: Math.max(1, Math.ceil(seconds / 60)) });
    }
    if (
      error.code === "PASSWORD_TOO_WEAK" &&
      typeof error.details?.reason === "string" &&
      t.has(`passwordReasons.${error.details.reason}`)
    ) {
      return t(`passwordReasons.${error.details.reason}`);
    }
    // Business conflicts carry a reason code (e.g. STUDENT_BELOW_MIN_GRADE) with its own sentence.
    const reason = typeof error.details?.reason === "string" ? error.details.reason : undefined;
    if (reason && t.has(`reasons.${reason}`)) return t(`reasons.${reason}`, error.details as Record<string, string>);
    return t.has(error.code) ? t(error.code) : t("INTERNAL_ERROR");
  };
}
