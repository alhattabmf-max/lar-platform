"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/field";
import { useQueryParam } from "@/lib/use-query-param";

/**
 * THE ONE SEARCH FIELD, on the row of tabs.
 *
 * «حقل بحث بجانب أيقونة الإشعارات، ويتمدد إلى آخر لسان موجود في
 *  الصفحة: في واجهة الزائر يمتد إلى لسان الرئيسية، وفي المورد أو
 *  المشتري إلى نهاية اللسان الثاني.»
 *
 * IT IS THE ROW'S FREE SPACE, and that is the whole geometry. It sits
 * between the tab shapes and the bell with `flex-1`, so whatever the
 * tabs do not use, it takes — which puts its far edge against the bell
 * and its near edge against the last tab, in every portal and both
 * directions, without anything measuring anything.
 *
 * WHAT IT SEARCHES IS THE PORTAL'S OWN WORLD — the owner's decision:
 * each front searches what it already shows. `action` is that front's
 * listing, handed in by the chrome that knows it, so this component
 * decides nothing about destinations.
 *
 * IT WEARS THE PLATFORM'S OWN FIELD, and had to be told to twice.
 * «الخط جاي باللون الأبيض ولا يبين، والحقل باهت ليس له حدود» — the
 * first draft was white ink on a ten-per-cent white wash of the navy
 * behind it: no edge, because the wash is nearly the bar's own colour,
 * and ink at barely two-to-one. The second was a hand-drawn white box,
 * which a guard caught for the deeper reason: a page that dresses its
 * own control is how a design system stops being one. It is `Input`
 * with the OUTLINED skin — white, a visible line, no inner shadow —
 * the same skin the owner chose for the screens he has moved.
 *
 * IT WATCHES THE QUERY STRING, and it took three attempts to do it.
 *
 * ONE — read the address on a PATH change. «إزالة الفلاتر» goes from
 * `/opportunities?q=حديد` to `/opportunities`: same path, different
 * query. The box kept a word describing a list nobody was looking at.
 *
 * TWO — `useSearchParams` wrapped in `<Suspense>` inside `PortalSearch`,
 * a SERVER component whose output is handed to this client row as a
 * prop. The prerendered page count stayed at 63, which is what I
 * checked and reported. It was the wrong thing to check: on a
 * production build the field was not on the page at all. The row's slot
 * held `<!--$~--><template id="B:0">` — an unresolved boundary — and the
 * finished form sat in a `div#S:0` at the end of `<body>`, never
 * swapped in. Measured 0×0 at 1366 and at 1600.
 *
 * THREE — an effect with no dependency array, reading `window`. It
 * cannot work and the sequence proved it: a query-only navigation does
 * not re-render this component, so the effect never runs and the box
 * trails the address by exactly one step. Measured: address `?q=حديد`
 * with «أسمنت» still in the field.
 *
 * FOUR — `useSearchParams` with the boundary moved into the client
 * row, then with its child made pure client code. Both stranded the
 * boundary exactly as before. Measured 0×0 again.
 *
 * WHAT IT DOES NOW is `useQueryParam`, which subscribes to the ADDRESS
 * rather than to the router: `popstate` for back and forward, and a
 * one-time wrap of `pushState`/`replaceState` for everything else. No
 * suspense, no prerender interaction, and nothing that can strand a
 * boundary — see `lib/use-query-param.ts` for why each earlier attempt
 * failed.
 *
 * A SEARCH FROM THE LISTING KEEPS THE LISTING'S FILTERS. If a reader is
 * already looking at a category and types a word, they mean "within
 * this" — so the existing parameters survive and only the page number
 * is dropped, because page four of the old result is not page four of
 * the new one. From anywhere else it opens a clean listing.
 */
