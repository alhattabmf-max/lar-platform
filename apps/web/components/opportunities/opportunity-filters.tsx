"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  OPPORTUNITY_SORTS,
  TAXONOMY_FILTER_INCLUDES_DESCENDANTS,
  type CityItem,
  type OpportunitySort,
  type RegionItem,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { localized } from "@/lib/localized";
import {
  hasActiveFilters,
  PUBLIC_OPPORTUNITIES_PATH,
  type MarketplaceQuery,
} from "@/lib/marketplace-query";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button, buttonClasses } from "@/components/ui/button";
import type { TaxonomyOption } from "@/lib/taxonomy-tree";

/**
 * ONE ROW: place, category, order, and the button.
 *
 * «طريقة البحث هذي مرفوضة، مساحة كبيرة غير لازمها… يتكوّن من صف واحد،
 * ما يحتاج تعريف فوق الحقول لأنه مكتوب في الحقل أصلًا… ويكون ظاهر، ما
 * يحتاج نضغط كلمة بحث.»
 *
 * NO LABEL ABOVE A CHOOSER. Each one's first option already says what
 * it is — «كل المناطق», «كل التصنيفات» — so a label above it printed
 * the same word twice and cost a line across the whole bar. The label
 * is still THERE for a screen reader, as `aria-label`, because "all
 * regions" read alone does not say what it is all regions OF.
 *
 * TWO CHOOSERS OPEN A THIRD. Choosing a region reveals its cities;
 * choosing a category reveals its branches — «حين يختار التصنيف يفتح
 * فرعه بجانبه… واجعل المدينة حقل جنب المنطقة يظهر إذا اختار المنطقة
 * نفس نظام التصنيف».
 *
 * THAT REVEAL IS THE ONLY REASON THIS IS A CLIENT COMPONENT. It was a
 * plain server-rendered GET form, and the city appeared only after a
 * submit. What has NOT changed is the rule that made it one:
 *
 *   AUTO-SUBMITTING A CHOOSER ON CHANGE IS HOSTILE TO KEYBOARD USERS.
 *   Arrow keys move through options one at a time and each step would
 *   fire a navigation. Nothing here navigates until Apply is pressed;
 *   the state below only decides which choosers are DRAWN.
 *
 * IT IS STILL A GET FORM whose field names are the query parameters, so
 * the browser's own serialisation is the URL builder and there is one
 * filtering mechanism rather than two that can disagree. Submitting
 * drops `page`, which resets to the first — correct when the result set
 * changes underneath you.
 *
 * THE CATEGORY IS TWO CHOOSERS AND ONE PARAMETER, so it carries a
 * hidden field rather than a name on either. Two selects both named
 * `taxonomyNodeId` would serialise as an array and the API would refuse
 * it; the hidden field holds whichever of the two is the answer — the
 * branch when one is chosen, the category when it is not.
 *
 * Nothing here filters anything. Every value round-trips to the API,
 * which applies it in SQL; a client-side filter over one page of a
 * paginated list would hide matches on every other page.
 */
export interface OpportunityFiltersLabels {
  /**
   * The FORM's own name, read by a screen reader announcing the
   * landmark.
   */
  formLabel: string;
  regionLabel: string;
  anyRegion: string;
  cityLabel: string;
  anyCity: string;
  categoryLabel: string;
  anyCategory: string;
  /** «كل الفروع» — the branch chooser's own first option. */
  anyBranch: string;
  categoryExactMatchHint: string;
  sortLabel: string;
  sortOptions: Record<OpportunitySort, string>;
  apply: string;
  clear: string;
  /**
   * THE SUBMIT'S OWN WORD on a narrow screen, where the wide row
   * shows a magnifier alone.
   */
  showResults: string;
}

export interface OpportunityFiltersProps {
  locale: AppLocale;
  query: MarketplaceQuery;
  regions: readonly RegionItem[];
  cities: readonly CityItem[];
  taxonomyOptions: readonly TaxonomyOption[];
  labels: OpportunityFiltersLabels;
  basePath?: string;
}

