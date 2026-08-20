import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: "home" });

  const dir = appLocale === "ar-SA" ? "rtl" : "ltr";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-content-muted">{t("description")}</p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("localeLabel")}:</dt>
            <dd className="font-medium text-content">{appLocale}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("directionLabel")}:</dt>
            <dd className="font-medium text-content">{dir}</dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
