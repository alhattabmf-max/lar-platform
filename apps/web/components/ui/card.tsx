import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A surface, not a control.
 *
 * RAISED LESS THAN A BUTTON, deliberately. A card that lifts higher
 * than the button inside it reads as the thing to press, and then the
 * button on it has nowhere left to go. `shadow-card` is the lightest
 * lift in Soft Elevation for that reason.
 *
 * EIGHT DOWN, TWELVE ACROSS, EIGHT BETWEEN — and never sixteen. A card
 * is a container, not a room: sixteen pixels of air on every side of a
 * three-line panel is a page that scrolls for nothing. The measurements
 * are tokens, so a card added next year inherits them without knowing
 * they exist.
 *
 * THE ROOMIER VERTICAL MEASURE IS OPT-IN. A large card carrying several
 * sections — a header, two lists and a footer — earns 12px top and
 * bottom by asking for `sectioned`, which is a decision somebody takes
 * rather than a default that spreads.
 */
export interface CardProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /**
   * A large card with several sections inside it.
   *
   * Loosens the VERTICAL padding of the header, body and footer from
   * 8px to 12px. Nothing else changes — the horizontal measure is the
   * same everywhere, because a wider gutter on one card and not another
   * is what makes a page look assembled from parts.
   */
  sectioned?: boolean;
}

/**
 * Shared by the card and by anything that has to match one.
 *
 * IT IS OUTLINED AGAIN, AND THE OUTLINE IS THE POINT.
 *
 * The border came off once, on the reasoning that a border AND a
 * shadow are two answers to one question and the line is the noisier
 * of them. That reasoning assumed the shadow could answer alone, and
 * it cannot: a white card on the page is 1.17:1, so with no line there
 * is LITERALLY nothing at the edge but a few per cent of grey haze.
 * The owner, looking at a page of them: «لون البطاقة قريب جدًا، ما هو
 * واضح إنها بطاقة إلا إذا دقّقت النظر جدًا».
 *
 * WHY THE 3:1 TOKEN AND NOT THE HAIRLINE. A rule between two rows of
 * one table is decorative — lose it and the table is still a table.
 * A card's edge is the whole of what says where one thing ends and
 * the next begins, which is the boundary WCAG 1.4.11 asks 3:1 of.
  * `--color-border-control` measures 3.61:1 on white and 3.10:1 on the
 * page; the hairline manages 1.81 and 1.73 and was tried first.
 *
 * THE SHADOW STAYS. The line says where the edge is, the shadow says
 * the card is above the page — two questions, not one.
 */
export const CARD_SURFACE = "rounded-card border border-line-control bg-surface shadow-card";

export function Card({ children, className, ariaLabel, sectioned }: CardProps) {
  return (
    <section
      aria-label={ariaLabel}
      // The flag travels down in the DOM rather than through props, so
      // a caller composing `CardHeader` and `CardBody` by hand gets the
      // same spacing as one passing children straight in.
      data-sectioned={sectioned ? "true" : undefined}
      className={cn(CARD_SURFACE, className)}
    >
      {children}
    </section>
  );
}

/**
 * The vertical measure, read from the card above it.
 *
 * `group`-less on purpose: a CSS attribute selector on the ancestor is
 * one rule that works however deeply the parts are nested, where a
 * prop would have to be threaded through every intermediate component.
 */
const PAD_Y =
  "py-card-y [[data-sectioned='true']_&]:py-card-y-sectioned";

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-b border-line px-card-x", PAD_Y, className)}>{children}</div>
  );
}

/**
 * A CARD'S TITLE — an H2 by default, because a card is usually one
 * section of a page that has its own name above it.
 *
 * SOMETIMES THE CARD IS THE PAGE. On sign-in, registration and
 * password recovery there is nothing else on the screen: the card's
 * title IS the page's name, and the outline began at H2 with no H1
 * anywhere — measured on all four. Rather than print the same words a
 * second time in a hidden H1, those pages ask for the heading they
 * already show to be the top-level one.
 *
 * NOTHING VISUAL CHANGES. The type size, weight and colour are the
 * card's whatever the tag; only the document outline moves.
 */
export function CardTitle({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return <Tag className={cn("text-base font-semibold text-content", className)}>{children}</Tag>;
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  // `gap-card-gap` is the eight pixels BETWEEN the things inside, and it
  // only applies to a body that lays its children out — a plain block
  // of prose is unaffected.
  return <div className={cn("px-card-x", PAD_Y, "[&>*+*]:mt-card-gap", className)}>{children}</div>;
}

