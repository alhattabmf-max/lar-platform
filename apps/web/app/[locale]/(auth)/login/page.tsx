import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("auth.login");


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
        <CardTitle as="h1">{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {/* NO STANDING EXPLANATION under the heading. It read "use
            your commercial registration number and your password" —
            which the two labelled fields beneath it already say, in
            the place a person is actually looking. */}

        <LoginForm locale={appLocale} returnTo={safeReturnTo(query.returnTo)} />

        {/* REACH, NOT SIZE. Both links measured twenty pixels tall —
            the height of their own line — and they are the only way
            out of this page for somebody who cannot sign in.

            The padding gives each a 44px target and the negative
            margin takes the same space back out of the column, so the
            gap between them, the type size and the colour are exactly
            what they were. */}
        <div className="mt-6 flex flex-col gap-2 text-sm">
          <Link
            href={`/${appLocale}/forgot-password`}
            className="-my-2 inline-flex min-h-[44px] items-center py-2 text-secondary hover:opacity-[var(--state-hover-opacity)]"
          >
            {t("forgotPassword")}
          </Link>
          <Link href={`/${appLocale}/register`} className="-my-2 inline-flex min-h-[44px] items-center py-2 text-secondary hover:opacity-[var(--state-hover-opacity)]">
            {t("noAccount")}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