export function OpportunityFilters({
  locale,
  query,
  regions,
  cities,
  taxonomyOptions,
  labels,
  basePath = PUBLIC_OPPORTUNITIES_PATH,
}: OpportunityFiltersProps) {
  const roots = taxonomyOptions.filter((option) => option.parentId === null);

  /**
   * WHICH CATEGORY THE CURRENT SELECTION SITS UNDER.
   *
   * The address carries ONE node id and it may be a branch, so the
   * category chooser has to show that branch's root rather than
   * nothing. Walked rather than assumed to be one level: the tree is
   * arbitrary depth and a two-level read would silently pick the wrong
   * ancestor on a deeper one.
   */
  const rootOf = (id: string | undefined): string => {
    let node = taxonomyOptions.find((option) => option.id === id);
    const seen = new Set<string>();
    while (node?.parentId && !seen.has(node.id)) {
      seen.add(node.id);
      node = taxonomyOptions.find((option) => option.id === node!.parentId);
    }
    return node?.id ?? "";
  };

  const branchOf = (id: string | undefined): string =>
    rootOf(id) === id ? "" : (id ?? "");

  const [regionId, setRegionId] = useState(query.regionId ?? "");
  const [cityId, setCityId] = useState(query.cityId ?? "");
  const [rootId, setRootId] = useState(() => rootOf(query.taxonomyNodeId));
  const [branchId, setBranchId] = useState(() => branchOf(query.taxonomyNodeId));
  const [sort, setSort] = useState<OpportunitySort>(query.sort);

  /**
   * THE CITIES OF WHICHEVER REGION IS CHOSEN RIGHT NOW.
   *
   * The server sends the cities of the region already in the address —
   * usually none, because most visitors arrive with no region chosen.
   * Picking a region asks for that region's cities and nothing else.
   *
   * IT USED TO RECEIVE THEM ALL. Every active city on the platform was
   * passed as a prop so this component could narrow them locally, which
   * serialised the whole list into the page twice — as markup and again
   * into the RSC payload — to render at most one region's worth.
   *
   * THE ANSWER THAT LOSES THE RACE IS DISCARDED: two quick changes of
   * region must not leave the second region showing the first one's
   * cities.
   */
  const [loadedCities, setLoadedCities] = useState<readonly CityItem[]>(cities);
  useEffect(() => {
    if (!regionId) {
      setLoadedCities([]);
      return;
    }
    // Already in hand — the region the page was rendered with.
    if (cities.length > 0 && cities[0].region.id === regionId) {
      setLoadedCities(cities);
      return;
    }
    let cancelled = false;
    void apiClient
      .get<CityItem[]>(`/cities/active?regionId=${encodeURIComponent(regionId)}`)
      .then((rows) => {
        if (!cancelled) setLoadedCities(rows);
      })
      // A CITY IS A REFINEMENT, NOT A REQUIREMENT. If the list cannot be
      // fetched the region filter still works on its own.
      .catch(() => {
        if (!cancelled) setLoadedCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [regionId, cities]);


  /**
   * THE CONTROLS FOLLOW THE ADDRESS, and until now they did not.
   *
   * «عندما أحدّد الخيارات وأضغط على البحث، بعدها أسوّي إزالة الفلاتر —
   *  تبقى البيانات اللي اخترتها موجودة، ولا يعود إلى الوضع الطبيعي إلا
   *  إذا سوّيت تحديث للصفحة.»
   *
   * WHY IT HAPPENED. «إزالة الفلاتر» is a link, and a link inside the
   * app is a CLIENT navigation: React re-renders this form with a new
   * query prop but never unmounts it, and a state initialiser runs
   * exactly once per mount. So the page behind reset and the five
   * choosers did not — the list said "no filters" while the controls
   * said "منطقة الرياض". A hard refresh remounts, which is why that
   * was the only thing that worked.
   *
   * THE FIX IS TO RESET DURING RENDER, which is React's own answer to
   * "adjust state when a prop changes" — not an effect. An effect would
   * paint the stale values first and correct them a frame later, and a
   * reader would watch the old region blink away.
   *
   * IT COMPARES A SIGNATURE, not the object. The query is rebuilt on
   * every render of the page above, so comparing the object itself is
   * always unequal — the form would reset under a reader mid-choice.
   * The signature is the four values the address actually carries, and
   * the fifth control is derived from one of them.
   */
  const signature = [
    query.regionId ?? "",
    query.cityId ?? "",
    query.taxonomyNodeId ?? "",
    query.sort,
  ].join("|");
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setRegionId(query.regionId ?? "");
    setCityId(query.cityId ?? "");
    setRootId(rootOf(query.taxonomyNodeId));
    setBranchId(branchOf(query.taxonomyNodeId));
    setSort(query.sort);
  }

  // The active cities beneath the region chosen RIGHT NOW, not the one
  // the address was loaded with.
  const citiesHere = regionId
    ? loadedCities.filter((city) => city.region.id === regionId)
    : [];

  const branchesHere = rootId
    ? taxonomyOptions.filter((option) => option.parentId === rootId)
    : [];


  return (
    <form
      id="opportunity-filters"
      method="get"
      action={`/${locale}/${basePath}`}
      aria-label={labels.formLabel}
      data-testid="opportunity-filters"
      // IT IS THE SHEET'S OWN TOP EDGE, NOT A CARD ON IT — «فيه مسافة
      // بينه وبين شريط اللسان وبينه وبين المنتج… قلّل الحشو من تحت
      // والصقه في الشريط اللي فوقه، ولا تجعل له زوايا منحنية، وخلّه
      // يمتد بعرض بطاقة الصفحة».
      //
      // THE NEGATIVE MARGINS ARE THE SHEET'S PADDING, CANCELLED. The
      // card pads itself `pt-2 lg:pt-3` and `px-4 lg:px-6`; undoing
      // exactly that puts the bar's top on the strip's foot and its
      // sides on the card's own edges, then it pads itself back so the
      // controls never touch the paper's edge.
      //
      // AND IT LOST ITS CARD. A rounded, shadowed block on a rounded,
      // shadowed sheet was a card inside a card — two frames for one
      // surface. What parts it from the offers below is a hairline,
      // which costs one pixel where the shadow cost eight.
      //
      // THE BOTTOM GAP IS HALVED, not closed: `-mb-3` against the
      // column's `gap-6` leaves twelve pixels. Nothing separates the
      // bar from the strip above because they are one object now; the
      // offers below are a different thing and still need air.
      className={
        // THE WIDE ROW, UNTOUCHED — it is the same string it has
        // always been from `lg` up.
        "flex flex-wrap items-center gap-2 border-b border-line bg-surface " +
        "lg:-mx-6 lg:-mb-3 lg:-mt-3 lg:px-6 lg:py-2 " +
        // AND BELOW IT, THE SAME CONTROLS STANDING IN THE PAGE —
        // «تكون الثلاث، المنطقة والتصنيف والترتيب، ظاهرة»، and
        // «في الجوال تنزل الفروع والمدينة تحت».
        //
        // THERE WAS A BUTTON AND A SHEET HERE. Both are gone: a
        // filter you have to open is a filter most people never
        // find, and the sheet cost a press to reach and a press to
        // leave. What made the row unusable at 390 was FIVE
        // controls on ONE line, not the controls themselves — so
        // they stand two to a line instead, each dependant
        // directly under the chooser that reveals it.
        //
        // THREE ACROSS, IN ONE LINE — «الفلاتر صفّ واحد فيه الثلاث،
        // المناطق والترتيب والأصناف، ثابتة؛ جايه عندي صفّين ليه».
        // Each column is a chooser and whatever it reveals, so the
        // line above never moves: the city arrives UNDER the region
        // and the branch UNDER the category, and the three names stay
        // where they were.
        // AND THE SUBMIT IS ON THE LINE WITH THEM — «زر التصفية جاي
        //  في صف ثاني والمفروض يكون في نفس الصف، وما يحتاج يكون فيه
        //  اسمه، أيقونة تفي بالغرض».
        //
        // ITS COLUMN IS `auto` AND THE ORDER'S IS WIDER. Four equal
        // columns would give a 32-pixel glyph the width of a chooser
        // and leave 99 for «الأقرب إغلاقًا», which needs 111. The
        // glyph takes what it needs and the order takes the slack.
        "max-lg:-mx-4 max-lg:-mt-2 max-lg:grid max-lg:grid-cols-[1fr_1fr_1.25fr_auto] max-lg:items-start max-lg:px-4 max-lg:py-2 " +
        // AND THEY ARE SMALLER AND TIGHTER THAN THE WIDE ROW'S.
        // Measured at 393: three columns of 115, and «الأقرب إلى
        //  الإغلاق» needs 87 pixels of text at 14 plus 24 of padding
        // plus the native arrow — 131 in a box of 115, which is a
        // chooser whose own value is cut in half. At 12 with 8 of
        // padding it is 111, and every one of the five fits.
        "max-lg:[&_select]:h-10 max-lg:[&_select]:px-2 max-lg:[&_select]:text-xs " +
        // AND A CHOOSER NEVER BREAKS ONTO A SECOND LINE. A native
        // select wraps its own value when the box is narrower than
        // the word — measured, «الأقرب إلى الإغلاق» came back as two
        // lines inside a 40-pixel box, which reads as a broken
        // control rather than as a long name.
        "max-lg:[&_select]:whitespace-nowrap "
      }
    >
      {/* THE CATEGORY'S ANSWER, carried once. Two choosers, one
          parameter — see the note at the head of this file. */}
      <input type="hidden" name="taxonomyNodeId" value={branchId || rootId} />

      {/* THE PAIR AND ITS DEPENDANT, one under the other.

          `lg:contents` DISSOLVES THIS WRAPPER ON A WIDE SCREEN, so
          the row above `lg` is the same flat line of flex children
          it has always been — one layout added, none changed.

          AND `flex-none` ON THESE TWO COLUMNS ONLY. The choosers
          carry `flex-1` for the wide ROW, where it shares the WIDTH;
          in a COLUMN the same rule shares the HEIGHT. Cancelling it
          on the FORM cancelled it for the order chooser too, which
          then sized to its longest option — measured, exactly 100
          pixels of horizontal overflow with the submit hanging off
          the page. It belongs on the columns, not on the form. */}
      <div className="max-lg:flex max-lg:min-w-0 max-lg:flex-col max-lg:gap-2 max-lg:[&>select]:flex-none lg:contents">
      <Select
        aria-label={labels.regionLabel}
        name="regionId"
        value={regionId}
        heightAs="control"
        className="min-w-0 flex-1"
        onChange={(event) => {
          setRegionId(event.target.value);
          // A CITY UNDER THE OLD REGION IS NOT A REFINEMENT, it is a
          // pair that matches nothing. Cleared with the region.
          setCityId("");
        }}
      >
        <option value="">{labels.anyRegion}</option>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>
            {localized(locale, region.nameAr, region.nameEn)}
          </option>
        ))}
      </Select>

      {/* ONLY ONCE A REGION IS CHOSEN AND IT HAS ACTIVE CITIES. Absent
          rather than disabled: a disabled control reads as something
          the reader failed to use, and there is nothing they did
          wrong. */}
      {citiesHere.length > 0 ? (
        <Select
          aria-label={labels.cityLabel}
          name="cityId"
          value={cityId}
          heightAs="control"
          className="min-w-0 flex-1"
          onChange={(event) => setCityId(event.target.value)}
        >
          <option value="">{labels.anyCity}</option>
          {citiesHere.map((city) => (
            <option key={city.id} value={city.id}>
              {localized(locale, city.nameAr, city.nameEn)}
            </option>
          ))}
        </Select>
      ) : null}
      </div>

      {/* THE PAIR AND ITS DEPENDANT, one under the other.

          `lg:contents` DISSOLVES THIS WRAPPER ON A WIDE SCREEN, so
          the row above `lg` is the same flat line of flex children
          it has always been — one layout added, none changed.

          AND `flex-none` ON THESE TWO COLUMNS ONLY. The choosers
          carry `flex-1` for the wide ROW, where it shares the WIDTH;
          in a COLUMN the same rule shares the HEIGHT. Cancelling it
          on the FORM cancelled it for the order chooser too, which
          then sized to its longest option — measured, exactly 100
          pixels of horizontal overflow with the submit hanging off
          the page. It belongs on the columns, not on the form. */}
      <div className="max-lg:flex max-lg:min-w-0 max-lg:flex-col max-lg:gap-2 max-lg:[&>select]:flex-none lg:contents">
      <Select
        aria-label={labels.categoryLabel}
        value={rootId}
        heightAs="control"
        className="min-w-0 flex-1"
        describedById={
          TAXONOMY_FILTER_INCLUDES_DESCENDANTS ? undefined : "filter-category-hint"
        }
        onChange={(event) => {
          setRootId(event.target.value);
          setBranchId("");
        }}
      >
        <option value="">{labels.anyCategory}</option>
        {roots.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>

      {branchesHere.length > 0 ? (
        <Select
          aria-label={labels.categoryLabel}
          value={branchId}
          heightAs="control"
          className="min-w-0 flex-1"
          onChange={(event) => setBranchId(event.target.value)}
        >
          {/* Its value is empty, and the hidden field falls back to the
              category itself — «كل الفروع» is not a filter of its own,
              it is the absence of a narrower one. */}
          <option value="">{labels.anyBranch}</option>
          {branchesHere.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      ) : null}
      </div>

      {/* THE ORDER, AND «إزالة الفلاتر» UNDER IT — where the city and
          the branch stand under theirs, so a second line only ever
          appears beneath the chooser that caused it. */}
      <div className="max-lg:flex max-lg:min-w-0 max-lg:flex-col max-lg:gap-2 max-lg:[&>select]:flex-none lg:contents">
      <Select
        aria-label={labels.sortLabel}
        name="sort"
        // CONTROLLED, LIKE THE OTHER FOUR. It was `defaultValue`, which
        // an uncontrolled select reads once per mount — so it kept the
        // old ordering through a clear exactly as the rest did.
        value={sort}
        onChange={(event) => setSort(event.target.value as OpportunitySort)}
        heightAs="control"
        className="min-w-0 flex-1"
      >
        {/* NAMED `option`, NOT `sort`: the state above is called sort
            now, and a map parameter of the same name shadows it — which
            reads as a bug even where it is not one. */}
        {OPPORTUNITY_SORTS.map((option) => (
          <option key={option} value={option}>
            {labels.sortOptions[option]}
          </option>
        ))}
      </Select>


      {hasActiveFilters(query) ? (
        <Link
          href={`/${locale}/${basePath}`}
          className={buttonClasses("ghost", "sm") + " max-lg:h-10 max-lg:w-full max-lg:justify-center"}
        >
          {labels.clear}
        </Link>
      ) : null}
      </div>

      {/* A GLYPH, ON THE LINE WITH THE CHOOSERS — «ما يحتاج يكون فيه
          اسمه، أيقونة تفي بالغرض».

          IT WORE ITS WORD ON A PHONE for one build, at the foot of the
          column, and the owner caught what that cost: a control on a
          line of its own under three that were on one.

          THE NAME SURVIVES IN `aria-label` AND IN `sr-only`. An
          icon-only control with no accessible name is a button nobody
          can announce — and `sr-only` rather than `hidden`, so the
          word is still there for whoever is listening rather than
          looking. */}
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        aria-label={labels.apply}
        className="max-lg:h-10 max-lg:w-10 max-lg:shrink-0 max-lg:px-0"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="max-lg:sr-only lg:sr-only">{labels.showResults}</span>
      </Button>

      {/* Read from the contract, not asserted by hand: the API matches
          the selected node EXACTLY, so choosing a category does NOT
          include its branches. Saying so is the difference between a
          filter and a trap. If descendant matching ever ships, the
          constant flips and this disappears on its own. */}
      {TAXONOMY_FILTER_INCLUDES_DESCENDANTS ? null : (
        <p id="filter-category-hint" className="sr-only">
          {labels.categoryExactMatchHint}
        </p>
      )}
    </form>
  );
}
