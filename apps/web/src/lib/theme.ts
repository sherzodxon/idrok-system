// LIGHT / DARK / SYSTEM. The choice is a cookie (first render without a flash) and the user's preference on the server.
export type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";
export const THEME_COOKIE = "idrok_theme";
export const isThemeMode = (v: unknown): v is ThemeMode => v === "LIGHT" || v === "DARK" || v === "SYSTEM";

/** Value of <html data-theme>; undefined lets the OS decide. */
export const dataTheme = (mode: ThemeMode): "light" | "dark" | undefined =>
  mode === "LIGHT" ? "light" : mode === "DARK" ? "dark" : undefined;

const YEAR = 365 * 86_400;
export const cookieLine = (name: string, value: string) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;

export function applyTheme(mode: ThemeMode) {
  const value = dataTheme(mode);
  if (value) document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
  document.cookie = cookieLine(THEME_COOKIE, mode);
}

/** Brand colours as CSS variables (validated #RRGGBB by the API and the database). */
export function brandStyle(b: {
  primaryColor: string;
  primaryHoverColor: string;
  primaryStrongColor: string;
  primarySoftColor: string;
}) {
  return {
    "--brand-primary": b.primaryColor,
    "--brand-primary-hover": b.primaryHoverColor,
    "--brand-primary-strong": b.primaryStrongColor,
    "--brand-primary-soft": b.primarySoftColor,
  } as Record<string, string>;
}
