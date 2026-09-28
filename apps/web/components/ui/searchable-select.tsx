"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { SELECT_CLASSES } from "@/components/ui/select";

/**
 * A long list, picked by typing.
 *
 * WHY THIS EXISTS. The branch form offered a `<select>` because there
 * was one city in it. With every governorate in the Kingdom on the
 * list, a native select is a scroll through a hundred and fifty rows
 * for a word the reader already knows.
 *
 * IT IS A LISTBOX, not a text input that happens to filter. The value
 * is always one of the options or nothing at all — a reader cannot
 * leave half a city name in the field and have the form believe it.
 * What they type narrows the list; what they choose sets the value.
 *
 * ARABIC MATCHING IS THE POINT. A reader looking for «الطائف» may type
 * «طائف» without the article, and the alef forms — أ إ آ ا — are typed
 * interchangeably by everyone. Both names are searched, so «Taif»
 * finds it too.
 *
 * KEYBOARD FIRST: ArrowDown/ArrowUp move, Enter takes, Escape closes
 * and restores. A picker reachable only by mouse would be a step
 * backwards from the native control it replaces.
 */
export interface SearchableOption {
  id: string;
  name: string;
  /** Shown under the name — the region a city belongs to. */
  group?: string;
  /** Also matched, so an English name finds an Arabic row. */
  alternateName?: string;
}

/** Alef forms, taa marbuta and the definite article all fold together. */
function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/^ال/, "");
}

function matches(option: SearchableOption, query: string): boolean {
  const needle = fold(query);
  if (needle === "") return true;
  return [option.name, option.alternateName, option.group]
    .filter((value): value is string => typeof value === "string")
    .some((value) => fold(value).includes(needle));
}

