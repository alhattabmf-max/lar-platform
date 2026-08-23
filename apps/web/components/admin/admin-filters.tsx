import { Label, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * The search-and-filter bar every admin list shares.
 *
 * A PLAIN `<form method="get">`, deliberately. It is a Server Component
 * with no client JavaScript at all: submitting navigates to the same
 * path with the chosen query string, which the page already reads.
 * That means it works before hydration, works with JavaScript disabled,
 * and puts the operator's filters in the URL — so a filtered queue can
 * be bookmarked, reloaded, and pasted to a colleague, which is exactly
 * what someone triaging a problem does.
 *
 * A `page` hidden field is deliberately NOT rendered. Changing a filter
 * must return to page 1: keeping the old page number would land the
 * reader on "page 4" of a result set that now has one page, which
 * renders as empty and reads as "nothing matched".
 *
 * Every option label arrives already translated. A raw enum value is
 * never shown — `PENDING_VERIFICATION` is a machine vocabulary, and
 * asking a reader to decode one is not a filter, it is a quiz.
 */
export interface AdminFilterOption {
  /** The value sent to the API. Empty string means "no filter". */
  value: string;
  /** Already translated. */
  label: string;
}

export interface AdminFilterSelect {
  name: string;
  label: string;
  value?: string;
  options: readonly AdminFilterOption[];
}

export interface AdminFiltersProps {
  /** Locale-prefixed internal path this form submits to. */
  action: string;
  search?: { name: string; label: string; value?: string; placeholder?: string };
  selects?: readonly AdminFilterSelect[];
  labels: {
    /** Accessible name for the whole group. */
    regionLabel: string;
    apply: string;
    clear: string;
  };
}

export function AdminFilters({ action, search, selects = [], labels }: AdminFiltersProps) {
  const hasFilters =
    (search?.value !== undefined && search.value !== "") ||
    selects.some((select) => select.value !== undefined && select.value !== "");

  return (
    <form
      method="get"
      action={action}
      // A group rather than a search landmark: several of these can
      // appear on one page, and duplicate `search` landmarks make the
      // landmark list useless.
      role="group"
      aria-label={labels.regionLabel}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
    >
      {search ? (
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <Label htmlFor={`filter-${search.name}`}>{search.label}</Label>
          <Input
            id={`filter-${search.name}`}
            name={search.name}
            type="search"
            defaultValue={search.value ?? ""}
            placeholder={search.placeholder}
            maxLength={200}
          />
        </div>
      ) : null}

      {selects.map((select) => (
        <div key={select.name} className="flex min-w-[10rem] flex-col gap-1">
          <Label htmlFor={`filter-${select.name}`}>{select.label}</Label>
          <Select
            id={`filter-${select.name}`}
            name={select.name}
            defaultValue={select.value ?? ""}
          >
            {select.options.map((option) => (
              <option key={option.value || "__any"} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="min-h-11">
          {labels.apply}
        </Button>
        {/* A link, not a reset button: `type="reset"` restores the form
            to its rendered values, which ARE the current filters — it
            would appear to do nothing. This navigates to the unfiltered
            list, which is what "clear" means here. Rendered only when
            something is actually filtered, so there is never a control
            that cannot change anything. */}
        {hasFilters ? (
          <ButtonLink href={action} variant="ghost" size="sm">
            {labels.clear}
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}
