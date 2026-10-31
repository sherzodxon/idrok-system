// next-intl without locale prefixes (internal system): the user's choice is a cookie, else the school default.
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getBranding } from "../lib/server-api";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./locale";

export default getRequestConfig(async () => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(chosen) ? chosen : ((await getBranding())?.defaultLocale ?? DEFAULT_LOCALE);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Asia/Tashkent",
  };
});
