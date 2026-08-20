import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: "auth.forgotPassword" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-content-muted">{t("description")}</p>
        <ForgotPasswordForm />
        <p className="mt-6 text-sm">
          <Link href={`/${appLocale}/login`} className="text-secondary hover:opacity-90">
            {t("backToLogin")}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
