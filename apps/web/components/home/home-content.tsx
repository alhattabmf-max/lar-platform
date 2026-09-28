import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { BannerSlot } from "@/components/banners/banner-slot";
import { loadOpportunities } from "@/lib/marketplace-data";
import { offerCardLabels } from "@/lib/offer-labels";
import { getSiteContent, siteText } from "@/lib/site-content";
import { MARKETPLACE_DEFAULT_SORT } from "@/lib/marketplace-query";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";

/** How many opportunities the landing page previews before sending you to the full list. */
const FEATURED_COUNT = 6;

/**
 * THE FRONT DOOR, DRAWN ONCE FOR BOTH FRONTS.
 *
 * «والصفحة الرئيسية للمشتري نفس محتوى الصفحة الرئيسية في واجهة الزائر»
 * — so this is a component rather than a page, and the visitor's home
 * and the buyer's home both render it. Two copies that agreed on the
 * day they were written is not "the same content".
 *
 * ORDER, per the approved reference: promotional strip, then the offers
 * grid. The merchandise is the front door — nothing sits above it
 * competing for the first screen.
 *
 * The offers shown are the ones closing soonest, because those are what
 * a reader can act on now. Each card carries the offer's real terms:
 * price, quantities and progress are public by decision, so someone can
 * judge an offer before creating an account.
 *
 * A failed listing read degrades to the empty state rather than to an
 * error page. This is the site's front door, and refusing to render it
 * because a listing query failed is strictly worse than rendering it
 * without the preview.
 *
 * ONE PIECE OF WORDING IS OPERATOR-EDITABLE — the offers heading. It
 * resolves to the operator's value when one is saved and to the shipped
 * message when it is not, so a blank field means "use the default"
 * rather than "show nothing". It is rendered as a TEXT NODE; there is
 * no markup path for operator content anywhere in this app, which is
 * what makes storing their text safe in the first place.
 */
export async function HomeContent({
  locale,
  detailBasePath,
}: {
  locale: AppLocale;
  /**
   * WHICH FRONT THE CARDS OPEN INTO — forwarded to the card.
   *
   * «عندما أضغط عرض تفاصيل المنتج في الصفحة الرئيسية في واجهة المشتري
   * يرجعني إلى صفحة الزائر.» Drawing the same content on both fronts is
   * the point of this component; sending both to the SAME detail page
   * was not, and it walked a signed-in buyer out of their own portal.
   *
   * IT IS A PROP AND NOT A SESSION READ. This renders on the public
   * front door too, where there is no session to read, and a component
   * that behaves differently by who is asking is a component two pages
   * cannot reason about. The page knows which front it is; it says so.
   */
  detailBasePath?: string;
}) {
  const t = await getTranslations({ locale, namespace: "home" });
  const common = await getTranslations({ locale, namespace: "common" });

  // Deduplicated with the chrome's own read by React's request cache, so
  // the two share one fetch.
  const content = await getSiteContent();
  const featuredTitle = siteText(content, "featuredTitle", locale) ?? t("featuredTitle");

  return (
    <div className="flex flex-col gap-4">
      {/* THE HERO PANEL IS GONE. The reference goes straight to the
          promotional strip and then to the offers, and a marketing block
          above them pushed the actual merchandise below the fold.

          `heroTitle` and `heroDescription` are deliberately still in the
          contract, still stored, and still editable from the admin
          content screen — they are simply not rendered. Removing the
          fields would be a contract change nobody asked for and would
          throw away wording an operator may already have written. */}
      {/* THE CATEGORIES LEFT THIS PAGE FOR THE CHROME — «ليه ما
          نخلّيها في الشريط نفس سطح المكتب وتنزلق». They are the band
          under the destinations now, on every page rather than on this
          one, and they carry the same sliding wave the row above them
          does. See `CategoryBandSlot`. */}

      {/* NO SUSPENSE BOUNDARY AROUND IT, AND THAT IS A FIX.

          MEASURED ON A HARD LOAD of the production build, in both
          locales: the slot held `<template id="B:0">` and the banner
          itself sat in `<div hidden id="S:0">` at the end of `<body>`,
          0×0 and never revealed. It is the same failure the search
          field spent four builds in, and the same remedy: the content
          is part of the shell now, so there is no boundary left to
          strand.

          THE FALLBACK WAS `null`, so nothing is lost by waiting for it:
          the page showed nothing in this space either way, and the read
          behind it is one call to this platform's own API.

          ONE PLACEMENT FOR BOTH FRONTS, and that is not an oversight:
            `BANNER_PLACEMENTS` is a closed vocabulary shared with the
            API and the database, so a buyers-only slot would be a new
            enum value and a migration. «نفس محتوى الصفحة الرئيسية في
            واجهة الزائر» is what was asked, and the same banner is part
            of the same content. */}
      <BannerSlot
          placement="PUBLIC_HOME"
          locale={locale}
          regionLabel={t("bannersLabel")}
          // EDGE TO EDGE, ON BOTH SCREENS — «اجعل مقاسه من حد الصفحة
          //  إلى حد الصفحة».
          //
          // THE SHEET'S OWN PADDING, CANCELLED: 16 on a phone and 24
          // from `lg`, undone here and nowhere else, so only the
          // banner reaches the paper's edge and every other block on
          // the page keeps its margin.
          //
          // AND FLUSH TO THE STRIP ABOVE IT on a wide screen —
          // «اجعله من فوق ملاصقًا لشريط التصنيفات». `lg:-mt-3` is
          // the sheet's own `lg:pt-3`, cancelled.
          //
          // THE CORNERS GO WITH THE MARGINS. A rounded image cut
          // against the screen's own edge reads as a mistake; the
          // frame and the link that wraps it are named rather than
          // swept, so nothing else inside the banner is flattened.
          className="-mx-4 lg:-mx-6 lg:-mt-3 [&_a]:rounded-none [&_[data-testid=banner-frame]]:rounded-none"
        />

      {/* THE PAGE'S OWN NAME, and it had none.

          The only top-level heading on this page was the FEATURED
          SECTION'S title, which reads «الأقرب إلى الإغلاق» — an
          ordering, announced to anyone navigating by headings as the
          name of the page. «لا تجعل «الأقرب إلى الإغلاق» هو عنوان
          الصفحة الرئيسي.»

          `home.title` already existed and was used nowhere. It is what
          the page is: «عروض شراء بالجملة». */}
      <h1 className="sr-only">{t("title")}</h1>


      <section aria-labelledby="featured-heading" className="flex flex-col">
        {/*
          THE HEADING IS NOT DRAWN, and it reserves no space.

          It is kept as a screen-reader-only heading rather than deleted
          outright, so anyone navigating by headings can still land on the
          section. It is an H2 and not the page's H1: it names this
          SECTION, and naming the page is `home.title`'s job above.

          The wording stays operator-editable, so a heading someone
          already wrote is still what assistive technology announces.
        */}
        <h2 id="featured-heading" className="sr-only">
          {featuredTitle}
        </h2>

        <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
          <FeaturedOpportunities locale={locale} detailBasePath={detailBasePath} />
        </Suspense>
      </section>
    </div>
  );
}

