"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CARD_SURFACE } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SECTION_ROW_SLOT } from "@/components/admin/admin-section-row";
import { apiClient } from "@/lib/api-client";

/**
 * The search-and-filter bar every control panel list shares.
 *
 * NOTHING HAS TO BE APPLIED. Typing searches, choosing a filter filters,
 * clearing the box restores the list. The "Apply" button is gone because
 * it was a second decision on top of a decision the operator had already
 * made — they chose the filter; being asked to confirm it is a step that
 * only creates the state where the screen and the controls disagree.
 *
 * THE URL IS THE STATE. Every change is a navigation to the same path
 * with a different query string, which the page already reads on the
 * server. So a filtered queue can be bookmarked, reloaded and pasted to
 * a colleague, Back returns to the previous filter rather than to the
 * previous page, and nothing has to be kept in sync between a component
 * and an address bar.
 *
 * WHY `replace` AND NOT `push` FOR TYPING: every keystroke would
 * otherwise become a history entry, and Back would walk the reader
 * letter by letter out of their own search.
 *
 * CLOSED UNTIL ASKED FOR. The card stood open above every list,
 * pushing the rows themselves down the page — and most of the time
 * nobody was searching. One «بحث» button opens it now, and closing
 * it hides the fields without clearing a single value.
 *
 * EXCEPT WHEN THE LIST IS ALREADY NARROWED. A closed card over a
 * filtered list is the one state worth avoiding: the rows are not
 * all the rows, and nothing on screen says why. So a page opened
 * with a search or a filter in its address starts with the card
 * open, and the button carries the count for as long as it holds.
 *
 * THE PAGE'S OWN ACTIONS SHARE THAT ROW, at the opposite end —
 * export, template, import. They used to sit in a row of their own
 * above the card, which cost a third row for two buttons. Passed in
 * rather than known here, because which actions a register offers is
 * the page's business.
 */

const DEBOUNCE_MS = 350;

export interface ListToolbarSelect {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  /**
   * A CHOOSER WHOSE OPTIONS COME FROM THE SERVER, AS THE READER TYPES.
   *
   * Some choosers are over a closed vocabulary — a status, an account
   * type — and their options are known here. The company chooser is
   * not: it is over a table that grows. It used to be filled by
   * fetching every company name, which at 70,000 companies measured
   * 5.8 MB and 994 ms on three separate console pages, none of them
   * cached.
   *
   * WITH THIS SET, the control asks `path` for the names matching what
   * has been typed and offers what comes back. Nothing is out of reach —
   * the search runs across the whole table, not across a page of it —
   * and what arrives is the same size whether the platform holds
   * seventy companies or seventy thousand.
   */
  remote?: {
    /** API path, e.g. `/admin/companies/names`. `q` is appended. */
    path: string;
    /** Shown before anything has been typed. */
    hint: string;
    /**
     * WHAT THE URL CARRIES for this filter.
     *
     * `"label"` writes the chosen NAME — the companies register filters
     * by name, and an exact legal name is the narrowest search there
     * is. `"id"` writes the company id, which is what the offers and
     * products registers already filter by; the box still shows the
     * name, and the id is taken from the suggestion that was chosen.
     */
    valueKey?: "label" | "id";
    /**
     * The name behind the id already in the URL, when there is one.
     *
     * Without it a filtered page would open showing a UUID in a box
     * meant for a name. The page knows it — every row it drew carries
     * the supplier's legal name — so it is passed rather than fetched.
     */
    currentLabel?: string;
  };
}

export interface ListToolbarDate {
  name: string;
  label: string;
}

export interface ListToolbarLabels {
  regionLabel: string;
  /** The button that opens the card — «بحث». */
  openLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  filtersPanelLabel: string;
  reset: string;
}

