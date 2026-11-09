// Telegram Bot API client (M7). The token is part of every request URL, so neither URLs nor raw errors are ever
// logged or stored: failures become a TelegramApiError with Telegram's status and description only.

export interface InlineButton {
  text: string;
  url?: string;
  web_app?: { url: string };
}

export interface SendMessageOptions {
  /** Inline keyboard (one button per row). */
  buttons?: InlineButton[];
  /** One-button reply keyboard asking for the user's own contact. */
  requestContact?: { text: string };
  removeKeyboard?: boolean;
}

export interface TelegramClient {
  readonly configured: boolean;
  sendMessage(chatId: bigint | number | string, text: string, options?: SendMessageOptions): Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(
    /** HTTP-like status: 0 = network, 403 = blocked by the user, 429 = flood limit. */
    readonly status: number,
    description: string,
    readonly retryAfterSec?: number,
  ) {
    super(`telegram ${status}: ${description.slice(0, 200)}`);
  }

  /** The chat will never accept messages again until the user writes to the bot (blocked, deleted, kicked). */
  get chatGone(): boolean {
    return this.status === 403 || (this.status === 400 && /chat not found/i.test(this.message));
  }
}

function replyMarkup(options: SendMessageOptions | undefined): Record<string, unknown> | undefined {
  if (options?.buttons?.length) return { inline_keyboard: options.buttons.map((b) => [b]) };
  if (options?.requestContact)
    return {
      keyboard: [[{ text: options.requestContact.text, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  if (options?.removeKeyboard) return { remove_keyboard: true };
  return undefined;
}

export class HttpTelegramClient implements TelegramClient {
  readonly configured: boolean;

  constructor(
    private readonly token: string | undefined,
    private readonly baseUrl = "https://api.telegram.org",
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {
    this.configured = !!token;
  }

  async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    if (!this.token) throw new TelegramApiError(503, "bot token not configured");
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TelegramApiError(0, "network error");
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (!res.ok || !data?.ok)
      throw new TelegramApiError(res.status, data?.description ?? "request failed", data?.parameters?.retry_after);
    return data.result;
  }

  async sendMessage(chatId: bigint | number | string, text: string, options?: SendMessageOptions): Promise<void> {
    const markup = replyMarkup(options);
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(markup ? { reply_markup: markup } : {}),
    });
  }
}

/** Test double: records messages; `fail` makes the next sends throw. */
export class FakeTelegramClient implements TelegramClient {
  readonly configured = true;
  readonly sent: { chatId: string; text: string; options?: SendMessageOptions }[] = [];
  fail: TelegramApiError | null = null;

  async sendMessage(chatId: bigint | number | string, text: string, options?: SendMessageOptions): Promise<void> {
    if (this.fail) throw this.fail;
    this.sent.push({ chatId: String(chatId), text, ...(options ? { options } : {}) });
  }
}
