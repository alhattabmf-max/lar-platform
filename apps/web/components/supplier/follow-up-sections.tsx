import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type {
  SupplierDisputeSummary,
  SupplierReplacementSummary,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import {
  loadSupplierDisputes,
  loadSupplierReplacements,
  loadSupplierSettlements,
} from "@/lib/supplier-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBadge, disputeTone } from "@/components/trader/status-badge";

/**
 * «المتابعة» — three things that were three tabs.
 *
 * The owner's instruction: «احذف تبويب لسان المنازعات والاستبدالات
 * والتسويات وصمّمها على شكل بطاقات داخل صفحة اللسان الجديد باسم
 * المتابعة». Each of the three was a page a supplier had to remember to
 * visit; none of them is a place you go, they are all things that
 * happen TO you. One screen answers "is anything waiting for me?" in a
 * glance, and the three tabs it replaces were three chances to miss it.
 *
 * THE ROWS ARE THE ONES THE LISTS DREW, moved rather than rewritten —
 * the same loaders, the same fifty, the same statuses translated the
 * same way. What changed is where they are read, not what they say.
 *
 * ONE COLUMN INSIDE THE NARROW CARDS. The lists were two across a whole
 * page; disputes and returns now share a row, so two across inside each
 * would be four columns of cards on one screen and a line of text in
 * every one. Settlements keeps two, because its card has the full
 * width to itself.
 *
 * EVERY ROW STILL OPENS ITS OWN PAGE. The detail screens are untouched
 * and are where the work is actually done; these are lists, and a list
 * that tried to hold the work would be a fourth place to look.
 */

/** A section's own head: its name, and how many rows are waiting on it. */
async function SectionCard({
  locale,
  title,
  children,
}: {
  locale: AppLocale;
  title: string;
  children: React.ReactNode;
}) {
  void locale;
  return (
    <Card ariaLabel={title}>
      {/* THE TITLE BAR IS DARK — «اجعل شريط عناوين بطاقات المتابعة
          الثلاث باللون الداكن». Three cards on one screen, each holding
          a list of cards, need their own names to read as headings
          rather than as another row; the platform's navy does that
          without adding a rule or a size.

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

/**
 * WHAT NEEDS AN ANSWER, ABOVE WHAT DOES NOT.
 *
 * A plain bordered group rather than a nested `Card`: a card inside a
 * card is two shadows and two paddings for one heading, and these
 * already sit inside one.
 */
function Awaiting({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 rounded-card border border-warning px-card-x py-card-y"
    >
      <h3 className="text-sm font-semibold text-content">{title}</h3>
      {children}
    </section>
  );
}

// ========================================================== settlements

/**
 * What this supplier has been paid.
 *
 * A payout is per SHIPMENT — `orderAllocationId` is unique on the model
 * — so an order delivered to three branches settles three times.
 *
 * Nothing here is summed. Every amount is a decimal string formatted at
 * the edge of rendering, and a client-side total would be a second
 * source of truth that eventually disagrees with the transfers that
 * actually happened.
 *
 * `ZERO_BALANCE` is an OUTCOME, not a failure: nothing was owed for that
 * shipment. It is toned neutral, never as an error.
 */
export async function SettlementsSection({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.settlements" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  const settlements = await loadSupplierSettlements({ pageSize: 50 });

  return (
    <SectionCard locale={locale} title={t("title")}>
      {!settlements.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={settlements.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : settlements.data.total === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-content-muted">{t("perShipmentNotice")}</p>

          <ul className="grid list-none gap-3 sm:grid-cols-2">
            {settlements.data.items.map((settlement) => {
              const executed = formatDate(settlement.executedAt, locale);

              return (
                <li key={settlement.id}>
                  <Card>
                    <CardBody>
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/${locale}/supplier/settlements/${settlement.id}`}
                          className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                        >
                          <Money
                            amount={settlement.netAmount}
                            currency={settlement.currency}
                            locale={locale}
                            fallback={t("openDetail")}
                          />
                        </Link>

                        <StatusBadge
                          label={status(`payoutOutcome.${settlement.outcome}`)}
                          tone={settlement.outcome === "EXECUTED" ? "done" : "neutral"}
                        />

                        <dl className="grid gap-1 text-sm">
                          {executed ? (
                            <div className="flex flex-wrap gap-2">
                              <dt className="text-content-muted">{t("executedAt")}</dt>
                              <dd className="text-content">
                                <time dateTime={settlement.executedAt}>{executed}</time>
                              </dd>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <dt className="text-content-muted">{t("order")}</dt>
                            <dd>
                              <Link
                                href={`/${locale}/supplier/orders/${settlement.masterOrderId}`}
                                className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                              >
                                {t("openOrder")}
                              </Link>
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>

          {settlements.data.total > settlements.data.items.length ? (
            <p className="text-sm text-content-muted">{t("showingRecent")}</p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

// ============================================================ disputes

/**
 * Disputes raised against this supplier.
 *
 * `awaitingSupplierResponse` is derived server-side from the status, so
 * "does this need me?" is one field rather than a rule this screen has
 * to re-derive — and re-derive identically to the API.
 */
export async function DisputesSection({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.disputes" });
  const states = await getTranslations({ locale, namespace: "states" });

  const disputes = await loadSupplierDisputes({ pageSize: 50 });

  if (!disputes.ok) {
    return (
      <SectionCard locale={locale} title={t("title")}>
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={disputes.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </SectionCard>
    );
  }

  if (disputes.data.total === 0) {
    return (
      <SectionCard locale={locale} title={t("title")}>
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      </SectionCard>
    );
  }

  const awaiting = disputes.data.items.filter((dispute) => dispute.awaitingSupplierResponse);
  const rest = disputes.data.items.filter((dispute) => !dispute.awaitingSupplierResponse);

  return (
    <SectionCard locale={locale} title={t("title")}>
      <div className="flex flex-col gap-4">
        {awaiting.length > 0 ? (
          <Awaiting title={t("awaiting.title")}>
            <DisputeList locale={locale} disputes={awaiting} />
          </Awaiting>
        ) : null}

        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <DisputeList locale={locale} disputes={rest} />
        )}

        {disputes.data.total > disputes.data.items.length ? (
          <p className="text-sm text-content-muted">{t("showingRecent")}</p>
        ) : null}
      </div>
    </SectionCard>
  );
}

async function DisputeList({
  locale,
  disputes,
}: {
  locale: AppLocale;
  disputes: readonly SupplierDisputeSummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.disputes" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="grid list-none gap-3">
      {disputes.map((dispute) => {
        const due = formatDateTime(dispute.supplierResponseDueAt, locale);

        return (
          <li key={dispute.id}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/${locale}/supplier/disputes/${dispute.id}`}
                    className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {status(`disputeReason.${dispute.reasonCode}`)}
                  </Link>

                  {/* The EXACT outcome, never a collapsed "resolved":
                      four different results live under RESOLVED_*. */}
                  <StatusBadge
                    label={status(`dispute.${dispute.status}`)}
                    tone={disputeTone(dispute.status)}
                  />

                  <dl className="grid gap-1 text-sm">
                    {due ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("responseDueAt")}</dt>
                        <dd className="text-content">
                          <time dateTime={dispute.supplierResponseDueAt}>{due}</time>
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("order")}</dt>
                      <dd>
                        <Link
                          href={`/${locale}/supplier/orders/${dispute.orderId}`}
                          className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                        >
                          {t("openOrder")}
                        </Link>
                      </dd>
                    </div>
                  </dl>
                </div>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================= returns

/**
 * What this supplier owes as returns.
 *
 * THE WORD IS «المرتجعات» NOW, on the owner's instruction: «استبدل كلمة
 * الاستبدالات بالمرتجعات». The route, the loader and the API's own
 * `replacement` vocabulary are unchanged — a visible name is not an
 * identifier, and renaming the model to follow a label would rewrite
 * every obligation already recorded.
 *
 * `awaitingSupplierAction` is derived server-side from the status, so
 * this screen does not re-derive the rule.
 */
export async function ReturnsSection({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.replacements" });
  const states = await getTranslations({ locale, namespace: "states" });

  const replacements = await loadSupplierReplacements({ pageSize: 50 });

  if (!replacements.ok) {
    return (
      <SectionCard locale={locale} title={t("title")}>
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={replacements.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </SectionCard>
    );
  }

  if (replacements.data.total === 0) {
    return (
      <SectionCard locale={locale} title={t("title")}>
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      </SectionCard>
    );
  }

  const awaiting = replacements.data.items.filter((item) => item.awaitingSupplierAction);
  const rest = replacements.data.items.filter((item) => !item.awaitingSupplierAction);

  return (
    <SectionCard locale={locale} title={t("title")}>
      <div className="flex flex-col gap-4">
        {awaiting.length > 0 ? (
          <Awaiting title={t("awaiting.title")}>
            <ReplacementList locale={locale} replacements={awaiting} />
          </Awaiting>
        ) : null}

        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <ReplacementList locale={locale} replacements={rest} />
        )}

        {replacements.data.total > replacements.data.items.length ? (
          <p className="text-sm text-content-muted">{t("showingRecent")}</p>
        ) : null}
      </div>
    </SectionCard>
  );
}

async function ReplacementList({
  locale,
  replacements,
}: {
  locale: AppLocale;
  replacements: readonly SupplierReplacementSummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.replacements" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="grid list-none gap-3">
      {replacements.map((replacement) => (
        <li key={replacement.id}>
          <Card>
            <CardBody>
              <div className="flex flex-col gap-2">
                <Link
                  href={`/${locale}/supplier/replacement-obligations/${replacement.id}`}
                  className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                >
                  {t("openDetail")}
                </Link>

                <StatusBadge
                  label={status(`replacement.${replacement.status}`)}
                  tone={
                    // FAILED is on this enum and no other fulfilment one.
                    // A consumer that treats it as unreachable strands the
                    // obligation.
                    replacement.status === "FAILED"
                      ? "attention"
                      : replacement.status === "DELIVERED"
                        ? "done"
                        : "neutral"
                  }
                />

                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("quantity")}</dt>
                    <dd className="text-content">
                      {formatQuantity(replacement.replacementQuantity, locale)}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("createdAt")}</dt>
                    <dd className="text-content">
                      <time dateTime={replacement.createdAt}>
                        {formatDate(replacement.createdAt, locale)}
                      </time>
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("order")}</dt>
                    <dd>
                      <Link
                        href={`/${locale}/supplier/orders/${replacement.orderId}`}
                        className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                      >
                        {t("openOrder")}
                      </Link>
                    </dd>
                  </div>
                </dl>
              </div>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}
