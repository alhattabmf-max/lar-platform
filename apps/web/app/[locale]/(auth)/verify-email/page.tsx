import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("auth.verifyEmail");


/**
 * As with reset-password, the token is never read on the server, so it
 * never enters the rendered HTML. The client component captures it from
 * the URL, strips it from the address bar, and only then issues the
 * verification request.
 */
export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "auth.verifyEmail" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>
        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <VerifyEmailPanel locale={appLocale} />
        </Suspense>
      </CardBody>
    </Card>
  );
}
