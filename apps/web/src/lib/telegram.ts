// Telegram Mini App mode (M7). Inside Telegram the web app has no cookies: the Mini App exchanges Telegram's signed
// initData for bearer tokens (POST /auth/telegram), kept for this tab only (sessionStorage). Telegram passes initData
// and the theme in the URL hash (#tgWebAppData=…&tgWebAppThemeParams=…), so no external script is loaded (CSP).

export interface TelegramTokens {
  accessToken: string;
  refreshToken?: string;
}

const TOKENS_KEY = "idrok_tg_tokens";
const INIT_KEY = "idrok_tg_init";
/** Session cookie read only by the Next.js proxy: "this tab is a Telegram session" (the API checks the token). */
export const TELEGRAM_MARKER_COOKIE = "idrok_tg";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const telegramSession = {
  get(): TelegramTokens | null {
    const raw = storage()?.getItem(TOKENS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TelegramTokens;
    } catch {
      return null;
    }
  },
  set(tokens: TelegramTokens) {
    const prev = this.get();
    storage()?.setItem(TOKENS_KEY, JSON.stringify({ ...prev, ...tokens }));
    document.cookie = `${TELEGRAM_MARKER_COOKIE}=1; Path=/; SameSite=Lax`;
  },
  clear() {
    storage()?.removeItem(TOKENS_KEY);
    document.cookie = `${TELEGRAM_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  },
  initData(): string | null {
    return storage()?.getItem(INIT_KEY) ?? null;
  },
  setInitData(value: string) {
    storage()?.setItem(INIT_KEY, value);
  },
};

export const isTelegramMode = () => telegramSession.get() !== null;

/** The launch parameters Telegram put in the URL hash, if any. */
export function readLaunchParams(hash: string): {
  initData: string | null;
  themeParams: Record<string, string> | null;
} {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const initData = params.get("tgWebAppData");
  return { initData: initData || null, themeParams: parseThemeParams(params.get("tgWebAppThemeParams")) };
}

function parseThemeParams(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Telegram's background colour decides light or dark (its theme follows the user's Telegram app). */
export function isDarkTheme(themeParams: Record<string, string> | null): boolean | null {
  const bg = themeParams?.bg_color;
  const m = bg ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg) : null;
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128;
}

/** Telegram client events (web_app_ready, web_app_expand): native webviews and web.telegram.org (iframe). */
export function postTelegramEvent(eventType: string) {
  const w = window as unknown as {
    TelegramWebviewProxy?: { postEvent: (type: string, data: string) => void };
    external?: { notify?: (msg: string) => void };
  };
  const message = JSON.stringify({ eventType, eventData: {} });
  try {
    if (w.TelegramWebviewProxy) w.TelegramWebviewProxy.postEvent(eventType, "{}");
    else if (w.external?.notify) w.external.notify(message);
    else if (window.parent !== window) window.parent.postMessage(message, "https://web.telegram.org");
  } catch {
    // Outside Telegram: nothing to tell.
  }
}
