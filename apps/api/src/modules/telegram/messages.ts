// Bot and notification texts (T-97): uz/ru dictionaries in ./locales, `{name}` placeholders. Values are inserted as
// plain text (messages are sent without parse_mode, so nothing a user typed can turn into markup).
import ru from "./locales/ru.json";
import uz from "./locales/uz.json";

export type BotLocale = "uz" | "ru";
type Dict = typeof uz;
const DICTS: Record<BotLocale, Dict> = { uz, ru };

export type BotKey = keyof Dict["bot"];
export type NotifyKey = keyof Dict["notify"];

const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));

export const botText = (locale: BotLocale, key: BotKey, params: Record<string, string | number> = {}) =>
  fill(DICTS[locale].bot[key], params);

export const notifyText = (locale: BotLocale, key: NotifyKey, params: Record<string, string | number> = {}) =>
  fill(DICTS[locale].notify[key], params);
