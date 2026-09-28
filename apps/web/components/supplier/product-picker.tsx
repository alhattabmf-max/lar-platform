"use client";

import { useEffect, useRef, useState } from "react";
import type { Paginated, ProductSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { localized } from "@/lib/localized";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * THE PRODUCT AN OFFER IS PUBLISHED ON, FOUND BY TYPING.
 *
 * WHY THIS EXISTS. The listing form took a `<select>` and the page
 * above it handed over the supplier's whole catalogue, filtered in the
 * browser down to the APPROVED and unarchived ones. That was tolerable
 * only while the catalogue endpoint answered with everything, and it
 * stopped being tolerable for the same reason that endpoint did: a
 * supplier with five thousand products was five thousand `<option>`
 * elements in the page, twice over — once as markup and again in the
 * RSC payload — to choose one.
 *
 * THE SERVER NARROWS. `publishable=true` is the APPROVED-and-unarchived
 * pair, applied in SQL; `search` is the name in either language; the
 * answer is one page. Nothing is filtered here.
 *
 * THE CHOSEN PRODUCT IS ALWAYS IN THE LIST, even when the search term
 * does not match it and even when it has since been suspended or
 * archived — `initial` carries it from the page. Dropping it would let
 * a save silently change which product the listing is about, which is
 * the one thing this control must never do.
 */
export interface ProductPickerLabels {
  placeholder: string;
  searchLabel: string;
  emptyLabel: string;
}

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 200;

export function ProductPicker({
  id,
  locale,
  value,
  initial,
  onChange,
  labels,
  invalid,
  testId,
}: {
  id?: string;
  locale: AppLocale;
  value: string;
  /**
   * The first page of publishable products, read on the server so the
   * control is useful before it has asked anything — plus the product
   * this listing already names, wherever it sits in the catalogue.
   */
  initial: readonly ProductSummary[];
  onChange: (productId: string) => void;
  labels: ProductPickerLabels;
  invalid?: boolean;
  testId?: string;
}) {
  const [products, setProducts] = useState<readonly ProductSummary[]>(initial);
  const [query, setQuery] = useState("");
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    // An empty box is the page the server already sent. Asking for it
    // again on every clear would be a round trip for nothing.
    if (term === "") {
      setProducts(initial);
      return;
    }

    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          publishable: "true",
          search: term,
          pageSize: String(PAGE_SIZE),
        });
        const page = await apiClient.get<Paginated<ProductSummary>>(
          `/companies/me/products?${params.toString()}`,
        );
        // AN ANSWER THAT ARRIVED LATE IS DISCARDED. Two keystrokes race,
        // and the slower request must not overwrite the faster one's
        // result with an older list.
        if (ticket !== latest.current) return;

        // The listing's own product stays reachable whatever was typed.
        const chosen = initial.find((product) => product.id === value);
        const already = page.items.some((product) => product.id === value);
        setProducts(chosen && !already ? [chosen, ...page.items] : page.items);
      } catch {
        // A failed search leaves the list as it was rather than emptying
        // it: an empty picker reads as "you have no products".
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, initial, value]);

  return (
    <SearchableSelect
      id={id}
      value={value}
      options={products.map((product) => ({
        id: product.id,
        name: localized(locale, product.nameAr, product.nameEn),
        alternateName: locale.startsWith("ar") ? product.nameEn : product.nameAr,
      }))}
      placeholder={labels.placeholder}
      searchLabel={labels.searchLabel}
      emptyLabel={labels.emptyLabel}
      onChange={onChange}
      onQueryChange={setQuery}
      remote
      invalid={invalid}
      testId={testId}
    />
  );
}
