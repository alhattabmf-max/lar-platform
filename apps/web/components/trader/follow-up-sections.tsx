import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { DisputeSummary, ReplacementSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import {
  loadDisputes,
  loadMyProductReports,
  loadReplacements,
  type TraderProductReport,
} from "@/lib/trader-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBadge, disputeTone, replacementTone } from "./status-badge";

/**
 * «المتابعة» — three things that were three tabs.
 *
 * The owner's instruction: «أضف لسانًا في صفحة المشتري باسم المتابعة
 * وحُط في صفحته على شكل بطاقات المنازعات… وغيّر اسم الاستبدال إلى
 * الاسترجاع وحُطها بطاقة… وبلاغات المنتجات في بطاقة ثالثة… وألغِ
 * ألسنتها». Each of the three was a page a buyer had to remember to
 * visit; none of them is a place you GO, they are things that happen TO
 * you. One screen answers "is anything waiting for me?" in a glance,
 * and the three tabs it replaces were three chances to miss it.
 *
 * THE ROWS ARE THE ONES THE LISTS DREW, moved rather than rewritten —
 * the same loaders, the same statuses translated the same way. What
 * changed is where they are read, not what they say.
 *
 * EVERY ROW STILL OPENS ITS OWN PAGE. The detail screens are untouched
 * and are where the work is actually done; these are lists, and a list
 * that tried to hold the work would be a fourth place to look.
 *
 * FIFTY, AND NO PAGER. Three paginated lists on one screen would need
 * three page numbers in one query string, and a reader who paged the
 * middle card would watch the other two reset. Fifty is more than any
 * of these three has ever held for one buyer, and each card's own page
 * is one click away for the day that stops being true.
 */

/** A section's own head: its name, over the rows waiting under it. */
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card ariaLabel={title}>
      {/* THE TITLE BAR IS DARK, as the supplier's three are. Cards on
          one screen, each holding a list of cards, need their own names
          to read as headings rather than as another row; the platform's
          navy does that without adding a rule or a size.

          The fill follows the card's own top corners instead of
          squaring them off, and the hairline under it goes with the
          colour that replaced it. */}
      <CardHeader className="rounded-t-card border-b-0 bg-primary">
        <CardTitle className="text-primary-foreground">{title}</CardTitle>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

// ============================================================== disputes

export async function DisputesSection({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.disputes" });
  const states = await getTranslations({ locale, namespace: "states" });
  const follow = await getTranslations({ locale, namespace: "trader.followUp" });

  const result = await loadDisputes({ pageSize: 50 });

  return (
    <SectionCard title={follow("disputes")}>
      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex list-none flex-col gap-3">
          {/* Waiting-on-you first. A dispute where the counterparty still
              owes a response needs nothing from the buyer. */}
          {[...result.data.items]
            .sort((a, b) => Number(a.awaitingCounterparty) - Number(b.awaitingCounterparty))
            .map((dispute) => (
              <li key={dispute.id}>
                <DisputeRow dispute={dispute} locale={locale} />
              </li>
            ))}
        </ul>
      )}
    </SectionCard>
  );
}

async function DisputeRow({ dispute, locale }: { dispute: DisputeSummary; locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.disputes" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });

  const opened = formatDate(dispute.openedAt, locale);
  const due = formatDateTime(dispute.supplierResponseDueAt, locale);

  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface px-card-x py-card-y">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-base font-semibold text-content">
          <Link
            href={`/${locale}/trader/disputes/${dispute.id}`}
            className="hover:text-secondary focus-visible:underline"
          >
            {t(`reason.${dispute.reasonCode}`)}
          </Link>
        </h3>
        {/* The EXACT outcome, translated into a sentence. Never
            "Resolved" — which of the four happened is the whole point. */}
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
        {due && dispute.awaitingCounterparty ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("responseDue")}:</dt>
            <dd className="text-content">
              <time dateTime={dispute.supplierResponseDueAt}>{due}</time>
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="text-sm text-content-muted">
        {dispute.awaitingCounterparty ? t("waitingOnThem") : t("waitingOnYou")}
      </p>

      <Link
        href={`/${locale}/trader/orders/${dispute.orderId}`}
        className="self-start text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]"
      >
        {t("viewOrder")}
      </Link>
    </article>
  );
}

