"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

/**
 * FINDING ONE PRODUCT IN A CATALOGUE THAT IS PAGED.
 *
 * A pager on its own turns «where is that product» into guessing which
 * page it is on. The search is the other half of the same change: the
 * term goes into the URL, the server narrows in SQL, and the pager then
 * pages the matches.
 *
 * IT NAVIGATES, IT DOES NOT FILTER. Filtering the page in the browser
 * would search one page of the catalogue and quietly claim it searched
 * all of it.
 *
 * SUBMIT, NOT KEYSTROKE. Each search is a navigation and a server
 * render; firing one per letter would queue a render per keystroke to
 * show a list nobody has finished asking for. The form submits on
 * Enter, which is what the control looks like it does.
 */
export function CatalogueSearch({
  path,
  current,
  labels,
}: {
  /** Where the results live, e.g. `/ar-SA/supplier/products`. */
  path: string;
  current: string;
  labels: { label: string; placeholder: string; apply: string; clear: string };
}) {
  const router = useRouter();
  const [term, setTerm] = useState(current);

  // The URL is the truth: the back button, or a cleared search made
  // elsewhere, must not leave a stale word sitting in the box.
  useEffect(() => {
    setTerm(current);
  }, [current]);

  const go = (value: string) => {
    const trimmed = value.trim();
    // ALWAYS BACK TO PAGE ONE. Keeping the page number across a new
    // search lands on page 4 of a 2-page result — an empty screen that
    // looks like "nothing found".
    router.push(trimmed ? `${path}?q=${encodeURIComponent(trimmed)}` : path);
  };

  return (
    <form
      role="search"
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        go(term);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor="catalogue-search" className="text-sm text-content-muted">
          {labels.label}
        </label>
        <Input
          id="catalogue-search"
          name="q"
          type="search"
          value={term}
          placeholder={labels.placeholder}
          data-testid="catalogue-search-input"
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <Button type="submit" size="sm" variant="secondary">
        {labels.apply}
      </Button>

      {current ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => go("")}>
          {labels.clear}
        </Button>
      ) : null}
    </form>
  );
}
