import { ButtonLink } from "@/components/ui/button";

/**
 * Explains WHY there is no price on this page.
 *
 * The public opportunity contract carries no price, no quantity, no
 * share size and no purchase step; those live behind
 * `RequireTraderGuard`. Without this notice the gap reads as missing
 * data or a broken page, and the obvious "fix" — showing a placeholder,
 * a range, or a "from SAR …" teaser — would move the public/authenticated
 * boundary by accident.
 *
 * So this component states the boundary and points at the way through
 * it. It deliberately renders NO number of any kind: it receives no
 * commercial props, which means it cannot leak one even if a caller
 * tried to pass it.
 */
export interface TraderTermsNoticeProps {
  title: string;
  description: string;
  signInLabel: string;
  registerLabel: string;
  /** Pre-built sign-in href, already carrying the return path. */
  signInHref: string;
  registerHref: string;
}

export function TraderTermsNotice({
  title,
  description,
  signInLabel,
  registerLabel,
  signInHref,
  registerHref,
}: TraderTermsNoticeProps) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-lg border border-line-strong bg-background p-4"
    >
      <h2 className="text-base font-semibold text-content">{title}</h2>
      <p className="text-sm text-content-muted">{description}</p>

      <div className="flex flex-wrap gap-3">
        <ButtonLink href={signInHref} variant="secondary" size="sm">
          {signInLabel}
        </ButtonLink>
        <ButtonLink href={registerHref} variant="ghost" size="sm">
          {registerLabel}
        </ButtonLink>
      </div>
    </section>
  );
}
