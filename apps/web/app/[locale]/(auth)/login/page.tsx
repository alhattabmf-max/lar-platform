import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

/**
 * `returnTo` is sanitised HERE, on the server, before it reaches the
 * client component. Only an internal path survives — an absolute URL,
 * or a protocol-relative `//host`, would turn the login page into an
 * open redirect.
 */
function safeReturnTo(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "auth.login" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-content-muted">{t("description")}</p>

        <LoginForm locale={appLocale} returnTo={safeReturnTo(query.returnTo)} />

        <div className="mt-6 flex flex-col gap-2 text-sm">
          <Link
            href={`/${appLocale}/forgot-password`}
            className="text-secondary hover:opacity-90"
          >
            {t("forgotPassword")}
          </Link>
          <Link href={`/${appLocale}/register`} className="text-secondary hover:opacity-90">
            {t("noAccount")}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
