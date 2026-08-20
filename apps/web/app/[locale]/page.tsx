import { getTranslations } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  const common = await getTranslations({ locale, namespace: "common" });

  const otherLocale = routing.locales.find((l) => l !== locale) as AppLocale;
  const dir = locale === "ar-SA" ? "rtl" : "ltr";

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>{common("projectPlaceholderName")}</h1>
      <p>{common("tagline")}</p>
      <h2>{t("title")}</h2>
      <p>{t("description")}</p>
      <ul>
        <li>
          {t("localeLabel")}: <strong>{locale}</strong>
        </li>
        <li>
          {t("directionLabel")}: <strong>{dir}</strong>
        </li>
      </ul>
      <a href={`/${otherLocale}`}>{t("switchLanguage")}</a>
    </main>
  );
}