export function ListToolbar({
  searchName = "search",
  searchable = true,
  selects = [],
  dates = [],
  labels,
  actions,
  extra,
}: {
  searchName?: string;
  /**
   * Whether this list can be searched at all.
   *
   * OFF WHERE THE SERVER IGNORES IT. Only some admin lists implement a
   * text search; rendering a box on the others would give an operator a
   * control that swallows what they type and returns the same rows.
   */
  searchable?: boolean;
  selects?: readonly ListToolbarSelect[];
  dates?: readonly ListToolbarDate[];
  labels: ListToolbarLabels;
  /**
   * What this register can do as a whole — export, template, import.
   *
   * AN ELEMENT, not a render function: React refuses to serialise a
   * function across into a Client Component, and this is one.
   */
  actions?: ReactNode;
  /**
   * A filter this list has that no other does.
   *
   * Rendered INSIDE the card, under the fields, because it
   * narrows the same list they narrow. The orders register's
   * stage path is the one so far: it stood between the button row
   * and the table, which put a block of chrome above the first
   * order on every visit.
   */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [pending, startTransition] = useTransition();

  const committed = params.get(searchName) ?? "";
  const [text, setText] = useState(committed);
  // The address is the source of truth. When it changes underneath the
  // box — Back, Reset, a pasted link — the box follows it rather than
  // holding a value the results no longer reflect.
  useEffect(() => {
    setText(committed);
  }, [committed]);

  const navigate = useCallback(
    (mutate: (next: URLSearchParams) => void, mode: "push" | "replace") => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      // ANY change to what is being asked for returns to page 1.
      // Keeping the old page number lands the reader on "page 4" of a
      // result set that now has one, which renders empty and reads as
      // "nothing matched".
      next.delete("page");

      const query = next.toString();
      startTransition(() => {
        router[mode](query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [params, pathname, router],
  );

  const commitSearch = useCallback(
    (value: string, mode: "push" | "replace") => {
      navigate((next) => {
        if (value.trim() === "") next.delete(searchName);
        else next.set(searchName, value);
      }, mode);
    },
    [navigate, searchName],
  );

  // Typing settles before it asks the server anything. Without this
  // every keystroke is a request, and the answers arrive out of order.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (text === committed) return;
    timer.current = setTimeout(
      () => commitSearch(text, "replace"),
      DEBOUNCE_MS,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, committed, commitSearch]);

  const hasFilterFields = selects.length > 0 || dates.length > 0;
  const activeFilters =
    selects.filter((select) => (params.get(select.name) ?? "") !== "").length +

    dates.filter((date) => (params.get(date.name) ?? "") !== "").length;
  const hasSearch = searchable && committed !== "";
  const canReset = hasSearch || activeFilters > 0;
  const narrowedBy = (hasSearch ? 1 : 0) + activeFilters;

  // OPEN WHEN THE LIST ARRIVED NARROWED. Read once, at mount: a
  // bookmarked or pasted link carrying a filter shows the fields that
  // produced it, and everything after that is the reader's own doing.
  const [open, setOpen] = useState(() => narrowedBy > 0);

  /**
   * THE OPENER GOES UP INTO THE SECTION ROW — «خلّ زر البحث يطلع لصف
   * اللي تحت الشريط بجانب علامة المساعدة».
   *
   * A PORTAL, because the two halves are owned by different trees:
   * the row is drawn by the console's chrome on every screen, and
   * this button belongs to the screen. Rendering it in place cost a
   * row of the page for one control while the row above it had the
   * width to spare.
   *
   * FOUND AFTER THE FIRST PAINT, never during: the slot is another
   * component's DOM and reading it while rendering would be reading
   * a tree React has not committed. Until then — and on any screen
   * with no such row — the button renders where it always did, which
   * is what makes this an improvement rather than a dependency.
   */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(SECTION_ROW_SLOT));
  }, []);

  const opener = (
    <Button
      type="button"
      variant={narrowedBy > 0 ? "primary" : "secondary"}
      size="sm"
      aria-expanded={open}
      aria-controls="list-toolbar"
      data-testid="list-toolbar-open"
      onClick={() => setOpen((current) => !current)}
    >
      <Search aria-hidden="true" className="me-2 size-4" />
      {labels.openLabel}
      {/* THE COUNT STAYS VISIBLE WHILE THE CARD IS SHUT. A narrowed
          list with nothing on screen to say so is the one state this
          must not produce. */}
      {narrowedBy > 0 ? (
        <span className="ms-2 rounded-full bg-surface px-2 text-xs text-content">
          {narrowedBy}
        </span>
      ) : null}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="list-toolbar-region">
      {/* THE OPENER IS IN THE SECTION ROW when there is one, and here
          when there is not. The page's own actions keep this row; with
          nothing at the end of it any more, they simply start it. */}
      {slot ? createPortal(opener, slot) : null}

      {actions || !slot ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
          {slot ? null : opener}
        </div>
      ) : null}

      {open ? (
    <section
      aria-label={labels.regionLabel}
      // THE SHARED CARD SURFACE. This was a hand-written `p-4` with no
      // elevation at all — sixteen pixels on every side and flat, while
      // every other card on the platform was eight, twelve and lifted.
      className={cn(CARD_SURFACE, "flex flex-col gap-card-gap px-card-x py-card-y")}
      id="list-toolbar"
      data-testid="list-toolbar"
      data-pending={pending ? "true" : "false"}
    >
      <div className="flex flex-wrap items-end gap-3">
        {searchable ? (
          <div className="flex min-w-56 flex-1 basis-64 flex-col gap-1">
            <Label htmlFor="list-toolbar-search">{labels.searchLabel}</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 my-auto size-4 text-content-muted"
                style={{ insetInlineStart: "0.75rem" }}
              />
              <Input
                id="list-toolbar-search"
                type="search"
                value={text}
                placeholder={labels.searchPlaceholder}
                data-testid="list-toolbar-search"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  // Enter is impatience, and it is answered: the pending
                  // debounce is dropped and the search runs now.
                  event.preventDefault();
                  if (timer.current) clearTimeout(timer.current);
                  commitSearch(text, "push");
                }}
                // THE SHARED FIELD SKIN — a search box is a place text
                // goes, and wears what every other one wears. The start
                // padding is widened for the icon sitting inside it.
                // Room made at the start for the icon inside it.
                style={{ paddingInlineStart: "2.25rem" }}
              />
            </div>
          </div>
        ) : null}

        {/* NO SECOND DISCLOSURE. The card is already behind a button;
            a control inside it that hid half of what it opened would
            be a door behind a door. */}

        {/* Offered only when there is something to undo. A permanently
            present reset on an unfiltered list is a control that does
            nothing. */}
        {canReset ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
           
            data-testid="list-toolbar-reset"
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              if (searchable) next.delete(searchName);
              for (const select of selects) next.delete(select.name);
              for (const date of dates) next.delete(date.name);
              next.delete("page");
              const query = next.toString();
              startTransition(() => {
                router.push(query ? `${pathname}?${query}` : pathname, {
                  scroll: false,
                });
              });
            }}
          >
            <RotateCcw aria-hidden="true" className="me-2 size-4" />
            {labels.reset}
          </Button>
        ) : null}
      </div>

      {/* THE FIELDS THEMSELVES, all of them, whenever the card is
          open. There is no second disclosure inside it: the card is
          already behind a button, and a control in here that hid
          half of what that button opened would be a door behind a
          door. */}
      {hasFilterFields ? (
        <div
          id="list-toolbar-filters"
          aria-label={labels.filtersPanelLabel}
          data-testid="list-toolbar-filters"
          className="flex flex-wrap items-end gap-3"
        >
          {selects.map((select) =>
            select.remote ? (
              <RemoteChooser
                key={select.name}
                select={select}
                current={params.get(select.name) ?? ""}
                onChoose={(value) =>
                  navigate((next) => {
                    if (value === "") next.delete(select.name);
                    else next.set(select.name, value);
                  }, "push")
                }
              />
            ) : (
            <div
              key={select.name}
              className="flex min-w-0 flex-1 basis-48 flex-col gap-1"
            >
              <Label htmlFor={`list-toolbar-${select.name}`}>
                {select.label}
              </Label>
              <Select
                id={`list-toolbar-${select.name}`}
                name={select.name}
                value={params.get(select.name) ?? ""}
                data-testid={`list-toolbar-select-${select.name}`}
                // Choosing IS applying. There is no second press.
                onChange={(event) =>
                  navigate((next) => {
                    if (event.target.value === "") next.delete(select.name);
                    else next.set(select.name, event.target.value);
                  }, "push")
                }
              >
                {select.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            )
          )}

          {dates.map((date) => (
            <div
              key={date.name}
              className="flex min-w-0 flex-1 basis-40 flex-col gap-1"
            >
              <Label htmlFor={`list-toolbar-${date.name}`}>{date.label}</Label>
              <Input
                appearance="chooser"
                id={`list-toolbar-${date.name}`}
                name={date.name}
                type="date"
                value={params.get(date.name) ?? ""}
                data-testid={`list-toolbar-date-${date.name}`}
                // Picking a date applies it, like every other control
                // here. Clearing the field removes the bound.
                onChange={(event) =>
                  navigate((next) => {
                    if (event.target.value === "") next.delete(date.name);
                    else next.set(date.name, event.target.value);
                  }, "push")
                }
                // A DATE BOUND IS A CHOOSER, not a text field: it takes
                // the select skin, with the light lift a chooser has.
              />
            </div>
          ))}
        </div>
      ) : null}

      {extra}
    </section>
      ) : null}
    </div>
  );
}

