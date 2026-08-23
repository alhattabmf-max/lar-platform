import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";
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
 */
export async function AdminLoginGate({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.login" });
  const shell = await getTranslations({ locale, namespace: "shell" });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipLink label={shell("skipToContent")} />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10"
      >
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
            <p className="text-sm text-content-muted">{t("description")}</p>
          </header>

          <AdminLoginFlow
            labels={{
              email: t("email"),
              password: t("password"),
              signIn: t("signIn"),
              working: t("working"),

              verifyTitle: t("verifyTitle"),
              verifyDescription: t("verifyDescription"),
              code: t("code"),
              codeHint: t("codeHint"),
              verify: t("verify"),
              useRecovery: t("useRecovery"),
              useAuthenticator: t("useAuthenticator"),
              recoveryCode: t("recoveryCode"),
              recoveryHint: t("recoveryHint"),

              setupTitle: t("setupTitle"),
              setupDescription: t("setupDescription"),
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
