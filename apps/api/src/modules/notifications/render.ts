// Notification params (stored, language-neutral) → message text in the guardian's language.
import type { NotificationKind } from "@idrok/db";
import { notifyText, type BotLocale } from "../telegram/messages";

type Params = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export function renderNotification(kind: NotificationKind, params: Params, locale: BotLocale): string {
  switch (kind) {
    case "ARRIVAL":
      return Number(params.late) > 0
        ? notifyText(locale, "arrivalLate", { student: str(params.student), time: str(params.time), late: str(params.late) })
        : notifyText(locale, "arrival", { student: str(params.student), time: str(params.time) });
    case "DEPARTURE":
      return notifyText(locale, "departure", { student: str(params.student), time: str(params.time) });
    case "LOW_ATTENDANCE":
      return notifyText(locale, "lowAttendance", {
        student: str(params.student),
        days: str(params.days),
        rate: str(params.rate),
        attended: str(params.attended),
        expected: str(params.expected),
      });
    case "TEST_RESULT":
      return notifyText(locale, "testResult", {
        student: str(params.student),
        test: str(params.test),
        subject: str(params.subject),
        score: str(params.score),
        max: str(params.max),
        percent: str(params.percent),
      });
    case "DAILY_DIGEST": {
      const lines = [notifyText(locale, "digestTitle", { student: str(params.student), date: str(params.date) })];
      if (Number(params.scoreCount) > 0) {
        lines.push(notifyText(locale, "digestScores", { count: str(params.scoreCount), total: str(params.scoreTotal) }));
        for (const s of Array.isArray(params.subjects) ? (params.subjects as Params[]) : [])
          lines.push(notifyText(locale, "digestSubject", { subject: str(s.name), total: str(s.total) }));
      }
      if (params.coinDelta !== undefined && params.coinDelta !== null) {
        const delta = Number(params.coinDelta);
        lines.push(
          notifyText(locale, "digestCoins", {
            delta: delta > 0 ? `+${delta}` : String(delta),
            balance: str(params.coinBalance),
          }),
        );
      }
      return lines.join("\n");
    }
    case "BROADCAST":
      return notifyText(locale, "broadcast", { school: str(params.school), text: str(params.text) });
  }
}
