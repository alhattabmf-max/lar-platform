import { getTranslations } from "next-intl/server";
import { getBranding } from "@/lib/branding";
import { themeStyle } from "@/lib/theme";
import type { AppLocale } from "@/i18n/routing";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";

/**
 * The single 403 page every guard redirects to.
 *
 * Deliberately outside both route groups: it must render for a visitor
 * who has a session but the wrong role, so it can belong to neither the
 * signed-out (auth) group nor a role-guarded one. It therefore applies
 * the theme itself rather than inheriting a group shell.
 *
 * It says only that access is not available — never which role would be
 * required, nor what exists at the path. Telling someone "this is the
 * supplier area" confirms the area exists and hints at what to attack.
 */
export default async function UnauthorizedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const [branding, t] = await Promise.all([
    getBranding(),
    getTranslations({ locale: appLocale, namespace: "unauthorized" }),
  ]);

  return (
    <div
      style={themeStyle(branding.theme?.colors)}
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <main id="main-content" tabIndex={-1} className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-content-muted">{t("description")}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href={`/${appLocale}`} variant="secondary">
                {t("goHome")}
              </ButtonLink>
              <ButtonLink href={`/${appLocale}/login`} variant="ghost">
                {t("signInAsAnother")}
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
