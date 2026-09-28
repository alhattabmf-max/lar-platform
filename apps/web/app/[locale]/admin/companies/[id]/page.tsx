import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  COMPANY_DELETION_BLOCKER_KINDS,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminCompany,
  loadCompanyDeletionEligibility,
} from "@/lib/admin-data";
import { loadCities, loadRegions } from "@/lib/marketplace-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { Money } from "@/components/ui/money";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { companyOperationalStatus } from "@platform/types";
import { SupplierVerificationLine } from "@/components/admin/supplier-verification-line";
import { CompanyActivityStrip } from "@/components/admin/company-activity-strip";
import { CompanyPanels } from "@/components/admin/company-panels";
import { AdminAction } from "@/components/admin/admin-action";
import { ExportToExcel } from "@/components/admin/export-to-excel";
import { exportLabelQuery } from "@/lib/admin-export-query";

/**
 * One company, on one page.
 *
 * NO TABS. The two halves this replaces meant an operator looking for a
 * branch's telephone had to know which half held it. The sections run in
 * the order the work does — what the company is, where it is, what it
 * has done, what has been done to it, and last the two operations that
 * stop it — and a desktop shows most of that without scrolling.
 *
 * THE SAME PAGE FOR BOTH KINDS. A buyer and a supplier are managed
 * identically, and a buyer is never verified and sees no mention of it
 * at all. A supplier gains one card, and only once it has actually
 * asked: the verification request, with approve, return and reject.
 *
 * THAT CARD IS HERE and not in a queue of its own because this is the
 * page that shows what is being approved. The follow-up centre lists
 * the case and links here; deciding from a name and a date, without
 * the record in front of you, is not reviewing anything.
 */

