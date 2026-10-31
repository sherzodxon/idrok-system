import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <p className="text-lg font-semibold">{t("states.notFoundTitle")}</p>
      <p className="text-sm text-muted">{t("states.notFoundText")}</p>
      <Link href="/" className="mt-2 text-sm font-medium text-primary hover:underline">
        {t("nav.home")}
      </Link>
    </main>
  );
}
