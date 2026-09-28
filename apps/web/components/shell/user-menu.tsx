"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UserSolidIcon } from "@/components/ui/icons";

/**
 * WHAT A WORD WEARS INSIDE THE ROW — the inline shape's own item.
 *
 * No fill, no border, no hover ground: it stands ON the row's white
 * beside a glyph, and a tinted block there would read as a second
 * control rather than as the glyph's own words. The identity's navy
 * on white measures 15.7:1.
 */
export const USER_MENU_INLINE_ITEM =
  "whitespace-nowrap px-2 text-sm font-medium text-primary " +
  "hover:opacity-[var(--state-hover-opacity)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

export interface UserMenuLabels {
  /** What the icon announces, e.g. «حسابي». */
  open: string;
  /** «بياناتي» — the company's own record. */
  record: string;
  /** «خروج», and not «تسجيل الخروج» — see below. */
  signOut: string;
  /** While the sign-out request is in flight. */
  signingOut: string;
}

/**
 * THE ACCOUNT, BEHIND ONE ICON.
 *
 * «استبدل تسجيل الخروج وأيقونته بأيقونة مستخدم، عند مرور الماوس عليها
 * أو الضغط أو اللمس ينبثق منها خياران: بياناتي وخروج، بدون كلمة تسجيل
 * خروج، مكتفيًا بكلمة خروج — كذا أنظف وأسهل للمستخدم. وانقل بيانات
 * المنشأة إلى داخل أيقونة المستخدم بمسمّى بياناتي.»
 *
 * SO A TAB AND A BUTTON BECAME ONE GLYPH. «بيانات المنشأة» left the row
 * of tabs and «تسجيل الخروج» left the end of it; both live here, which
 * is where a reader looks for anything about their own account.
 *
 * THREE WAYS IN, AND THEY DO NOT FIGHT. Hover opens it for a pointer;
 * click opens it for touch, where hover does not exist; Enter or Space
 * on the focused button is that same click. Hover and the explicit
 * open are tracked SEPARATELY — one shared flag would mean the pointer
 * entering opens the menu and the click that follows immediately shuts
 * it, so a touch user could never get in.
 *
 * IT CLOSES ITSELF. Pointing away, clicking away and Escape all shut
 * it, and Escape returns focus to the glyph that opened it.
 *
 * AND ON A PHONE IT DOES NOT OPEN OVER ANYTHING AT ALL.
 *
 * «عند الضغط على أيقونة المورّد أو المشتري تظهر منبثقة فيها بياناتي
 *  وخروج — أقدر أعدّلها وأخلّيه أول ما يضغط على الأيقونة تطلع كلمة
 *  خروج وكلمة بياناتي بشكل موازٍ ليه، بحيث إن أيقونة الإشعارات
 *  والبحث تتمدّد ناحية الشعار، والشعار يكون ثابت وهذي تدخل تحته.»
 *
 * THAT IS `inline`. The two words are drawn IN the row, beside the
 * glyph, and the row re-shares its own width: the mark is
 * `shrink-0` and does not move, the search is `flex-1 min-w-0` and
 * gives up exactly what the words take. Nothing floats, nothing is
 * covered, and the panel's shadow and border are not needed
 * because there is no second surface.
 *
 * IT ANIMATES BY GRID, not by width: a width of `auto` cannot be
 * transitioned, and a fixed one would be a number to maintain
 * against two languages. `grid-cols-[0fr]` to `[1fr]` is the same
 * device the category band folds with.
 *
 * AND IT IS `invisible` WHILE CLOSED, not merely clipped. A link
 * inside a zero-width `overflow-hidden` box is still in the tab
 * order — a keyboard would land on «خروج» inside a control that
 * looks shut.
 *
 * HOVER DOES NOT OPEN THE INLINE ONE. It is the phone's shape, and
 * a pointer merely crossing the glyph must not push the search
 * field sideways.
 */
export function UserMenu({
  recordHref,
  labels,
  signOut,
  inline = false,
}: {
  recordHref: string;
  labels: UserMenuLabels;
  /** Open into the row rather than over the page — see above. */
  inline?: boolean;
  /**
   * THE WAY OUT, ALREADY BUILT.
   *
   * The console and a company sign out through DIFFERENT endpoints, and
   * a menu that took the act as a slot could never be handed the wrong
   * one — which is exactly why it is handed in rather than chosen here.
   */
  signOut: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = pinned || (hovered && !inline);

  const INLINE_ITEM = USER_MENU_INLINE_ITEM;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setHovered(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setHovered(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={boxRef}
      className={inline ? "flex items-center" : "relative"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setPinned(false);
          setHovered(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={labels.open}
        onClick={() => setPinned((was) => !was)}
        data-testid="user-menu"
        // THE SIZE THE BELL IS — «خلّ الأيقونة بحجم أيقونة الإشعارات».
        // The three glyphs at the row's end are one family and one
        // target; what still separates the bell is that it is filled
        // and wears the accent, which the owner keeps on purpose.
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-primary [&>svg]:size-6 hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {/* TWENTY FOUR, NOT SIXTEEN — «استخدم أيقونة أفضل، هذي جايه
            صغيرة». The set draws at 16px, which is right beside a word
            and lost inside a forty-pixel circle with nothing else in it.

            THE SIZE IS ON THE BUTTON, not passed to the glyph: 
            joins classes and does not merge them, so the set own
             and a  handed in would both reach the
            stylesheet and the order there would decide. A child selector
            outranks both and cannot be re-ordered away. */}
        <UserSolidIcon aria-hidden="true" />
      </button>

      {inline ? (
        <div
          className={
            "grid transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none " +
            (open ? "grid-cols-[1fr]" : "grid-cols-[0fr]")
          }
        >
          <div
            role="menu"
            data-testid="user-menu-panel"
            className={
              "flex items-center overflow-hidden " +
              (open ? "visible" : "invisible")
            }
          >
            <Link
              href={recordHref}
              role="menuitem"
              onClick={() => {
                setPinned(false);
                setHovered(false);
              }}
              data-testid="user-menu-record"
              className={INLINE_ITEM}
            >
              {labels.record}
            </Link>
            {signOut}
          </div>
        </div>
      ) : open ? (
        <div
          role="menu"
          data-testid="user-menu-panel"
          // SMALL, AND WITH NOTHING BETWEEN THE TWO — «الإطار المنبثق
          // كبير وفيه فراغات وقبيح». It was a 176px box with eight
          // pixels of padding, four between its rows and a card radius
          // around all of it: a panel built for a list, holding two
          // words.
          //
          // WHAT IT IS NOW is the width of its own content and no more,
          // one pixel of padding, no gap, and a hairline between the two
          // rows rather than air — a menu, not a card.
          className="absolute end-0 z-50 mt-1 flex min-w-max list-none flex-col overflow-hidden rounded-control border border-line bg-surface p-1 text-start shadow-overlay [&>*+*]:border-t [&>*+*]:border-line"
        >
          {/* «بياناتي» — the company's own record, which used to be a tab
              of its own in the row. */}
          <Link
            href={recordHref}
            role="menuitem"
            onClick={() => {
              setPinned(false);
              setHovered(false);
            }}
            data-testid="user-menu-record"
            className="whitespace-nowrap px-4 py-2 text-sm font-medium text-content hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            {labels.record}
          </Link>

          {/* «خروج», and the word «تسجيل» is gone with the button —
              «مكتفيًا بكلمة خروج، كذا أنظف وأسهل للمستخدم». */}
          {signOut}
        </div>
      ) : null}
    </div>
  );
}
