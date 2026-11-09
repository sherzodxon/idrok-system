// Delivers one Notification (worker, `notifications` queue). Telegram first; SMS only as a fallback the school switched
// on (no provider yet — Q-57). The network call runs outside any transaction; the row's status only moves forward.
import type { Db } from "@idrok/db";
import type { Logger } from "pino";
import { botLocale } from "../../domain/telegram";
import type { SmsProvider } from "../../infra/sms";
import { TelegramApiError, type TelegramClient } from "../../infra/telegram";
import { renderNotification } from "./render";
import { notificationSettings } from "./settings";

/** After this many failed tries a message is given up (BullMQ retries the job in between). */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface DeliveryDeps {
  db: Db;
  telegram: TelegramClient;
  sms: SmsProvider;
  logger: Logger;
}

export type DeliveryOutcome = "SENT" | "SKIPPED" | "FAILED" | "NOOP";

/** Retry later: the job throws this so BullMQ backs off (Telegram flood limit, network). */
export class RetryDelivery extends Error {}

export async function deliverNotification(deps: DeliveryDeps, id: string, now = new Date()): Promise<DeliveryOutcome> {
  const { db } = deps;
  const n = await db.notification.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      params: true,
      status: true,
      attempts: true,
      guardianId: true,
      guardian: {
        select: {
          phone: true,
          user: { select: { preference: { select: { locale: true } } } },
          telegramLinks: {
            where: { revokedAt: null },
            select: { id: true, chatId: true, languageCode: true, blockedAt: true },
          },
        },
      },
    },
  });
  if (!n || n.status !== "PENDING") return "NOOP";
  // Claim the attempt: a second worker holding the same job sees a changed counter and stops.
  const claimed = await db.notification.updateMany({
    where: { id, status: "PENDING", attempts: n.attempts },
    data: { attempts: n.attempts + 1 },
  });
  if (!claimed.count) return "NOOP";
  const finish = (status: "SENT" | "SKIPPED" | "FAILED", extra: { skipReason?: string; lastError?: string } = {}) =>
    db.notification
      .updateMany({
        where: { id, status: "PENDING" },
        data: { status, ...(status === "SENT" ? { sentAt: now } : {}), ...extra },
      })
      .then(() => status);

  const settings = await notificationSettings(db);
  if (n.kind !== "BROADCAST") {
    if (!settings.isEnabled) return finish("SKIPPED", { skipReason: "DISABLED" });
    const lastHour = await db.notification.count({
      where: { guardianId: n.guardianId, status: "SENT", sentAt: { gt: new Date(now.getTime() - 3_600_000) } },
    });
    if (lastHour >= settings.maxPerGuardianPerHour) return finish("SKIPPED", { skipReason: "RATE_LIMITED" });
  }

  const link = n.guardian.telegramLinks[0];
  const locale = botLocale(n.guardian.user?.preference?.locale, link?.languageCode);
  const text = renderNotification(n.kind, n.params as Record<string, unknown>, locale);

  if (link && !link.blockedAt && deps.telegram.configured) {
    try {
      await deps.telegram.sendMessage(link.chatId, text);
      return finish("SENT");
    } catch (err) {
      if (!(err instanceof TelegramApiError)) throw err;
      if (err.chatGone) {
        // The guardian blocked the bot: stop writing until they come back (T-93); try the fallback below.
        await db.telegramLink.updateMany({ where: { id: link.id, blockedAt: null }, data: { blockedAt: now } });
      } else if (n.attempts + 1 < MAX_DELIVERY_ATTEMPTS) {
        throw new RetryDelivery(err.message);
      } else {
        return finish("FAILED", { lastError: err.message });
      }
    }
  }

  if (settings.smsFallbackEnabled) {
    if (!deps.sms.configured) return finish("SKIPPED", { skipReason: "NO_SMS_PROVIDER" });
    try {
      await deps.sms.send(n.guardian.phone, text);
      await db.notification.updateMany({ where: { id }, data: { channel: "SMS" } });
      return finish("SENT");
    } catch (err) {
      if (n.attempts + 1 < MAX_DELIVERY_ATTEMPTS) throw new RetryDelivery("sms failed");
      return finish("FAILED", { lastError: err instanceof Error ? err.message.slice(0, 200) : "sms failed" });
    }
  }
  const reason = !link ? "NO_CHANNEL" : !deps.telegram.configured ? "TELEGRAM_OFF" : "BLOCKED";
  return finish("SKIPPED", { skipReason: reason });
}
