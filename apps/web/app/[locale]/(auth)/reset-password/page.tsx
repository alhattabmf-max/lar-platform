import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("auth.resetPassword");


/**
 * The token is NOT read here.
 *
 * This server component deliberately never touches `searchParams`, so
 * the recovery token cannot reach the RSC payload or the rendered HTML.
 * The client component captures it from the address bar on mount and
 * immediately strips it from the URL — see lib/use-one-time-token.ts.
 *
 * The Suspense boundary remains because the child renders a loading
 * state until that capture-and-clean step finishes.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "auth.resetPassword" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>

        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <ResetPasswordForm locale={appLocale} />
        </Suspense>

        <p className="mt-6 text-sm">
          <Link href={`/${appLocale}/login`} className="text-secondary hover:opacity-[var(--state-hover-opacity)]">
            {t("backToLogin")}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
