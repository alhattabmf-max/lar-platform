import type {
  CompanyRequirement,
  SupplierVerificationView,
} from "@platform/types";
import { Card, CardBody } from "@/components/ui/card";

/**
 * WHERE A SUPPLIER STANDS. Six states, one card.
 *
 * IT NO LONGER CARRIES THE SEND. That button moved to
 * `CompanyFormFooter` at the foot of the page, because the approved
 * reference puts the last step last and a person fills this record
 * downwards. What is left here is everything somebody returning after
 * a rejection needs to read FIRST: the state, the administrator's own
 * words, and what is still missing by name.
 *
 * WHICH MADE IT A SERVER COMPONENT. With no button there is no state,
 * no handler and no request — so none of this needs to reach the
 * browser as JavaScript, and the `"use client"` that was here for the
 * submit went with it.
 *
 * THE ADMINISTRATOR'S REASON IS SHOWN VERBATIM, on a return and on a
 * rejection. It is the only thing that tells a supplier whether to fix
 * a number or to stop.
 *
 * THE MISSING ITEMS ARE NAMED, from the same list the navigation
 * badges, so the two cannot disagree.
 */
export interface VerificationCardLabels {
  title: string;
  /** One line per state, keyed by the state name. */
  states: Record<SupplierVerificationView["state"], string>;
  /** The longer explanation under the state line. */
  descriptions: Record<SupplierVerificationView["state"], string>;
  submit: string;
  working: string;
  missingTitle: string;
  /** Human names for the requirements, keyed as `requirementsFor` returns them. */
  requirements: Record<CompanyRequirement, string>;
  reasonTitle: string;
  submittedAt: string;
  lockedNotice: string;
  requestIdLabel: string;
}

export function VerificationRequestCard({
  view,
  missing,
  submittedAtLabel,
  labels,
}: {
  view: SupplierVerificationView;
  missing: CompanyRequirement[];
  /** Already formatted by the server — a formatter cannot cross this boundary. */
  submittedAtLabel: string | null;
  labels: VerificationCardLabels;
}) {
  const tone =
    view.state === "VERIFIED"
      ? "border-status-done"
      : view.state === "REJECTED"
        ? "border-status-attention"
        : "border-border";

  return (
    <Card className={tone}>
      <CardBody>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium text-content">
              {labels.title}
            </h2>
            <p className="text-sm font-medium text-content">
              {labels.states[view.state]}
            </p>
            <p className="text-sm text-content-muted">
              {labels.descriptions[view.state]}
            </p>
          </div>

          {submittedAtLabel ? (
            <p className="text-sm text-content-muted">
              {labels.submittedAt} {submittedAtLabel}
            </p>
          ) : null}

          {/* Verbatim. Paraphrasing an administrator's reason is how a
              supplier ends up fixing the wrong thing. */}
          {view.reason ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-content-muted">{labels.reasonTitle}</p>
              <p className="whitespace-pre-wrap text-sm text-content">
                {view.reason}
              </p>
            </div>
          ) : null}

          {/* NAMED AND LINKED. «غير مكتمل» on its own leaves a supplier
              hunting through four sections for whichever one is short. */}
          {missing.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-content-muted">
                {labels.missingTitle}
              </p>
              <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-content">
                {missing.map((requirement) => (
                  <li key={requirement}>{labels.requirements[requirement]}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {view.dataLocked ? (
            <p className="text-sm text-content-muted">{labels.lockedNotice}</p>
          ) : null}

          {/* THE SEND IS AT THE FOOT OF THE PAGE, in
              `CompanyFormFooter` — the approved reference puts the last
              step last, and this card's job is to say where the record
              STANDS. It kept the reason and the missing list, because
              those are what somebody returning after a rejection needs
              to read before anything else. */}
        </div>
      </CardBody>
    </Card>
  );
}
