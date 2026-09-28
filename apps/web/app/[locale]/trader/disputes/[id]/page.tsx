import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadDispute } from "@/lib/trader-data";
import { formatDateTime } from "@/lib/localized";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, disputeTone } from "@/components/trader/status-badge";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.disputes");


/**
 * One dispute.
 *
 * Three parties write into a dispute, and what is shown is decided per
 * SOURCE — enforced by the API's projection, which this page consumes
 * rather than re-deciding:
 *
 *   the trader's own      shown. They wrote it.
 *   the supplier's reply  shown, including its text. A response is
 *                         addressed TO them, and withholding it would
 *                         say they lost without saying why.
 *   the decision          the exact outcome. The administrator's
 *                         internal note and identity never arrive here.
 *   evidence              only their own COMPANY's, and metadata only.
 *
 * NO DOWNLOAD. There is no authorised per-resource delivery endpoint
 * for dispute evidence, and the contract carries no storage key — so a
 * link could only be forged. Metadata lets someone confirm their file
 * arrived and what it was; retrieving it waits for a real endpoint.
 * The absence is stated in the copy rather than left as a puzzle.
 */
export default async function TraderDisputeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.disputes" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/disputes`} className="text-secondary hover:opacity-[var(--state-hover-opacity)]">
          {t("backToList")}
        </Link>
      </nav>

      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <DisputeBody locale={appLocale} id={id} />
      </Suspense>
    </div>
  );
}

async function DisputeBody({ locale, id }: { locale: AppLocale; id: string }) {
  const t = await getTranslations({ locale, namespace: "trader.disputes" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadDispute(id);

  if (!result.ok && result.notFound) notFound();

  if (!result.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const dispute = result.data;
  const opened = formatDateTime(dispute.openedAt, locale);
  const due = formatDateTime(dispute.supplierResponseDueAt, locale);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold text-content">
            {t(`reason.${dispute.reasonCode}`)}
          </h1>
          <StatusBadge
            label={statuses(`dispute.${dispute.status}`)}
            tone={disputeTone(dispute.status)}
          />
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {opened ? (
            <div className="flex gap-2">
              <dt className="text-content-muted">{t("openedAt")}:</dt>
              <dd className="text-content">
                <time dateTime={dispute.openedAt}>{opened}</time>
              </dd>
            </div>
          ) : null}
          {due ? (
            <div className="flex gap-2">
              <dt className="text-content-muted">{t("responseDue")}:</dt>
              <dd className="text-content">
                <time dateTime={dispute.supplierResponseDueAt}>{due}</time>
              </dd>
            </div>
          ) : null}
        </dl>

        <Link
          href={`/${locale}/trader/orders/${dispute.orderId}`}
          className="self-start text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]"
        >
          {t("viewOrder")}
        </Link>
      </header>

      <section aria-label={t("yourDescription")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-content">{t("yourDescription")}</h2>
        {/* The trader's own words, as a text node. `whitespace-pre-wrap`
            keeps their line breaks; nothing is parsed or linked. */}
        <p className="whitespace-pre-wrap rounded-card bg-surface shadow-card px-card-x py-card-y text-sm text-content">
          {dispute.description}
        </p>
      </section>

      <section aria-label={t("evidence.title")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-content">{t("evidence.title")}</h2>

        {dispute.evidence.length === 0 ? (
          <p className="text-sm text-content-muted">{t("evidence.none")}</p>
        ) : (
          <>
            <ul className="flex list-none flex-col gap-2">
              {dispute.evidence.map((item, index) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface p-3 text-sm"
                >
                  {/* There is no filename on the row — the upload
                      service stores only content type and size, and
                      deriving a name from the storage key would mean
                      exposing the key. So the items are numbered. */}
                  <span className="text-content">{t("evidence.item", { index: index + 1 })}</span>
                  <span className="text-content-muted">
                    {item.contentType ?? t("evidence.unknownType")}
                    {item.sizeBytes !== null
                      ? ` · ${t("evidence.size", {
                          kb: Math.max(1, Math.round(item.sizeBytes / 1024)),
                        })}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
            {/* Stated, not left as a puzzle: there is no download
                because there is no endpoint that could authorise one. */}
            <p className="text-sm text-content-muted">{t("evidence.noDownload")}</p>
          </>
        )}

        <p className="text-sm text-content-muted">{t("evidence.companyOnly")}</p>
      </section>

      {dispute.supplierResponse ? (
        <section aria-label={t("supplierResponse.title")} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-content">{t("supplierResponse.title")}</h2>
          <div className="flex flex-col gap-2 rounded-card bg-surface shadow-card px-card-x py-card-y">
            <p className="text-sm font-medium text-content">
              {t(`supplierResponse.type.${dispute.supplierResponse.responseType}`)}
            </p>
            {/* Counterparty free text, rendered as a React text node.
                Never dangerouslySetInnerHTML, and never auto-linked —
                a URL turned into a link here is a link the platform
                did not vet. */}
            <p className="whitespace-pre-wrap text-sm text-content">
              {dispute.supplierResponse.description}
            </p>
            <p className="text-sm text-content-muted">
              <time dateTime={dispute.supplierResponse.respondedAt}>
                {formatDateTime(dispute.supplierResponse.respondedAt, locale)}
              </time>
            </p>
          </div>
        </section>
      ) : null}

      {dispute.decisions.length > 0 ? (
        <section aria-label={t("decisions.title")} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-content">{t("decisions.title")}</h2>
          <ol className="flex list-none flex-col gap-2">
            {dispute.decisions.map((decision) => (
              <li
                key={decision.sequenceNumber}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface shadow-card px-card-x py-card-y text-sm"
              >
                {/* The exact decision type. No internal note, and no
                    member of staff named — neither reaches this page. */}
                <span className="font-medium text-content">
                  {t(`decisions.type.${decision.decisionType}`)}
                </span>
                <time dateTime={decision.decidedAt} className="text-content-muted">
                  {formatDateTime(decision.decidedAt, locale)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="text-sm text-content-muted">{t(`next.${dispute.status}`)}</p>
    </div>
  );
}
