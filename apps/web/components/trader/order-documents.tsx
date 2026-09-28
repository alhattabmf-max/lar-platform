import { NOT_A_TAX_INVOICE, type DocumentSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { formatDate } from "@/lib/localized";
import { Money } from "@/components/ui/money";

/**
 * The internal documents belonging to ONE order.
 *
 * Read from that order's own endpoint, `GET /trader/orders/:id/documents`.
 * There is no standalone documents page and no flat documents endpoint:
 * building one would mean fanning out over the orders list, whose page
 * boundaries are the ORDERS' — a reader would watch rows skip and
 * repeat as they paged.
 *
 * WHAT THESE ARE NOT. Every item carries `notice: NOT_A_TAX_INVOICE`,
 * and it is rendered prominently rather than tucked into a footnote,
 * because someone will otherwise file one of these as a tax invoice.
 * There is no PDF, no QR code, no ZATCA identifier and no download —
 * not hidden, not disabled, ABSENT. The contract carries no field for
 * any of them, so no view can render one by accident, and an offer to
 * download something that cannot be downloaded is worse than no offer.
 *
 * `INTERNAL_COMMISSION_DRAFT` is withheld by the API and never reaches
 * this component. It records what the platform charges the SUPPLIER,
 * which is not the trader's business.
 */
export interface OrderDocumentsLabels {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  amount: string;
  issuedAt: string;
  reference: string;
  /** The legal statement. Prominent, never a footnote. */
  notTaxInvoice: string;
  amountUnavailable: string;
  /** Translated per document type. */
  typeLabel: (documentType: string) => string;
}

export function OrderDocuments({
  documents,
  locale,
  labels,
}: {
  documents: readonly DocumentSummary[];
  locale: AppLocale;
  labels: OrderDocumentsLabels;
}) {
  return (
    <section aria-label={labels.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-content">{labels.title}</h2>
      </div>

      {documents.length === 0 ? (
        <div className="rounded-card bg-surface shadow-card px-card-x py-card-y">
          <p className="text-sm font-medium text-content">{labels.emptyTitle}</p>
          <p className="text-sm text-content-muted">{labels.emptyDescription}</p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-3">
          {documents.map((document) => {
            const issued = formatDate(document.issuedAt, locale);

            return (
              <li
                key={document.id}
                className="flex flex-col gap-2 rounded-card bg-surface shadow-card px-card-x py-card-y"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-content">
                    {labels.typeLabel(document.documentType)}
                  </h3>
                  {/* Read from the response, not hardcoded here: the
                      notice is a field on every item, and rendering a
                      constant would let a document without one look
                      the same as a document with one. */}
                  {document.notice === NOT_A_TAX_INVOICE ? (
                    <span className="rounded-md border border-warning bg-warning-surface px-2 py-0.5 text-xs font-semibold text-warning-text">
                      {labels.notTaxInvoice}
                    </span>
                  ) : null}
                </div>

                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="text-content-muted">{labels.amount}:</dt>
                    <dd className="text-content">
                      <Money
                        amount={document.amount}
                        currency={document.currency}
                        locale={locale}
                        fallback={
                          <span className="text-content-muted">
                            {labels.amountUnavailable}
                          </span>
                        }
                      />
                    </dd>
                  </div>
                  {issued ? (
                    <div className="flex gap-2">
                      <dt className="text-content-muted">{labels.issuedAt}:</dt>
                      <dd className="text-content">
                        <time dateTime={document.issuedAt}>{issued}</time>
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex min-w-0 gap-2">
                    <dt className="text-content-muted">{labels.reference}:</dt>
                    {/* An internal reference someone can quote to
                        support. `break-all` because it has no spaces
                        and would otherwise push the page sideways at
                        360px. */}
                    <dd className="min-w-0 break-all font-mono text-content" dir="ltr">
                      {document.internalDocumentReference}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