/**
 * The closing-soonest opportunities.
 *
 * A failed read degrades to the same empty state as "none published
 * yet": the front door must render either way, and there is nothing a
 * reader can do about a listing query that failed. The full marketplace,
 * one click away, shows the real error with its request id.
 */
async function FeaturedOpportunities({
  locale,
  detailBasePath,
}: {
  locale: AppLocale;
  detailBasePath?: string;
}) {
  const marketplace = await getTranslations({ locale, namespace: "marketplace" });

  const featured = await loadOpportunities({
    page: 1,
    pageSize: FEATURED_COUNT,
    sort: MARKETPLACE_DEFAULT_SORT,
  });
  const items = featured.ok ? featured.data.items : [];

  if (items.length === 0) {
    return (
      <EmptyState
        title={marketplace("empty.title")}
        description={marketplace("empty.description")}
      />
    );
  }

  return (
    /*
      ONE / TWO / THREE, by width — and the CARD ITSELF is untouched.

      Everything that changes here is the grid. The card keeps its own
      image, type, colours, spacing and progress bar exactly as approved;
      making three fit by shrinking its insides would be changing the
      card, which is the one thing this must not do.

      TWO ACROSS, AND THE BREAKOUT IS GONE. «طبّق تصميم بطاقة المنتج
      بطاقتين في الصف» is the owner's rule and it stands. The grid used
      to widen past a 1152px column at 1600px — a width and equal
      negative margins measured against that column — purely so a THIRD
      card could fit without shrinking the other two. The page stands on
      a full-width sheet now: there is no column to break out of, the
      margins would pull the grid off the sheet's edge, and the two
      cards have the room the breakout was buying them anyway.

      THREE TO A ROW WHERE THERE IS ROOM — «أحتاج أقلّل بعض المعلومات
      عشان يصير الصف يأخذ ثلاث بطاقات».

      IT IS THE PICTURE THAT BOUGHT THE THIRD CARD, not the grid. At
      three across a card is about 308px on a 1024 screen, and a 112px
      photograph took a THIRD of it; at 80 it takes a quarter. The two
      figures that left — the selling unit into the price, the region
      into the detail page — paid for the rest.

      AND NOT BELOW `lg`. Below 1024 a third card is 240px, where the
      picture is a third again and nothing beside it can be read.
    */
    <ul className="grid list-none grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {items.map((opportunity) => (
        <li key={opportunity.id}>
          <OpportunityCard
            opportunity={opportunity}
            locale={locale}
            labels={offerCardLabels(marketplace, opportunity, locale)}
            detailBasePath={detailBasePath}
          />
        </li>
      ))}
    </ul>
  );
}