// ============================================================== returns

/**
 * «الاسترجاع» — the same records, under the name the owner gave them.
 *
 * THE ROUTE AND THE MODEL ARE UNTOUCHED. `replacements` is still the
 * segment, `ReplacementSummary` is still the shape, and the API knows
 * nothing about this word: «غيّر اسم الاستبدال إلى الاسترجاع» is what
 * the buyer READS, and renaming a column to match a label is how a
 * rename becomes a migration.
 */
export async function ReturnsSection({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.replacements" });
  const states = await getTranslations({ locale, namespace: "states" });
  const follow = await getTranslations({ locale, namespace: "trader.followUp" });

  const result = await loadReplacements({ pageSize: 50 });

  return (
    <SectionCard title={follow("returns")}>
      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex list-none flex-col gap-3">
          {result.data.items.map((replacement) => (
            <li key={replacement.id}>
              <ReplacementRow replacement={replacement} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

async function ReplacementRow({
  replacement,
  locale,
}: {
  replacement: ReplacementSummary;
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "trader.replacements" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });

  const created = formatDate(replacement.createdAt, locale);

  return (
    <article
      className={`flex flex-col gap-2 rounded-card border px-card-x py-card-y ${
        replacement.status === "FAILED"
          ? "border-warning bg-warning-surface"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-base font-semibold text-content">
          <Link
            href={`/${locale}/trader/replacements/${replacement.id}`}
            className="hover:text-secondary focus-visible:underline"
          >
            {t("itemTitle", {
              quantity: formatQuantity(replacement.replacementQuantity, locale),
            })}
          </Link>
        </h3>
        <StatusBadge
          label={statuses(`replacement.${replacement.status}`)}
          tone={replacementTone(replacement.status)}
        />
      </div>

      {created ? (
        <p className="text-sm text-content-muted">
          {t("createdAt")}: <time dateTime={replacement.createdAt}>{created}</time>
        </p>
      ) : null}

      <p className="text-sm text-content">{t(`next.${replacement.status}`)}</p>

      <Link
        href={`/${locale}/trader/orders/${replacement.orderId}`}
        className="self-start text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]"
      >
        {t("viewOrder")}
      </Link>
    </article>
  );
}

// ======================================================= product reports

export async function ProductReportsSection({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.productReports" });
  const states = await getTranslations({ locale, namespace: "states" });
  const follow = await getTranslations({ locale, namespace: "trader.followUp" });

  const result = await loadMyProductReports();

  return (
    <SectionCard title={follow("productReports")}>
      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex list-none flex-col gap-3">
          {result.data.map((report) => (
            <li key={report.id}>
              <ProductReportRow report={report} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

async function ProductReportRow({
  report,
  locale,
}: {
  report: TraderProductReport;
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "trader.productReports" });
  const created = formatDate(report.createdAt, locale);

  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface px-card-x py-card-y">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* Closed vocabularies, translated. A raw `COUNTERFEIT_SUSPECTED`
            asks a reader to decode an enum. Unknown values fall back to
            the code itself rather than rendering an empty cell. */}
        <h3 className="min-w-0 flex-1 text-base font-semibold text-content">
          {t.has(`reason.${report.reasonCode}`) ? t(`reason.${report.reasonCode}`) : report.reasonCode}
        </h3>
        <StatusBadge
          label={t.has(`status.${report.status}`) ? t(`status.${report.status}`) : report.status}
          tone={
            report.status === "CLARIFICATION_REQUESTED"
              ? "attention"
              : report.status === "OPEN"
                ? "neutral"
                : "done"
          }
        />
      </div>

      {created ? (
        <p className="text-sm text-content-muted">
          {t("reportedAt")}: <time dateTime={report.createdAt}>{created}</time>
        </p>
      ) : null}

      <p className="text-sm text-content">
        {t.has(`next.${report.status}`) ? t(`next.${report.status}`) : t("next.default")}
      </p>
    </article>
  );
}