export function SearchableSelect({
  id,
  value,
  options,
  placeholder,
  searchLabel,
  emptyLabel,
  onChange,
  testId,
  invalid,
  onQueryChange,
  remote = false,
}: {
  id?: string;
  value: string;
  options: readonly SearchableOption[];
  placeholder: string;
  /** Describes the text box to a screen reader. */
  searchLabel: string;
  emptyLabel: string;
  onChange: (id: string) => void;
  testId?: string;
  invalid?: boolean;
  /**
   * WHEN THE LIST IS TOO LONG TO HAND OVER.
   *
   * The cities this was written for are a hundred and fifty rows that
   * never grow, so they travel as props and the typing narrows them
   * here. A supplier's catalogue is not like that — it grows with
   * their business — so the owner of that list asks the server on
   * every keystroke and passes the answer back as `options`.
   *
   * `remote` turns the LOCAL filtering off, and nothing else. Filtering
   * again here would be wrong twice over: the server already narrowed,
   * and narrowing one page of a paged answer hides what is on the rest.
   */
  onQueryChange?: (query: string) => void;
  remote?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  /**
   * HOW TALL THE LIST MAY BE, AND WHICH WAY IT OPENS.
   *
   * THE FAULT THIS FIXES. The list was a fixed `max-h-64` opening
   * downwards, so on a field low on the page it ran past the bottom of
   * the window — and, inside a card that clips its overflow, past the
   * card as well. It scrolled internally the whole time; what a reader
   * could SEE stopped, which is why it read as "the scrolling stops
   * and I cannot reach the last region".
   *
   * MEASURED, NOT GUESSED. The room above and below the field decides
   * both the direction and the height, so the list is always inside
   * the window whatever the field's position or the device's height.
   */
  const [placement, setPlacement] = useState<{
    up: boolean;
    maxHeight: number;
  }>({ up: false, maxHeight: 256 });

  const selected = options.find((option) => option.id === value) ?? null;
  const visible = useMemo(
    () => (remote ? options : options.filter((option) => matches(option, query))),
    [options, query, remote]
  );

  // The owner of a remote list hears every keystroke and decides for
  // itself how to debounce; this only reports.
  //
  // THE CALLBACK IS HELD IN A REF, not listed as a dependency. A caller
  // passing an inline arrow gets a new function on every render, and
  // depending on it would re-fire this effect on every render rather
  // than on every keystroke — which is the same bug as not debouncing.
  const reportQuery = useRef(onQueryChange);
  reportQuery.current = onQueryChange;

  useEffect(() => {
    reportQuery.current?.(query);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    /** Re-measured while it is open: the page can scroll under it. */
    function measure() {
      const anchor = inputRef.current?.getBoundingClientRect();
      if (!anchor) return;
      // 8px of breathing room at whichever edge it stops against.
      const below = window.innerHeight - anchor.bottom - 8;
      const above = anchor.top - 8;
      const up = below < 176 && above > below;
      setPlacement({
        up,
        maxHeight: Math.max(120, Math.min(256, up ? above : below)),
      });
    }

    measure();
    window.addEventListener("resize", measure);
    // `true` — a scroll inside ANY ancestor moves the field, and only a
    // capturing listener hears those.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  /**
   * THE HIGHLIGHT DRAGS THE LIST WITH IT.
   *
   * Without this the arrow keys walked past the visible window and the
   * list stayed where it was, so the last options could be reached by
   * the keyboard and never SEEN — the same complaint from the other
   * direction.
   */
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[highlighted] as
      | HTMLElement
      | undefined;
    // Guarded: jsdom has no layout and does not implement it, and a
    // missing scroll is never worth throwing over.
    row?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlighted]);

  // A click anywhere else closes it. Without this the list stays open
  // behind whatever the reader went on to do.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function choose(option: SearchableOption) {
    onChange(option.id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) => {
        if (visible.length === 0) return 0;
        return (current + step + visible.length) % visible.length;
      });
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = visible[highlighted];
      if (option) choose(option);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        id={fieldId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={searchLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        data-testid={testId}
        // WHAT IS CHOSEN WHEN CLOSED, what is typed when open. A field
        // that kept the query after closing would show a half-word
        // beside a value that is not it.
        value={open ? query : (selected?.name ?? "")}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        // THE SHARED CHOOSER SKIN. It is a select in everything but
        // the markup, so it wears what a select wears: 36px, the same
        // padding, and the same light lift.
        className={SELECT_CLASSES}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          // AN OPEN LIST FLOATS, so it takes the overlay elevation —
          // the one lift in the system meant for something over the
          // page rather than in it.
          ref={listRef}
          // THE HEIGHT AND THE DIRECTION ARE MEASURED, so the list is
          // always inside the window. `overscroll-contain` keeps a
          // wheel or a swipe that reaches the end of the list from
          // carrying on into the page behind it.
          className={cn(
            "absolute z-20 w-full overflow-y-auto overscroll-contain rounded-card bg-surface py-1 shadow-overlay",
            placement.up ? "bottom-full mb-1" : "top-full mt-1",
          )}
          style={{ maxHeight: placement.maxHeight }}
        >
          {visible.length === 0 ? (
            <li className="px-control-x py-control-y text-[length:var(--control-font-size)] text-content-muted">
              {emptyLabel}
            </li>
          ) : (
            visible.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  // onMouseDown, not onClick: the input's blur would
                  // otherwise close the list before the click lands.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={cn(
                    "block w-full px-control-x py-control-y text-start text-content",
                    "text-[length:var(--control-font-size)] leading-[var(--control-line-height)]",
                    // The same three states the native picker now
                    // shows: pointed at, chosen, or neither. The
                    // chosen one used to be marked by `aria-selected`
                    // alone — announced, and invisible.
                    index === highlighted && "bg-field-fill",
                    option.id === value && "font-medium",
                    option.id === value && index !== highlighted && "bg-background",
                  )}
                >
                  <span className="block">{option.name}</span>
                  {option.group ? (
                    <span className="block text-xs text-content-muted">
                      {option.group}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