export function ChromeSearch({
  action,
  placeholder,
  label,
  submitLabel,
}: {
  /** The portal's own listing — `/ar-SA/opportunities`, `/ar-SA/supplier/opportunities`. */
  action: string;
  placeholder: string;
  /** The accessible name of the field itself. */
  label: string;
  /** The accessible name of the button, which shows only an icon. */
  submitLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [term, setTerm] = useState("");

  /**
   * WHAT THE ADDRESS SAYS, WHENEVER IT CHANGES — a search, a second
   * search on the same path, a cleared filter, back, forward.
   *
   * RESET DURING RENDER, not in an effect. React's own answer to
   * "adjust state when a prop changes": an effect would paint the old
   * word first and correct it a frame later, and a reader would watch
   * one search term blink into another.
   *
   * THE GUARD IS ON THE ADDRESS, NOT THE FIELD. Comparing the field
   * would overwrite it on every keystroke; comparing the address leaves
   * typing alone, because typing does not change the address.
   */
  const inAddress = useQueryParam("q");
  const [lastInAddress, setLastInAddress] = useState(inAddress);
  if (inAddress !== lastInAddress) {
    setLastInAddress(inAddress);
    setTerm(inAddress);
  }

  return (
    <form
      role="search"
      data-testid="chrome-search"
      onSubmit={(event) => {
        event.preventDefault();

        const onListing = pathname === action;
        const params = new URLSearchParams(onListing ? window.location.search : "");
        const typed = term.trim();

        if (typed) params.set("q", typed);
        else params.delete("q");
        params.delete("page");

        const query = params.toString();
        router.push(query ? `${action}?${query}` : action);
      }}
      className="relative flex min-w-0 flex-1 items-center"
    >
      <Input
        type="search"
        name="q"
        appearance="outlined"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        // THE TERM THE SERVER ACCEPTS, and no longer. The listing's own
        // query object caps it at a hundred characters and answers 400
        // past that; refusing the hundred-and-first keystroke here
        // means a reader never sends a request that cannot succeed.
        maxLength={100}
        // AND NO LIST OF WHAT WAS TYPED BEFORE — «إذا جيت أكتب
        //  يعطيني ظلّ أبيض تحته وحجمه قريب من الشريط».
        //
        // THAT WAS THE BROWSER, NOT THE PAGE. A named input with no
        // `autocomplete` gets the browser's own history panel: a
        // white box the width of the field, dropped over the rule
        // and the page under it, styled by nothing here. This is a
        // search box for a catalogue, and what a reader typed last
        // week is not a suggestion about it.
        autoComplete="off"
        // ROOM AT THE FAR END for the button standing in it. Everything
        // else — the height, the line, the ink, the focus halo — comes
        // from the skin and is not restated here.
        //
        // AND THE NATIVE CLEAR CROSS IS OFF. `type="search"` gives
        // Chrome an ✕ of its own at the field's inline END — which
        // is exactly where the magnifier below stands, so the two
        // landed on the same corner the moment anything was typed.
        // One control there, and it is the one that does something
        // a keyboard cannot already do.
        //
        // AND THE ENDS ARE FULLY ROUND — «قوّس أطراف حقل البحث عشان
        //  يتناسق مع هوية الموقع الجديدة». A square field a few
        // pixels above a curved wave is two grammars in one bar.
        //
        // HERE AND NOT IN THE ROWS. The narrow row set it by a
        // descendant selector of its own while the wide one stayed
        // square; one field, one shape, written once.
        className="rounded-full pe-10 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {/* THE MAGNIFIER IS THE SUBMITTER, not a decoration beside one.
          Enter sends a search field and always did; this is for the
          pointer, and drawing the icon on the button rather than under
          it means the one visible mark on the field is also the one
          you can press.

          AT THE CONTROL HEIGHT, like everything else that can be
          pressed on this platform — a hand-drawn 16px hit area is how
          a row ends up with six different targets. */}
      <button
        type="submit"
        aria-label={submitLabel}
        className="absolute end-0 inline-flex min-h-control w-10 items-center justify-center rounded-control text-content-muted hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
      </button>
    </form>
  );
}
