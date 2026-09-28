"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GlobeSolidIcon } from "@/components/ui/icons";

/**
 * The language control: one globe, no words.
 *
 * IT KEEPS YOU WHERE YOU ARE. It used to point at `/{otherLocale}` —
 * the home page — so switching language from an offer, a list or a
 * policy threw the reader back to the front door and made them find
 * their place again. The current path is read here and the locale
 * segment swapped, so the same page answers in the other language.
 *
 * A plain <a>, deliberately, not next/link: switching locale has to
 * reload the DOCUMENT so `lang` and `dir` on <html> are re-rendered by
 * the root layout. A client-side navigation would leave an Arabic page
 * marked as English, or an English one still flowing right to left.
 *
 * IT KEEPS THE QUERY TOO. A control panel list carries its search, its
 * filters and its page number in the address; dropping them on a
 * language change would answer in the other language and silently show
 * a different set of rows, which reads as the switch having done
 * something else entirely.
 *
 * The label is the accessible name AND the tooltip, and it names the
 * DESTINATION ("Switch to Arabic") rather than the current language —
 * an icon-only control that announced "Language" would tell a
 * screen-reader user nothing about what pressing it does.
 */
export interface LocaleSwitchProps {
  locale: string;
  otherLocale: string;
  /** e.g. "Switch to Arabic" — already translated by the caller. */
  label: string;
  /**
   * The DESTINATION language's own name — «English» on an Arabic page.
   *
   * Optional: the control is still a bare glyph where there is no room
   * for a word, and the accessible name carries the same sentence
   * either way.
   *
   * IN ITS OWN LANGUAGE, always. «English» is written in English and
   * «العربية» in Arabic, because a language's name is the one string
   * that must be legible to somebody who cannot read the page it is on.
   */
  otherLocaleName?: string;
  /**
   * WHAT THE NAME WEARS — for the width where there is no room.
   *
   * The owner's narrow row is «أيقونة تسجيل دخول ولغة»: two glyphs
   * beside a logo and a tab at 360, where «العربية» spelled out is
   * the difference between fitting and wrapping. `max-lg:hidden`
   * from the caller drops the word below `lg` and nowhere else.
   *
   * NOTHING IS LOST BY HIDING IT: this control's accessible name is
   * its `aria-label`, which names the DESTINATION language in full
   * whether the word is drawn or not.
   */
  nameClassName?: string;
  /**
   * The shape shared with the two actions beside it.
   *
   * Passed in rather than written here so the three controls in the top
   * bar are literally the same string: an icon button that keeps its
   * own height and radius is the one that stops matching the moment
   * either is adjusted.
   */
  className: string;
  /**
   * The glyph, when the caller's icon set is not this app's own.
   *
   * The control panel draws from Lucide and the marketplace header from
   * the hand-drawn set; passing it keeps one implementation of the
   * BEHAVIOUR rather than forking the component over a picture.
   */
  icon?: ReactNode;
}

export function LocaleSwitch({
  locale,
  otherLocale,
  label,
  otherLocaleName,
  nameClassName,
  className,
  icon,
}: LocaleSwitchProps) {
  const pathname = usePathname();
  const params = useSearchParams();

  // Everything after the locale segment, kept as-is. A path that does
  // not start with the current locale (which should not happen, but a
  // rewrite could) falls back to the other locale's root rather than
  // producing a broken URL.
  const rest =
    pathname &&
    (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`))
      ? pathname.slice(locale.length + 1)
      : "";

  const query = params.toString();

  return (
    <a
      href={`/${otherLocale}${rest}${query ? `?${query}` : ""}`}
      lang={otherLocale}
      hrefLang={otherLocale}
      aria-label={label}
      title={label}
      data-testid="locale-switch"
      className={className}
    >
      {/* SIXTEEN PIXELS, AND THE CODE NOW SAYS SO.
          This read `size-5` and rendered 16, not 20: the icon set
          writes `h-4 w-4` into its own class and `cn` JOINS rather than
          merges, so both reached the stylesheet and its order decided.
          The number here was inert — anyone raising it would have seen
          nothing change and gone looking in the wrong file.
          AND SIXTEEN IS THE RIGHT ANSWER beside fourteen-point type —
          «ولهم متوازيين في الحجم حتى لو تصغر الأيقونة عادي» — so what
          changed is the honesty, not the picture. */}
      {icon ?? <GlobeSolidIcon />}
      {/* The name, when there is room for it. `lang` and `dir` on the
          word itself: «English» inside an Arabic paragraph is a run of
          Latin text in a right-to-left flow, and saying so is what
          keeps it from being reordered around the glyph. */}
      {otherLocaleName ? (
        <span
          lang={otherLocale}
          dir={otherLocale.startsWith("ar") ? "rtl" : "ltr"}
          className={nameClassName}
        >
          {otherLocaleName}
        </span>
      ) : null}
    </a>
  );
}
