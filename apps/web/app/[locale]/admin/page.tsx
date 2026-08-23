import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OUTBOX_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminDisputes,
  loadAdminRefunds,
  loadOutboxStats,
  loadPendingBankAccounts,
  loadPendingProducts,
  loadPendingSuppliers,
} from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";

/**
 * The operator's first screen.
 *
 * NEEDS-ATTENTION FIRST, and nothing else above it. Everything here is
 * a queue with something waiting in it, ordered by what goes wrong if
 * it is ignored: a supplier who cannot trade, a product that cannot be
 * bought, a payout that cannot be made, a buyer waiting on a decision,
 * money owed back, and finally the relay that carries every
 * notification the rest depends on.
 *
 * A zero count is still SHOWN, greyed, rather than hidden. A queue that
 * disappears when empty teaches the reader to scan for what is there,
 * and the day it reappears they have no baseline for whether six is
 * normal. It is also how someone learns the queue exists at all.
 *
 * NOTHING HERE IS COMPUTED FROM SAMPLES. Each figure is a `total` from
 * a paginated endpoint or a count the API produced — never
 * `items.length` of a first page, which would silently read "25" for
 * any backlog larger than a page and be wrong in the direction that
 * matters.
 *
 * Each panel loads independently and each renders its own failure. An
 * operator whose dashboard goes blank because one read is down has lost
 * the screen they would use to find out why.
 */
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const session = await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.dashboard" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      {/* An administrator without an authenticator app is a real
          finding, not a cosmetic one, so it sits above the queues. */}
      {!session.twoFactorEnabled ? (
        <div role="alert" className="rounded-lg border border-warning bg-warning-surface p-4">
          <p className="text-sm font-medium text-content">{t("twoFactorTitle")}</p>
          <p className="text-sm text-warning-text">{t("twoFactorDescription")}</p>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("needsAttention")}</h2>
        <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
          <Queues locale={appLocale} />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("deliveryTitle")}</h2>
        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <Delivery locale={appLocale} />
        </Suspense>
      </section>
    </div>
  );
}

async function Queues({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  // Fetched together rather than in sequence: six independent reads
  // that each take a network round trip, and waiting for them one after
  // another is six times the wait for no benefit.
  const [suppliers, products, bankAccounts, disputes, refunds] = await Promise.all([
    loadPendingSuppliers(),
    loadPendingProducts(),
    loadPendingBankAccounts(),
    // `status: "OPEN"` is the queue: a dispute the supplier has already
    // answered is not waiting on an operator in the same way.
    loadAdminDisputes({ status: "OPEN", pageSize: 1 }),
    loadAdminRefunds({ status: "PENDING_EXECUTION", pageSize: 1 }),
  ]);

  const base = `/${locale}/admin`;

  const queues = [
    {
      key: "suppliers",
      href: `${base}/companies?verificationStatus=PENDING_VERIFICATION`,
      // These three endpoints return a plain array, not a page, so
      // `length` IS the total rather than a page of one.
      count: suppliers.ok ? suppliers.data.length : null,
      failed: !suppliers.ok,
    },
    {
      key: "products",
      href: `${base}/products?approvalStatus=PENDING_REVIEW`,
      count: products.ok ? products.data.length : null,
      failed: !products.ok,
    },
    {
      key: "bankAccounts",
      href: `${base}/bank-accounts`,
      count: bankAccounts.ok ? bankAccounts.data.length : null,
      failed: !bankAccounts.ok,
    },
    {
      key: "disputes",
      href: `${base}/disputes?status=OPEN`,
      // `total` from the paginated envelope — the real backlog, not the
      // one row that was fetched to obtain it.
      count: disputes.ok ? disputes.data.total : null,
      failed: !disputes.ok,
    },
    {
      key: "refunds",
      href: `${base}/refunds?status=PENDING_EXECUTION`,
      count: refunds.ok ? refunds.data.total : null,
      failed: !refunds.ok,
    },
  ] as const;

  return (
    <ul className="grid list-none gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {queues.map((queue) => (
        <li key={queue.key}>
          <Card>
            <CardBody>
              <Link
                href={queue.href}
                className="flex min-h-11 flex-col gap-1 text-content hover:opacity-90"
              >
                <span className="text-sm text-content-muted">{t(`queues.${queue.key}`)}</span>
                {queue.failed ? (
                  // A failed read shows as unavailable, never as zero.
                  // "0 waiting" and "we could not find out" are
                  // different facts, and conflating them is how a
                  // backlog goes unnoticed.
                  <span className="text-sm text-danger-text">{states("errorTitle")}</span>
                ) : (
                  <span
                    className={
                      queue.count && queue.count > 0
                        ? "text-2xl font-semibold text-content"
                        : "text-2xl font-semibold text-content-muted"
                    }
                  >
                    {queue.count}
                  </span>
                )}
              </Link>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}

async function Delivery({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.dashboard" });
  const states = await getTranslations({ locale, namespace: "states" });

  const stats = await loadOutboxStats();

  if (!stats.ok) {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {states("errorTitle")}
      </p>
    );
  }

  const oldest = stats.data.oldestPendingAt
    ? formatDateTime(stats.data.oldestPendingAt, locale)
    : null;

  return (
    <Card>
      <CardBody>
        <div className="flex flex-col gap-3">
          {/* The provider mode is stated FIRST and on every screen that
              shows delivery figures. While it is a simulated mode
              nothing reaches anyone, and "PUBLISHED" would otherwise
              read as "delivered". */}
          <p className="rounded-md border border-line bg-background px-3 py-2 text-sm text-content">
            {t("providerMode", { mode: stats.data.providerMode })}
          </p>

          <dl className="grid gap-2 sm:grid-cols-4">
            {OUTBOX_STATUSES.map((status) => (
              <div key={status} className="flex flex-col">
                <dt className="text-sm text-content-muted">{t(`outbox.${status}`)}</dt>
                <dd className="text-xl font-semibold text-content">
                  {stats.data.counts[status]}
                </dd>
              </div>
            ))}
          </dl>

          <p className="text-sm text-content-muted">
            {oldest ? t("oldestPending", { when: oldest }) : t("noBacklog")}
          </p>

          <Link
            href={`/${locale}/admin/outbox`}
            className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
          >
            {t("openOutbox")}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
