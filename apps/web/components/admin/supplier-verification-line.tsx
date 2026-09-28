import { getTranslations } from "next-intl/server";
import type { SupplierVerificationView } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { formatDate } from "@/lib/localized";
import { AdminAction } from "@/components/admin/admin-action";

/**
 * The one decision that verifies a supplier — ON ONE LINE.
 *
 * «صورة التوثيق: أنت مخلّيها خمسة أسطر، أبغاك تخلّيها سطرًا واحدًا بكافة
 *  معلوماتها، مقابل اسم المورّد اللي فوقه، موازي له.»
 *
 * WHAT THE FIVE LINES WERE: a card with a heading naming what the state
 * beneath it already said, the state, the submission date, the decision
 * date, the reason, and a row of buttons — each on its own line, in a
 * box of its own, above everything else on the page. Every one of those
 * facts is four or five characters long.
 *
 * SO THEY STAND IN A ROW, at the far end of the company's own name,
 * separated by dots rather than by line breaks. The heading goes: this
 * line sits beside the supplier's name, and there is nothing else on the
 * page it could be describing.
 *
 * IT LIVES ON THE COMPANY'S PAGE, not in a queue of its own, because
 * this is the page that shows what is being approved — the registration,
 * the branches, the people, the counts. Deciding from a name and a date
 * is not reviewing anything.
 *
 * THREE OUTCOMES, and the middle one is the point. With only approve and
 * reject, an operator facing a nearly-complete supplier had no move that
 * was not either wrong or terminal, so the request sat. A return says
 * what is missing, reopens the record for editing, and lets the supplier
 * send it again.
 *
 * NOTHING IS SHOWN WHEN THERE IS NOTHING TO DECIDE, and a buyer never
 * reaches this component at all.
 */
export async function SupplierVerificationLine({
  locale,
  companyId,
  companyLegalName,
  verification,
}: {
  locale: AppLocale;
  companyId: string;
  companyLegalName: string;
  verification: SupplierVerificationView;
}) {
  const t = await getTranslations({
    locale,
    namespace: "admin.supplierVerification",
  });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const states = await getTranslations({ locale, namespace: "states" });

  const labels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  const request = verification.latestRequest;
  const open = verification.state === "UNDER_REVIEW";

  // A company that has never submitted has nothing to show here at all.
  if (!request) return null;

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      data-testid="supplier-verification-line"
    >
      <span className="font-medium text-content">
        {t(`state.${verification.state}`)}
      </span>

      <span className="text-content-muted">
        {t("submittedAt")}{" "}
        <time dateTime={request.submittedAt}>
          {formatDate(request.submittedAt, locale)}
        </time>
      </span>

      {request.decidedAt ? (
        <span className="text-content-muted">
          {t("decidedAt")}{" "}
          <time dateTime={request.decidedAt}>
            {formatDate(request.decidedAt, locale)}
          </time>
        </span>
      ) : null}

      {/* The operator's own words, back to them — truncated rather than
          dropped, because a decision whose reason lives only in the
          audit log is one nobody reading this page can account for. The
          full text stays available to a pointer and to a reader. */}
      {verification.reason ? (
        <span
          className="max-w-[18rem] truncate text-content-muted"
          title={verification.reason}
        >
          {verification.reason}
        </span>
      ) : null}

      {open ? (
        <span className="flex flex-wrap items-center gap-2">
          <AdminAction
            path={`/admin/operations/suppliers/${companyId}/approve`}
            labels={{
              ...labels,
              action: t("approve"),
              // Says what approving actually does, including the part an
              // operator will not otherwise see: the bank account
              // becomes the one payouts go to.
              prompt: t("approvePrompt", { company: companyLegalName }),
            }}
          />
          <AdminAction
            path={`/admin/operations/suppliers/${companyId}/return`}
            variant="secondary"
            reason={{
              field: "reason",
              label: t("returnReason"),
              minLength: 5,
              maxLength: 2000,
              hint: t("returnReasonHint"),
            }}
            labels={{
              ...labels,
              action: t("return"),
              prompt: t("returnPrompt", { company: companyLegalName }),
            }}
          />
          <AdminAction
            path={`/admin/operations/suppliers/${companyId}/reject`}
            variant="danger"
            reason={{
              field: "reason",
              label: t("rejectReason"),
              minLength: 5,
              maxLength: 2000,
              hint: t("rejectReasonHint"),
            }}
            labels={{
              ...labels,
              action: t("reject"),
              // Terminal, and the confirmation says so.
              prompt: t("rejectPrompt", { company: companyLegalName }),
            }}
          />
        </span>
      ) : null}
    </div>
  );
}
