// The guardians' bot (worker, `telegram` queue): one stored update → replies. Private chats only.
//   /start [code] — link by code, or ask for the contact; /unlink; /help; a contact message; a code typed alone.
// The stored payload is cleared once processed (it may hold a phone number, T-90).
import { Prisma, type Db } from "@idrok/db";
import type { Logger } from "pino";
import { botLocale, looksLikeLinkCode } from "../../domain/telegram";
import { SlidingWindow } from "../../infra/rate-limit";
import type { RedisClient } from "../../infra/redis";
import { TelegramApiError, type SendMessageOptions, type TelegramClient } from "../../infra/telegram";
import type { AuthStateSink } from "../users/accounts.service";
import { TelegramLinkingService, type LinkOutcome, type TelegramIdentity } from "./linking.service";
import { botText, type BotLocale } from "./messages";

const CODE_WINDOW_MS = 15 * 60_000;
const MAX_BAD_CODES = 5;

interface TgUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  language_code?: string;
}
interface TgMessage {
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  contact?: { phone_number: string; user_id?: number };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export interface BotDeps {
  db: Db;
  redis: RedisClient;
  telegram: TelegramClient;
  authState: AuthStateSink;
  logger: Logger;
  miniAppUrl?: string | undefined;
}

export async function processTelegramUpdate(deps: BotDeps, telegramUpdateId: string): Promise<void> {
  const row = await deps.db.telegramUpdate.findUnique({
    where: { id: telegramUpdateId },
    select: { id: true, payload: true, processedAt: true },
  });
  if (!row || row.processedAt) return;
  try {
    await handle(deps, row.payload as TgUpdate | null);
  } catch (err) {
    // A Bot API failure (blocked, flood) is not worth retrying a reply for; anything else is retried by BullMQ.
    if (!(err instanceof TelegramApiError)) {
      await deps.db.telegramUpdate.update({
        where: { id: row.id },
        data: { error: err instanceof Error ? err.message.slice(0, 300) : "error" },
      });
      throw err;
    }
    deps.logger.warn({ status: err.status, telegramUpdateId }, "bot reply failed");
  }
  await deps.db.telegramUpdate.update({
    where: { id: row.id },
    data: { processedAt: new Date(), payload: Prisma.DbNull },
  });
}

async function handle(deps: BotDeps, update: TgUpdate | null): Promise<void> {
  const msg = update?.message;
  if (!msg?.from || msg.from.is_bot || msg.chat.type !== "private") return;
  const who: TelegramIdentity = {
    telegramUserId: BigInt(msg.from.id),
    chatId: BigInt(msg.chat.id),
    username: msg.from.username ?? null,
    languageCode: msg.from.language_code ?? null,
  };
  const { db } = deps;
  const linking = new TelegramLinkingService(db, deps.authState);

  const current = await db.telegramLink.findFirst({
    where: { telegramUserId: who.telegramUserId, revokedAt: null },
    select: {
      id: true,
      blockedAt: true,
      guardian: {
        select: { firstName: true, lastName: true, user: { select: { preference: { select: { locale: true } } } } },
      },
    },
  });
  // Writing to the bot again after blocking it: messages may flow again.
  if (current?.blockedAt) await db.telegramLink.update({ where: { id: current.id }, data: { blockedAt: null } });
  const locale: BotLocale = botLocale(current?.guardian.user?.preference?.locale, who.languageCode);
  const send = (text: string, options?: SendMessageOptions) => deps.telegram.sendMessage(who.chatId, text, options);
  const openApp = (): SendMessageOptions | undefined =>
    deps.miniAppUrl
      ? { buttons: [{ text: botText(locale, "openApp"), web_app: { url: deps.miniAppUrl } }] }
      : undefined;
  const askContact = async () => {
    const school = await schoolName(db);
    await send(`${botText(locale, "welcome", { school })}\n\n${botText(locale, "askContact")}`, {
      requestContact: { text: botText(locale, "contactButton") },
    });
  };

  const report = async (outcome: LinkOutcome) => {
    if (outcome.kind === "LINKED") {
      await send(botText(locale, "linked", { name: outcome.guardianName }), { removeKeyboard: true });
      const button = openApp();
      if (button) await send(botText(locale, "openApp"), button);
      return;
    }
    const key = outcome.kind === "AMBIGUOUS" ? "ambiguous" : outcome.kind === "NOT_FOUND" ? "notFound" : "codeInvalid";
    await send(botText(locale, key));
  };

  const redeem = async (code: string) => {
    const window = new SlidingWindow(deps.redis, CODE_WINDOW_MS);
    const key = `rl:tg-code:${who.telegramUserId}`;
    if ((await window.state(key)).count >= MAX_BAD_CODES) return send(botText(locale, "rateLimited"));
    const outcome = await linking.linkByCode(code, who);
    if (outcome.kind === "CODE_INVALID") await window.hit(key);
    return report(outcome);
  };

  if (msg.contact) {
    if (msg.contact.user_id !== msg.from.id) return void (await send(botText(locale, "notOwnContact")));
    return report(await linking.linkByPhone(msg.contact.phone_number, who));
  }

  const text = (msg.text ?? "").trim();
  const [command = "", arg = ""] = text.split(/\s+/, 2);
  switch (command.replace(/@\w+$/, "").toLowerCase()) {
    case "/start":
      if (arg && looksLikeLinkCode(arg)) return void (await redeem(arg));
      if (current) {
        const name = `${current.guardian.lastName} ${current.guardian.firstName}`;
        return void (await send(botText(locale, "alreadyLinked", { name }), openApp()));
      }
      return askContact();
    case "/unlink":
      return void (await send(
        botText(locale, (await linking.unlinkTelegramUser(who.telegramUserId)) ? "unlinked" : "notLinked"),
        { removeKeyboard: true },
      ));
    case "/help":
      return void (await send(botText(locale, "help")));
    default:
      if (looksLikeLinkCode(text)) return void (await redeem(text));
      if (current) return void (await send(botText(locale, "unknown")));
      return askContact();
  }
}

async function schoolName(db: Db): Promise<string> {
  const branding = await db.schoolBranding.findFirst({ select: { schoolName: true } });
  return branding?.schoolName ?? "";
}
