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
    // A refused score says which limit and how much still fits (scoring.md §3.1).
    if (error.code === "SCORE_LIMIT_EXCEEDED" && typeof error.details?.window === "string") {
      return t("scoreLimit", {
        window: t.has(`limitWindows.${error.details.window}`)
          ? t(`limitWindows.${error.details.window}`)
          : error.details.window,
        remaining: String(error.details.remaining ?? 0),
      });
    }
    // A refused coin evaluation names the tightest limit (all failing rules are in details.reasons).
    if (error.code === "COIN_LIMIT_EXCEEDED" && Array.isArray(error.details?.reasons) && error.details.reasons[0]) {
      const r = error.details.reasons[0] as { period: string; blockedBy: string; remainingAmount: number | null };
      const period = t.has(`coinPeriods.${r.period}`) ? t(`coinPeriods.${r.period}`) : r.period;
      return r.blockedBy === "AMOUNT"
        ? t("coinLimitAmount", { period, remaining: String(r.remainingAmount ?? 0) })
        : t("coinLimitCount", { period });
    }
    if (error.code === "COIN_INSUFFICIENT_BALANCE" && typeof error.details?.available === "number")
      return t("coinBalance", { available: String(error.details.available) });
    // A refused field with a sentence of its own (e.g. a face photo that is too small).
    // Extra keys of the field (e.g. `limit` of a criterion bound) fill the sentence.
    const first = (error.details?.fields as Record<string, unknown>[] | undefined)?.[0];
    const field = typeof first?.code === "string" ? first.code : undefined;
    if (error.code === "VALIDATION_ERROR" && field && t.has(`fieldCodes.${field}`)) {
      const values = Object.fromEntries(
        Object.entries(first ?? {}).filter(([k, v]) => k !== "code" && k !== "path" && typeof v === "string"),
      ) as Record<string, string>;
      return t(`fieldCodes.${field}`, values);
    }
    // Business conflicts carry a reason code (e.g. STUDENT_BELOW_MIN_GRADE) with its own sentence.
    const reason = typeof error.details?.reason === "string" ? error.details.reason : undefined;
    if (reason && t.has(`reasons.${reason}`)) return t(`reasons.${reason}`, error.details as Record<string, string>);
    return t.has(error.code) ? t(error.code) : t("INTERNAL_ERROR");
  };
}