/**
 * The tab's name. The layout supplies « | لوحة التحكم ».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.companies",
  });
  return { title: t("detailTitle") };
}

export default async function AdminCompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // THE ADDRESS'S OWN PARAMETERS ARE NOT READ ANY MORE. They carried
  // the register view a reader came from, for the trail's way back —
  // see the note below. `searchParams` stays in the signature because
  // Next passes it to every page and awaiting it is how this file
  // resolves its own route.
  const [{ locale, id }] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.companyDetail",
  });
  const list = await getTranslations({
    locale: appLocale,
    namespace: "admin.companies",
  });
  const users = await getTranslations({
    locale: appLocale,
    namespace: "admin.companies.users",
  });
  const vocab = await getTranslations({
    locale: appLocale,
    namespace: "admin.vocab",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const actions = await getTranslations({
    locale: appLocale,
    namespace: "admin.actions",
  });
  const money = await getTranslations({
    locale: appLocale,
    namespace: "admin.money",
  });

  const [company, eligibility, regions, cities] = await Promise.all([
    loadAdminCompany(id),
    loadCompanyDeletionEligibility(id),
    // BOTH LISTS: the region is what a branch is recorded against and
    // the form requires one; the cities are the optional refinement
    // beneath whichever region is chosen.
    loadRegions(),
    loadCities(),
  ]);

  if (!company.ok) {
    // A 404 is a company that is not there — including one just
    // removed — and is a different answer from "the read failed".
    if (company.error.kind === "notFound") notFound();
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={company.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const data = company.data;
  // ACTIVE MEANS VERIFIED. This read `!== SUSPENDED`, which drew
  // «نشطة» on a supplier that had registered a minute ago and could
  // do nothing at all.
  const operational = companyOperationalStatus(data.verificationStatus);
  const isSupplier = data.accountType === "SUPPLIER";
  const currency = money("platformCurrency");
  const today = new Date().toISOString().slice(0, 10);

  /**
   * THE WAY BACK TO THE REGISTER WENT WITH THE TRAIL.
   *
   * «ألغِ التعليمات ذي لأنها شرح ولا أحتاج شرح… صحيح، في جميع
   *  الصفحات.»
   *
   * IT WAS MORE THAN AN EXPLANATION HERE, and that is worth writing
   * down rather than losing: the middle entry linked back to the
   * register carrying the tab, the search, the filters, the page and
   * the page size the reader had arrived with — re-encoded through
   * `URLSearchParams` against an allow-list, because the value came
   * from an address bar and pasting it raw would let one crafted
   * link write any parameter it liked into that href.
   *
   * WHAT REMAINS is the row of screens under the rule, which opens
   * the register in one press — at its own default view, not at the
   * page the reader left. If that turns out to matter, this is the
   * note that says what it cost and how it was built.
   */

  /**
   * WHO CAN SIGN IN, built here and handed to the record card.
   *
   * A SERVER-RENDERED NODE. The table renders `AdminAction` for the
   * password reset and the session revoke, and neither needs a gram
   * of the state `CompanyPanels` holds — so it is passed through
   * rather than moved into the browser bundle, and the accounts still
   * read as part of the one record rather than as a separate box.
   */
  /**
   * THE TWO THINGS AN ADMINISTRATOR MAY DO TO THE LOGIN.
   *
   * «حتى حساب الدخول لا أحتاجه وبياناته، لأنه مكرّر: الإيميل، والدخول
   *  أصلًا عن طريق رقم السجل… أمّا استرجاع كلمة المرور وإنهاء الجلسة
   *  نقدر نحتفظ بها وتكون في الشريط الداكن.»
   *
   * THE TABLE IS GONE AND NOTHING WENT WITH IT. `USER_COMPANY_ROLES`
   * holds one role, so it was always a single row; login is by the
   * COMMERCIAL REGISTRATION, not by the address; and the address is
   * already a field of the record. Its two actions ride in the band
   * now, and the three facts it carried — whether a password is set,
   * whether the address is verified, and the account's own state —
   * stand beside that address.
   *
   * THE EXPORT WENT WITH THE TABLE. A spreadsheet of one row, whose
   * every column is on the screen above it, is a file nobody opens.
   *
   * NEITHER ACTION SETS A PASSWORD. The reset sends the company's own
   * «forgot password» mail to the address on file; nothing here can
   * read, choose or see a password, and an administrator who wanted
   * to take an account over would have to control that mailbox.
   * Revoking signs the person out everywhere and changes nothing
   * else.
   */
  const actionLabels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  const owner =
    data.users.find((user) => user.role === "OWNER") ?? data.users[0];

  const accountActions = owner ? (
    <>
      <AdminAction
        path={`/admin/companies/${encodeURIComponent(
          id,
        )}/users/${encodeURIComponent(owner.id)}/password-reset`}
        variant="secondary"
        labels={{
          ...actionLabels,
          action: users("resetPassword"),
          prompt: users("resetPasswordPrompt"),
        }}
      />
      <AdminAction
        path={`/admin/companies/${encodeURIComponent(
          id,
        )}/users/${encodeURIComponent(owner.id)}/revoke-sessions`}
        variant="secondary"
        labels={{
          ...actionLabels,
          action: users("revokeSessions"),
          prompt: users("revokeSessionsPrompt"),
        }}
      />
    </>
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* NO TRAIL — «ألغِ التعليمات ذي لأنها شرح ولا أحتاج شرح…
          صحيح، في جميع الصفحات».

          THIS ONE CARRIED A WAY BACK as well as an explanation: its
          middle entry linked to the register with the tab and the page
          the reader came from. The record head below still names the
          company, and the row of screens under the rule still opens
          the register in one press. */}
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <h1
          className="min-w-0 break-words text-xl font-semibold text-content"
          data-testid="company-title"
        >
          {data.legalName}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={vocab(`accountType.${data.accountType}`)}
            tone="neutral"
          />
          <StatusBadge
            label={t(`operational.${operational}`)}
            tone={
              operational === "ACTIVE"
                ? "done"
                : operational === "SUSPENDED"
                  ? "attention"
                  : "neutral"
            }
            data-testid="company-operational-status"
          />
          {/* The badge says the outcome; the card below is where the
              decision is taken. A buyer never reaches this branch. */}
          {isSupplier && data.verificationStatus === "VERIFIED" ? (
            <StatusBadge
              label={vocab("companyVerification.VERIFIED")}
              tone="done"
              data-testid="company-verified-badge"
            />
          ) : null}
        </div>

        {/* THE FOUR READINGS, IN THE GAP THE TITLE ROW ALREADY HAD —
            «خلّ كل جزء في بطاقة، في طرفها لون، وارفعها في الشريط اللي
             فوقها في المساحة الفاضية بين اسم المورّد أو المشتري وأزرار
             التوثيق».

            `ms-auto` here rather than on the verification line: the
            FIRST auto margin in a flex row takes the free space, so
            the readings are pushed off the name and the decision
            follows them at the end. */}
        <div className="ms-auto min-w-0">
          <CompanyActivityStrip
            readings={[
              {
                key: "orders",
                tone: "secondary",
                label: list("orderCount"),
                value: String(
                  isSupplier
                    ? data.counts.ordersAsSupplier
                    : data.counts.ordersAsTrader,
                ),
              },
              {
                key: "purchases",
                tone: "accent",
                label: isSupplier ? t("supplierPayable") : t("totalPurchases"),
                value: (
                  <Money
                    amount={
                      isSupplier
                        ? data.totals.supplierPayable
                        : data.totals.purchases
                    }
                    currency={currency}
                    locale={appLocale}
                    fallback={<span className="text-content-muted">—</span>}
                  />
                ),
              },
              {
                key: "opportunities",
                tone: "primary",
                label: list("opportunityCount"),
                value: String(data.counts.opportunities),
              },
              {
                key: "disputes",
                tone: "danger",
                label: t("disputes"),
                value: String(data.counts.disputes),
              },
            ]}
          />
        </div>

        {/* THE VERIFICATION, ON ONE LINE, AT THE FAR END OF THE NAME —
            «خلّيها سطرًا واحدًا بكافة معلوماتها، مقابل اسم المورّد اللي
             فوقه، موازي له».

            It was a five-line card of its own above everything else;
            every fact on it is four or five characters long. NOTHING
            IS DRAWN when there is nothing to decide — the component
            returns null for a supplier that never submitted — and a
            buyer never reaches it at all. */}
        {isSupplier && data.verification ? (
          <div className="min-w-0">
            <SupplierVerificationLine
              locale={appLocale}
              companyId={data.id}
              companyLegalName={data.legalName}
              verification={data.verification}
            />
          </div>
        ) : null}
      </header>


      <CompanyPanels
        company={data}
        accountActions={accountActions}
        registeredAtLabel={formatDate(data.createdAt, appLocale) ?? "—"}
        eligibility={eligibility.ok ? eligibility.data : null}
        blockerNames={Object.fromEntries(
          COMPANY_DELETION_BLOCKER_KINDS.map((kind) => [
            kind,
            t(`blocker.${kind}`),
          ]),
        )}
        regions={
          regions.ok
            ? regions.data.map((region) => ({
                id: region.id,
                name: appLocale.startsWith("ar") ? region.nameAr : region.nameEn,
                alternateName: appLocale.startsWith("ar")
                  ? region.nameEn
                  : region.nameAr,
              }))
            : []
        }
        cities={
          cities.ok
            ? cities.data.map((city) => ({
                regionId: city.region.id,
                id: city.id,
                name: appLocale === "ar-SA" ? city.nameAr : city.nameEn,
                alternateName: appLocale === "ar-SA" ? city.nameEn : city.nameAr,
                group:
                  appLocale === "ar-SA" ? city.region.nameAr : city.region.nameEn,
              }))
            : []
        }

        audit={data.recentActivity.map((entry) => ({
          id: entry.id,
          at: formatDateTime(entry.createdAt, appLocale) ?? "—",
          action: entry.action,
          actor: entry.actorType,
          // The reason when the action took one; otherwise what moved.
          details: entry.reason ?? describeChange(entry.before, entry.after),
        }))}
        auditExport={
          <ExportToExcel
            path={`/admin/companies/${encodeURIComponent(id)}/audit/export?${exportLabelQuery(
              {
                columns: [
                  t("activityAction"),
                  t("activityActor"),
                  t("activityReason"),
                  t("auditBefore"),
                  t("auditAfter"),
                  t("activityAt"),
                ],
                fileLabel: t("exportAudit"),
                date: today,
              },
            ).toString()}`}
            disabled={data.recentActivity.length === 0}
            testId="export-company-audit"
            labels={{
              action: t("exportAction"),
              working: actions("working"),
              empty: t("exportEmpty"),
              errorTitle: states("errorTitle"),
              requestIdLabel: states("requestIdLabel"),
            }}
          />
        }
        labels={{
          detailsTitle: t("detailsTitle"),
          legalName: list("legalName"),
          crNumber: list("crNumber"),
          email: t("ownerEmail"),
          phones: t("phones"),
          registeredAt: t("registeredAt"),
          operationalStatus: list("operationalStatus"),
          operationalValue: t(`operational.${operational}`),
          edit: t("editData"),
          copyEmail: list("copyEmail"),
          copiedEmail: list("copiedEmail"),
          copyCrNumber: list("copyCrNumber"),
          copiedCrNumber: list("copiedCrNumber"),
          noPhones: t("noPhones"),
          mobile1: t("mobile1"),
          mobile2: t("mobile2"),

          branchesTitle: t("branchesTitle"),
          branchName: t("branchName"),
          branchRegion: t("branchRegion"),
          regionPlaceholder: t("regionPlaceholder"),
          regionNoMatch: t("regionNoMatch"),
          branchCity: t("branchCity"),
          branchCityOptional: t("branchCityOptional"),
          cityPlaceholder: t("cityPlaceholder"),
          cityNoMatch: t("cityNoMatch"),
          branchAddress: t("branchAddress"),
          branchPhone: t("branchPhone"),
          branchLocation: t("branchLocation"),
          branchContact: t("branchContact"),
          openLocation: t("openLocation"),
          addBranch: t("addBranch"),
          editBranch: t("editBranch"),
          mapUrl: t("mapUrl"),
          mapUrlHint: t("mapUrlHint"),
          mapUrlRejected: t("mapUrlRejected"),
          crNumberHint: t("crNumberHint"),
          noBranches: t("noBranches"),


          auditTitle: t("auditTitle"),
          auditAt: t("activityAt"),
          auditAction: t("activityAction"),
          auditActor: t("activityActor"),
          auditDetails: t("auditDetails"),
          noAudit: t("noAudit"),

          suspendTitle: t("suspendTitle"),
          suspendReason: t("suspendReason"),
          suspend: t("suspend"),
          reactivateTitle: t("reactivateTitle"),
          reactivate: t("reactivate"),

          loginPasswordSet: t("loginPasswordSet"),
          loginPasswordPending: t("loginPasswordPending"),
          loginEmailVerified: t("loginEmailVerified"),
          loginEmailUnverified: t("loginEmailUnverified"),

          bankTitle: t("bankTitle"),
          bankState: t("bankState"),
          bankActive: t("bankActive"),
          bankPending: t("bankPending"),
          bankHolder: t("bankHolder"),
          bankName: t("bankName"),
          bankIban: t("bankIban"),
          noBankAccount: t("noBankAccount"),

          deleteTitle: t("deleteTitle"),
          confirmAction: actions("confirm"),
          deleteReason: t("deleteReason"),
          deleteAction: t("deleteAction"),
          deleteBlocked: t("deleteBlockedShort"),
          deleteConfirmLabel: t("deleteConfirmationLabel"),

          save: t("save"),
          cancel: actions("cancel"),
          working: actions("working"),
          errorTitle: states("errorTitle"),
          requestIdLabel: states("requestIdLabel"),
          reasonRequired: t("reasonHint"),
        }}
      />
    </div>
  );
}

/** What an edit changed, as one short line, or nothing. */
function describeChange(
  before: Record<string, string> | null,
  after: Record<string, string> | null,
): string {
  if (!after) return "";
  return Object.entries(after)
    .map(([key, value]) => `${key}: ${before?.[key] ?? "—"} → ${value}`)
    .join(" · ");
}
