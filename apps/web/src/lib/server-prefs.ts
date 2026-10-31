import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, isThemeMode, type ThemeMode } from "./theme";

/** Theme chosen on this device (cookie), else the school default from branding. */
export async function themeFromCookie(fallback: ThemeMode = "SYSTEM"): Promise<ThemeMode> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isThemeMode(value) ? value : fallback;
}
