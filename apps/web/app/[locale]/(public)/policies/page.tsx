import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { PublicPolicyVersion } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { loadPolicies } from "@/lib/marketplace-data";
import { localized, formatDate } from "@/lib/localized";
import { policyDocumentLabel } from "@/lib/policy-labels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * The public policies viewer.
 *
 * Readable without an account, deliberately: someone deciding whether
 * to register must be able to read the terms first, and a registration
 * form is the wrong place to encounter them for the first time.
 *
 * Only PUBLISHED versions appear — the API filters on `isPublished`,
 * and the seed ships placeholder content as DRAFT precisely so that
 * unreviewed legal text can never be displayed as if it were in force.
 * An empty list therefore means nothing has been published yet, which
 * is shown plainly rather than as an error.
 */

export default async function PoliciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "policies" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <PolicyList locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function PolicyList({ locale }: { locale: AppLocale }) {
  const appLocale = locale;
  const t = await getTranslations({ locale: appLocale, namespace: "policies" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadPolicies();

  return (
    <div className="flex flex-col gap-6">
      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.length === 0 ? (
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <>
          <nav aria-label={t("contentsLabel")}>
            <ul className="flex flex-col gap-1 text-sm">
              {result.data.map((policy) => (
                <li key={policy.id}>
                  <a href={`#policy-${policy.id}`} className="text-secondary hover:opacity-90">
                    {policyDocumentLabel(policy.documentCode, (code) => t(`documents.${code}`))}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {result.data.map((policy) => (
            <PolicySection
              key={policy.id}
              policy={policy}
              locale={appLocale}
              title={policyDocumentLabel(policy.documentCode, (code) => t(`documents.${code}`))}
              versionLabel={t("version", { label: policy.versionLabel })}
              publishedLabel={t("published")}
              mandatoryLabel={t("mandatory")}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PolicySection({
  policy,
  locale,
  title,
  versionLabel,
  publishedLabel,
  mandatoryLabel,
}: {
  policy: PublicPolicyVersion;
  locale: AppLocale;
  title: string;
  versionLabel: string;
  publishedLabel: string;
  mandatoryLabel: string;
}) {
  const text = localized(locale, policy.textAr, policy.textEn);
  const published = policy.publishedAt ? formatDate(policy.publishedAt, locale) : null;

  return (
    <section
      id={`policy-${policy.id}`}
      aria-labelledby={`policy-heading-${policy.id}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`policy-heading-${policy.id}`} className="text-lg font-semibold text-content">
          {title}
        </h2>
        <span className="text-xs text-content-muted">{versionLabel}</span>
        {policy.isMandatory ? (
          <span className="rounded-md bg-background px-2 py-0.5 text-xs text-content-muted">
            {mandatoryLabel}
          </span>
        ) : null}
      </div>

      {published ? (
        <p className="text-xs text-content-muted">
          {publishedLabel}:{" "}
          <time dateTime={policy.publishedAt ?? undefined}>{published}</time>
        </p>
      ) : null}

      {/* Policy text is PLAIN TEXT and is rendered as a text node.
          `whitespace-pre-wrap` preserves the authored line breaks
          without interpreting anything as markup — dangerouslySetInnerHTML
          is banned repo-wide in this app, and legal copy is the last
          place to make an exception. */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-content">{text}</p>
    </section>
  );
}
