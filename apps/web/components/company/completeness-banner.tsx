import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { CompanyRequirement } from "@platform/types";
import { requirementAnchor } from "@/lib/company-profile-data";

/**
 * What the company's record still needs, said on the dashboard.
 *
 * IT SAYS WHICH ITEMS, not "your profile is incomplete". A banner that
 * names a problem without naming its parts leaves somebody hunting
 * through a portal for a form they cannot identify; each item here is
 * a link to the section that fixes it.
 *
 * IT BLOCKS NOTHING. Signing in, reaching this dashboard, changing
 * language and signing out are never withheld because a branch or a
 * bank account is missing. This is a notice, and the one button on it
 * goes to the section — it is not a gate rendered as a banner.
 *
 * IT DISAPPEARS BY BEING FIXED. There is no dismiss control: a notice
 * a person can close is a notice that stops being true without
 * anything changing, and the next screen would still refuse the work.
 */
export function CompletenessBanner({
  missing,
  href,
  labels,
}: {
  missing: readonly CompanyRequirement[];
  /** «بيانات المنشأة» in this portal, locale included. */
  href: string;
  labels: {
    title: string;
    action: string;
    /** One name per requirement, already translated. */
    requirements: Record<CompanyRequirement, string>;
  };
}) {
  if (missing.length === 0) return null;

  return (
    <section
      data-testid="completeness-banner"
      className="flex min-w-0 flex-col gap-2 rounded-md border border-warning bg-warning-surface p-3"
    >
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-warning-text">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {labels.title}
      </h2>

      <ul className="flex list-none flex-wrap gap-x-4 gap-y-1">
        {missing.map((requirement) => (
          <li key={requirement}>
            <Link
              href={`${href}#${requirementAnchor(requirement)}`}
              data-testid={`missing-${requirement}`}
              className="inline-flex items-center gap-1 rounded-sm text-sm text-warning-text underline underline-offset-2 hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {labels.requirements[requirement]}
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        data-testid="complete-company-profile"
        className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {labels.action}
        {/* Mirrored by the document's direction rather than by a branch:
            it points the way the reader is going in both scripts. */}
        <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
      </Link>
    </section>
  );
}
