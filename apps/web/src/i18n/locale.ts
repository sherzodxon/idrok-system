export const LOCALES = ["uz", "ru"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "uz";
export const LOCALE_COOKIE = "idrok_locale";
export const isLocale = (v: unknown): v is AppLocale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);
