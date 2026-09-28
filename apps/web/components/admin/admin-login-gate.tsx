import { getTranslations } from "next-intl/server";
import { Globe } from "lucide-react";
import { routing, type AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { AdminLoginFlow } from "./admin-login-flow";

/**
 * What an unauthenticated visitor to /admin sees.
 *
 * ITS OWN frame, not `MinimalShell`. That one fetches branding and
 * applies the operator-editable colour theme — so a palette saved with
 * unreadable contrast could make the sign-in screen for fixing it
 * illegible. This screen depends on nothing an administrator can
 * change.
 *
 * It also carries no brand name and no link back to the marketplace.
 * The page says only that credentials are required: a visitor who is
 * not an administrator learns nothing about what is behind it.
 *
 * THE ONE CONTROL BESIDES THE FORM is the language. An operator who
 * cannot read the screen cannot sign in, and being sent to the
 * marketplace home to change it and then having to find their way back
 * is not a fix. It swaps only the locale segment, so whichever step of
 * sign-in the reader is on, they stay on it — the form is untouched.
 */
export async function AdminLoginGate({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.login" });
  const shell = await getTranslations({ locale, namespace: "shell" });
  const otherLocale = routing.locales.find(
    (entry) => entry !== locale,
  ) as AppLocale;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipLink label={shell("skipToContent")} />

      {/* Placed above the card rather than in a bar of its own: the
          chrome for sign-in screens is a separate, later decision, and
          inventing one here would prejudge it. */}
      <div className="flex justify-end px-4 pt-4">
        <LocaleSwitch
          locale={locale}
          otherLocale={otherLocale}
          label={t("switchLocale")}
          className="inline-flex h-10 min-h-10 min-w-10 items-center justify-center rounded-md text-content hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          icon={<Globe aria-hidden="true" className="size-5" />}
        />
      </div>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10"
      >
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
          </header>

          <AdminLoginFlow
            labels={{
              email: t("email"),
              password: t("password"),
              signIn: t("signIn"),
              working: t("working"),

              verifyTitle: t("verifyTitle"),
              code: t("code"),
              codeHint: t("codeHint"),
              verify: t("verify"),
              useRecovery: t("useRecovery"),
              useAuthenticator: t("useAuthenticator"),
              recoveryCode: t("recoveryCode"),
              recoveryHint: t("recoveryHint"),

              setupTitle: t("setupTitle"),
              setupSecret: t("setupSecret"),
              setupSecretHint: t("setupSecretHint"),
              setupRecoveryTitle: t("setupRecoveryTitle"),
              setupRecoveryWarning: t("setupRecoveryWarning"),
              setupConfirm: t("setupConfirm"),
              setupSaved: t("setupSaved"),

              back: t("back"),
              errorTitle: t("errorTitle"),
              requestIdLabel: t("requestIdLabel"),
              required: t("required"),
            }}
          />
        </div>
      </main>
    </div>
  );
}