/**
 * A CHOOSER OVER A TABLE THAT GROWS.
 *
 * The closed-vocabulary choosers beside it carry their options as
 * props, because a status list is four values and will be four values
 * at any size. A company chooser cannot: the register is the thing that
 * grows, and shipping it to fill a dropdown was the single largest
 * payload the console produced — 5.8 MB at 70,000 companies, on three
 * pages, uncached.
 *
 * NATIVE `datalist`, NOT A DROPDOWN LIBRARY. It is a text input the
 * browser decorates with suggestions: keyboard behaviour, screen-reader
 * announcement and the mobile keyboard all come from the platform, and
 * a reader who knows the exact name may simply type it and never wait
 * for a request at all.
 *
 * WHAT IS SENT IS WHAT WAS TYPED. Choosing a suggestion and typing a
 * fragment both write the same query parameter, exactly as the old
 * `<select>` did — an exact legal name IS the narrowest search there is,
 * and two parameters meaning "which company" would be two ways for a
 * link to disagree with itself.
 */
function RemoteChooser({
  select,
  current,
  onChoose,
}: {
  select: ListToolbarSelect;
  current: string;
  onChoose: (value: string) => void;
}) {
  const byId = select.remote?.valueKey === "id";
  // WHAT THE BOX SHOWS is always a name. When the URL carries an id,
  // the name behind it comes from the page — which drew it on every
  // row — rather than from a lookup nobody needs to wait for.
  const shown = byId ? (select.remote?.currentLabel ?? "") : current;
  const [typed, setTyped] = useState(shown);
  const [options, setOptions] = useState<readonly { value: string; label: string }[]>([]);
  const listId = `list-toolbar-${select.name}-options`;

  // The URL is the truth: a reset elsewhere, or the back button, must
  // be reflected here rather than leaving a stale word in the box.
  useEffect(() => {
    setTyped(shown);
  }, [shown]);

  /**
   * The value this filter puts in the URL for a given piece of text.
   *
   * An empty box clears the filter. For a name filter the text IS the
   * value. For an id filter only a name that matches a suggestion can
   * produce one — half a name identifies no company, and writing a
   * fragment into `companyId` would filter by an id that does not exist
   * and silently empty the table.
   */
  const resolve = (text: string): string | null => {
    const term = text.trim();
    if (term === "") return "";
    if (!byId) return term;
    const hit = options.find((option) => option.label === term);
    return hit ? hit.value : null;
  };

  /**
   * ASKED AFTER THE TYPING STOPS, not on every keystroke, and never for
   * an empty box — an empty term would ask the server for "the first
   * fifty of everything", which is the habit this control exists to
   * break.
   *
   * A REQUEST THAT LOSES THE RACE IS DISCARDED. Without the flag, a
   * slow answer for "مؤس" arriving after a fast one for "مؤسسة الإمداد"
   * would replace the right suggestions with stale ones.
   */
  useEffect(() => {
    const term = typed.trim();
    if (term.length < 2 || !select.remote) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiClient
        .get<{ id: string; legalName: string }[]>(
          `${select.remote!.path}${select.remote!.path.includes("?") ? "&" : "?"}q=${encodeURIComponent(term)}`,
        )
        .then((rows) => {
          if (cancelled) return;
          setOptions(rows.map((row) => ({ value: byId ? row.id : row.legalName, label: row.legalName })));
        })
        // A CHOOSER THAT CANNOT REACH THE SERVER STILL TAKES TYPING.
        // The box is a search field first and a chooser second.
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed, select.remote, byId]);

  return (
    <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
      <Label htmlFor={`list-toolbar-${select.name}`}>{select.label}</Label>
      <Input
        id={`list-toolbar-${select.name}`}
        name={select.name}
        list={listId}
        value={typed}
        placeholder={select.remote?.hint}
        data-testid={`list-toolbar-select-${select.name}`}
        onChange={(event) => setTyped(event.target.value)}
        // APPLIED ON COMMIT, not on every keystroke: a navigation per
        // letter would re-render the table five times for one word.
        onBlur={() => {
          const next = resolve(typed);
          // `null` means "typed something that names no company" — the
          // filter is left exactly as it was rather than replaced with
          // an id that matches nothing.
          if (next !== null && next !== current) onChoose(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const next = resolve(typed);
            if (next !== null) onChoose(next);
          }
        }}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value} />
        ))}
      </datalist>
    </div>
  );
}
