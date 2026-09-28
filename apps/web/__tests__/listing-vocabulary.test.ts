import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «فرصة» IS NOT A WORD THIS PLATFORM SAYS ANY MORE.
 *
 * The owner's decision: what a supplier adds and a buyer browses is a
 * PRODUCT. The word «فرصة» named a second concept nobody outside the
 * codebase had a use for, and a supplier had to learn it to sell
 * anything.
 *
 * WHAT DID NOT CHANGE IS THE DATA MODEL, and this file is careful not
 * to pretend otherwise. The platform still writes two rows — a
 * catalogue row frozen into an append-only snapshot at publication, and
 * an offer row carrying the pinned tax, share tier and commission every
 * order hangs off — because that split is the only mechanism by which a
 * supplier can fix a typo tomorrow without rewriting what somebody
 * bought last month. `opportunity` therefore stays in identifiers,
 * routes and types. It is gone from what a person READS.
 *
 * THE ONE EXCEPTION IS THE COMPANY'S OWN NAME. «منصة فرصة» is FORSA,
 * not an offer, and a blanket replace would have renamed the business.
 */
const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const AR = JSON.parse(read("messages/ar-SA.json"));
const EN = JSON.parse(read("messages/en-SA.json"));

/** Every leaf string in a catalogue, with the path that reached it. */
function leaves(node: unknown, prefix = ""): { key: string; text: string }[] {
  if (typeof node === "string") return [{ key: prefix, text: node }];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node as Record<string, unknown>).flatMap(
    ([part, value]) => leaves(value, prefix ? `${prefix}.${part}` : part),
  );
}

/** The two payment notices that name the company rather than an offer. */
const COMPANY_NAME = /منصة فرصة|تحتفظ فرصة/;

describe("the word left the vocabulary", () => {
  it("says «فرصة» nowhere in Arabic except as the company's name", () => {
    const offenders = leaves(AR)
      .filter((entry) => /فرص/.test(entry.text))
      .filter((entry) => !COMPANY_NAME.test(entry.text));

    expect(offenders).toEqual([]);
  });

  it("says «opportunity» nowhere in English", () => {
    const offenders = leaves(EN).filter((entry) =>
      /opportunit/i.test(entry.text),
    );

    expect(offenders).toEqual([]);
  });

  it("KEEPS the two notices that name the company, which are not offers", () => {
    // Asserted rather than merely allowed: an over-eager sweep that
    // "finished the job" would rename the business, and the test that
    // was protecting them would have gone quiet.
    const kept = leaves(AR).filter((entry) => COMPANY_NAME.test(entry.text));

    expect(kept).toHaveLength(2);
  });

  it("keeps both catalogues the same shape, so neither drifts", () => {
    const arKeys = leaves(AR)
      .map((entry) => entry.key)
      .sort();
    const enKeys = leaves(EN)
      .map((entry) => entry.key)
      .sort();

    expect(arKeys).toEqual(enKeys);
  });
});

describe("the supplier keeps its goods and its offers apart", () => {
  it("offers a list for each, because they are two different facts", () => {
    // THEY WERE ONE LIST FOR A WHILE, and a supplier who wanted to
    // record goods without selling them yet had nowhere to put them:
    // «أضف تبويبًا مستقلًا باسم عروضي بجانب منتجاتي». A PRODUCT is what
    // the supplier keeps — a name, a picture, a weight. An OFFER is what
    // the market can see — a price, a quantity, a clock.
    const nav = read("components/supplier/supplier-portal-nav.ts");

    expect(nav).toContain('segment: "products"');
    expect(nav).toContain('segment: "opportunities"');
  });

  it("names them «منتجاتي» and «عروضي», because that is what a supplier calls them", () => {
    expect(AR.supplier.nav.products).toBe("منتجاتي");
    expect(EN.supplier.nav.products).toBe("My products");
    expect(AR.supplier.nav.opportunities).toBe("عروضي");
    expect(EN.supplier.nav.opportunities).toBe("My offers");
  });

  it("adds a product WITHOUT selling it, and sells in a second act", () => {
    const form = read("components/supplier/listing-form.tsx");

    // ONE FORM, TWO SCOPES. Adding and publishing were a single
    // submission for a while, which left a supplier no way to record
    // goods they were not selling yet — the owner's rule: «يسجّل المورد
    // كل منتجاته وتُحفظ لديه، ثم يُنشئ عرضًا على منتجات مختارة».
    expect(form).toContain("scope: ListingScope");
    expect(form).toContain('"/companies/me/products"');
    expect(form).toContain('"/companies/me/opportunities"');
    // The merged create is gone from what a supplier's button does.
    expect(form).not.toContain('"/companies/me/listings"');
    expect(form).not.toContain("toListingFields(values)");

    // Each button says what its own act does. «إضافة المنتج» records;
    // «نشر العرض» sells. Neither promises the other.
    expect(AR.supplier.listings.form.submit).toBe("إضافة المنتج");
    expect(EN.supplier.listings.form.submit).toBe("Add product");
    expect(AR.supplier.listings.form.submitOffer).toBe("نشر العرض");
    expect(EN.supplier.listings.form.submitOffer).toBe("Publish offer");
  });

  it("asks each scope for its OWN fields and no others", () => {
    const rules = read("lib/listing-form.ts");

    // The weight of a packed carton does not change because the price
    // did, and a branch is chosen per sale rather than per product.
    // `scopeFields` is the single place that decides which is which, and
    // validation, the error summary and the request builders all read
    // it — so the two halves cannot drift apart in three places.
    expect(rules).toContain("PRODUCT_SCOPE_FIELDS");
    expect(rules).toContain("OFFER_SCOPE_FIELDS");
    expect(rules).toContain("export function scopeFields(");

    for (const field of [
      "weightPerUnit",
      "packageContentQuantity",
      "taxonomyNodeId",
    ]) {
      const at = rules.indexOf("PRODUCT_SCOPE_FIELDS");
      const to = rules.indexOf("OFFER_SCOPE_FIELDS");
      expect([field, rules.slice(at, to).includes(`"${field}"`)]).toEqual([
        field,
        true,
      ]);
    }
    for (const field of [
      "unitPriceAmount",
      "targetQuantity",
      "fulfillmentLocationId",
    ]) {
      const at = rules.indexOf("export const OFFER_SCOPE_FIELDS");
      const to = rules.indexOf("export function scopeFields");
      expect([field, rules.slice(at, to).includes(`"${field}"`)]).toEqual([
        field,
        true,
      ]);
    }
  });

  it("asks for a BRANCH only when the category has branches", () => {
    const form = read("components/supplier/listing-form.tsx");

    // A permanently-visible empty control on a category with no
    // branches is a question with no answer; a category WITH branches
    // that never asks is a product filed where the API refuses it.
    expect(form).toContain("branches.length > 0 ?");
    expect(form).toContain("children.length > 0 ?");
  });
});

describe("the retired addresses forward rather than 404", () => {
  // «عروضي» IS A DESTINATION AGAIN, and so are the offer's own pages —
  // none of them is in this list. The one address left forwarding is
  // `opportunities/new`: an offer is created ON a product, so a "new
  // offer" with no product named has nowhere of its own to be, and it
  // points at the catalogue, which is the question it used to open by
  // asking.
  const FORWARDS = [
    "app/[locale]/supplier/opportunities/new/page.tsx",
    "app/[locale]/(public)/products/page.tsx",
    "app/[locale]/(public)/products/[id]/page.tsx",
  ];

  it.each(FORWARDS)("%s redirects", (page) => {
    // A bookmark from last week, a link in an email, a banner an
    // operator placed — none of them is a mistake, and none of them
    // should meet a 404 because the vocabulary moved.
    expect(read(page)).toContain("redirect(");
  });

  it("carries the query across the public alias, or the forward is worse than a 404", () => {
    // `/products?taxonomyNodeId=…` losing its filter would drop a
    // reader who asked for one category onto all of them.
    const alias = read("app/[locale]/(public)/products/page.tsx");

    expect(alias).toContain("searchParams");
    expect(alias).toContain("URLSearchParams");
  });
});

describe("three cards in a row where there is room, on every surface", () => {
  /**
   * EVERY SURFACE THAT DRAWS A PRODUCT, and the buyer's market is now
   * one of them — «لا أريد اختلافًا في شكل بطاقة المنتج في الرئيسية وفي
   * السوق أو أي صفحة تحمل منتجًا معروضًا».
   */
  it.each([
    "components/home/home-content.tsx",
    "app/[locale]/(public)/opportunities/page.tsx",
    "app/[locale]/trader/opportunities/page.tsx",
  ])("%s lays out two and three by width", (page) => {
    const source = read(page);

    // TWO ON A PHONE AND THREE FROM `lg` — «جايه بطاقة وحدة كبيرة
    //  وأنا أفضّل بطاقتين».
    //
    // ONE PER ROW WAS THE BASE and it made the phone a column of
    // billboards. Two fit because the card stopped repeating the
    // detail page: the minimum order, the region and the selling
    // unit all left it.
    expect(source).toContain("grid-cols-2");
    expect(source).toContain("lg:grid-cols-3");
    expect(source).not.toContain("grid-cols-1");
  });

  it("draws the SAME card on all three, never a second component", () => {
    // Two components drawing the same offer is how one product came to
    // look like two different things either side of signing in.
    for (const page of [
      "components/home/home-content.tsx",
      "app/[locale]/(public)/opportunities/page.tsx",
      "app/[locale]/trader/opportunities/page.tsx",
    ]) {
      const source = read(page);
      expect(source).toContain(
        'from "@/components/opportunities/opportunity-card"',
      );
      expect(source).toContain("offerCardLabels(");
    }
  });
});

describe("adding is not selling, and only selling is gated", () => {
  /**
   * The owner's rule: «لا تجعل قيود بيانات المورد تغلق اظافة المنتج
   * اجعلها فقط على عرض المنتج للبيع». A supplier missing a tax profile
   * can build their catalogue today and offer it the moment their
   * record is complete.
   *
   * WHAT USED TO HAPPEN: the whole submission failed, the product sat
   * as a draft nobody was told about, and pressing the button again
   * made a second copy.
   */
  const FORM = read("components/supplier/listing-form.tsx");
  // THE OFFER'S OWN PAGE. A blocked publication is a fact about the
  // OFFER — the product it was made on saved perfectly well — so the
  // sentence naming what is missing belongs where the offer is.
  const DETAIL = read("app/[locale]/supplier/opportunities/[id]/page.tsx");
  const SERVICE = read("../../apps/api/src/listings/listings.service.ts");

  it("resolves rather than throws when the company cannot sell yet", () => {
    expect(SERVICE).toContain("listed: false");
    expect(SERVICE).toContain("listed: true");
    // A real failure — a rejected image, a lost connection — still
    // throws. Dressing one of those as a saved product would be worse
    // than the bug this replaced.
    expect(SERVICE).toContain("if (!blocker) throw error;");
  });

  it("keeps the gate ON the act of selling", () => {
    // `resume()` is what the «نشر» button calls, and it still throws:
    // there the supplier ASKED to publish, and telling them it worked
    // when it did not is the lie that button exists to avoid.
    expect(SERVICE).toContain("THROWS when it is still blocked");
  });

  it("says what is missing on the OFFER'S OWN PAGE, in every state", () => {
    // It used to read the reason only in ACTION_REQUIRED — the state a
    // REpublish leaves behind. A product added while the company was
    // incomplete never reaches that state; it stays DRAFT carrying its
    // blocker, and the page was showing the generic "review and
    // publish" instead of the sentence that names what is wrong.
    expect(DETAIL).toContain("const nextStep = opportunity.reasonCode");
    expect(DETAIL).toContain("reasonFix.");
  });

  it("resolves the message key from the ROOT, because it is already a full path", () => {
    // `messageKey` is `errors.codes.…`. Scoping the translator to
    // "errors" asked for `errors.errors.codes.…` and printed the key
    // itself on screen.
    expect(FORM).toContain("const errorText = useTranslations();");
    expect(FORM).not.toContain('useTranslations("errors")');
  });
});

describe("an offer is a DURATION, not two dates", () => {
  /**
   * The owner's rule: a supplier says «سبعة أيام»; the platform stamps
   * the window when the thing actually goes on sale, and a buyer reads
   * what is left of it.
   */
  const FORM = read("components/supplier/listing-form.tsx");
  const RULES = read("lib/listing-form.ts");
  const SERVICE = read("../../apps/api/src/listings/listings.service.ts");
  const DTO = read("../../apps/api/src/listings/dto/create-listing.dto.ts");

  it("asks for days, and for no date at all", () => {
    expect(FORM).toContain('textField("offerDurationDays"');
    expect(FORM).not.toContain('"startAt"');
    expect(FORM).not.toContain('"endAt"');
    expect(FORM).not.toContain("datetime-local");

    // The approved reference shortens the unit to a parenthesis —
    // «مدة العرض (يوم)» — which is the same question in half a label.
    expect(AR.supplier.listings.form.fields.offerDurationDays).toBe(
      "مدة العرض (يوم)",
    );
    expect(AR.supplier.listings.form.fields.expectedPreparationDays).toBe(
      "مدة التجهيز (يوم)",
    );
    expect(AR.supplier.listings.form.fields.startAt).toBeUndefined();
  });

  it("takes days on the wire too, not a pair of instants", () => {
    expect(DTO).toContain("offerDurationDays!: number;");
    expect(DTO).not.toContain("IsDateString");
  });

  it("STAMPS the window on the publication that SUCCEEDED", () => {
    // An offer drafted three weeks ago, or one whose publication was
    // refused twice before, must run its full period from the moment it
    // actually became buyable — not from when the form was filled in,
    // and not from an attempt that failed.
    //
    // THE STAMP MOVED, and that is what this now guards. It used to sit
    // in the listings path, BEFORE the publish call, so a refused
    // publication had already started the clock — and the direct route
    // never re-anchored at all. It is now inside the one transaction
    // every publication goes through.
    const publish = read(
      "../../apps/api/src/opportunities/opportunities.service.ts",
    );

    expect(publish).toContain("windowFromNow");
    expect(publish).toContain("daysBetween");
    expect(publish).toContain("THE WINDOW IS STAMPED HERE");

    // The provisional pair is still written at creation — its LENGTH is
    // the answer the supplier gave — but nothing re-anchors it there.
    expect(SERVICE).toContain("windowFromNow");
    expect(SERVICE).toContain("THE WINDOW IS NO LONGER STAMPED HERE");
  });

  it("refuses a second live offer on one product, in the SERVER", () => {
    // The owner's rule: «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء
    // العرض الأول». Hiding the button is a courtesy; this is the rule.
    const publish = read(
      "../../apps/api/src/opportunities/opportunities.service.ts",
    );

    expect(publish).toContain("PRODUCT_ALREADY_HAS_LIVE_OFFER");
    // A lock on the product row, taken before the look — two drafts
    // published in the same instant would otherwise both read "none
    // live" and both write one.
    expect(publish).toContain("FOR UPDATE");
    expect(publish.indexOf("FOR UPDATE")).toBeLessThan(
      publish.indexOf("PRODUCT_ALREADY_HAS_LIVE_OFFER"),
    );

    // ONE LIST, READ BY BOTH SIDES. The portal hides its button on the
    // same four statuses the server refuses on.
    expect(publish).toContain("SUPPLIER_OPPORTUNITY_LIVE_STATUSES");
    expect(read("lib/opportunity-actions.ts")).toContain(
      "SUPPLIER_OPPORTUNITY_LIVE_STATUSES",
    );
  });

  it("keeps SAVING open while publishing is shut", () => {
    // «إنشاء العرض كمسودة مسموح في أي وقت؛ الممنوع هو النشر ما دام على
    // المنتج عرض حيّ». A form that closed on a running offer would make
    // the supplier come back and type it again the day it ends.
    expect(FORM).toContain('t("submitDraft")');
    expect(FORM).toContain("run(false)");
    // The publish button is the one that goes dark, never the draft.
    expect(FORM).toContain("(!isProduct && liveOfferHref !== undefined)");
    expect(AR.supplier.listings.form.submitDraft).toBe("حفظ كمسودة");
    expect(EN.supplier.listings.form.submitDraft).toBe("Save as draft");
  });

  it("still checks the duration against the platform's bounds", () => {
    expect(RULES).toContain("minDurationHours");
    expect(RULES).toContain("maxDurationDays");
  });

  it("counts down in the BROWSER, because the answer depends on the reader's clock", () => {
    const countdown = read("components/opportunities/time-remaining.tsx");

    expect(countdown).toContain('"use client"');
    expect(countdown).toContain("setInterval");
    // Nothing before mount: a server-rendered figure would be stale on
    // arrival and hydration would swap it under the reader's eyes.
    expect(countdown).toContain("if (left === undefined) return null;");
    // And ICU formats the numbers, so Arabic gets its plural agreement
    // instead of a string patched with `replace`.
    expect(countdown).toContain("useTranslations");
    expect(AR.timeRemaining.days).toContain("plural");
    expect(EN.timeRemaining.days).toContain("plural");
  });
});

describe("the form is ONE page, not three", () => {
  /**
   * What it was: six cards, twenty-one full-bleed controls stacked one
   * per row, and a section description under every heading. Most of
   * that height was a text box the width of a monitor holding four
   * digits.
   *
   * MEASURED, NOT ASSERTED HERE. The height was checked in a real
   * browser — 906px at 1440×900 against roughly two thousand before.
   * What a source test can hold is the SHAPE that produced it, so a
   * later edit cannot quietly unwind it.
   */
  const FORM = read("components/supplier/listing-form.tsx");
  /**
   * THE FIELD SHAPE, WHEREVER IT LIVES.
   *
   * `SectionTitle`, `FieldRow`, the parcel mark and the span
   * constants were lifted into `components/forms/listing-parts` when
   * the console's product page began drawing the SAME cards —
   * «استخدم بطاقة إضافة المنتج في صفحة المورد نفس ترتيبها بالضبط».
   * The rules below are about the shape, not about which file holds
   * it, so they are asserted over the form AND the parts it imports.
   * A copy of those parts would be exactly what this guards against.
   */
  const SHAPE = FORM + "\n" + read("components/forms/listing-parts.tsx");
  const FLAT_FORM = FORM.replace(/\s+/g, " ");
  const PAGE = read("app/[locale]/supplier/products/new/page.tsx");

  it("names each card for what is IN it, never for the field below it", () => {
    // «المنتج» over «اسم المنتج بالعربية» said the word twice, and four
    // such headings cost four rows to repeat what every label already
    // carried. THE APPROVED REFERENCE BRINGS THREE TITLES BACK — and
    // they are a different thing: each names a CARD holding six or
    // seven answers, and none of them is any field's label.
    // FIVE TITLES FOR TWO SCOPES, and no card sees the other's. The
    // product's three name what a thing IS, what it is sold AS, and what
    // it takes to MOVE it; the offer's two name the terms of this sale
    // and how long it runs. «الشحن والتجهيز» became «الوزن والأبعاد»
    // when the preparation days left it for the offer — a card titled
    // for a field it no longer holds is a heading that lies.
    // SEVEN FOR THREE SCOPES NOW. The direct sale is the same form as
    // an offer with the clock taken out — «لا مدة انتهاء» — so its two
    // cards are named for what they hold rather than reusing the
    // offer's: «شروط البيع المباشر» and «التجهيز», where an offer says
    // «مدة العرض والتجهيز».
    const titles = AR.supplier.listings.form.sections;
    expect(titles).toEqual({
      item: "بيانات المنتج",
      selling: "وحدة البيع ومحتوى العبوة",
      shipping: "الوزن والأبعاد",
      offerTerms: "شروط البيع",
      offerTiming: "مدة العرض والتجهيز",
      directTerms: "شروط البيع المباشر",
      directTiming: "التجهيز",
    });

    const labels: string[] = Object.values(AR.supplier.listings.form.fields);
    for (const title of Object.values(titles) as string[]) {
      expect([title, labels.includes(title)]).toEqual([title, false]);
    }

    // The old identity heading stays gone, and no landmark is left
    // without a name: an unnamed `<section>` is worse than none, and a
    // hidden heading would put the repetition back for a screen-reader
    // user alone. Each card passes its own title as the label.
    expect(FORM).not.toContain("sections.identity");
    expect(FORM).not.toContain("aria-labelledby={id}");
    expect(FORM).toContain('ariaLabel={t("sections.item")}');
    expect(FORM).toContain('ariaLabel={t("sections.selling")}');
    expect(FORM).toContain('ariaLabel={t("sections.shipping")}');
    // THE TWO SALE CARDS TAKE THEIR TITLE FROM THE SCOPE, because one
    // card serves both modes and the words differ.
    expect(FORM).toContain(
      `ariaLabel={t(isDirect ? "sections.directTerms" : "sections.offerTerms")}`
    );
    expect(FORM).toContain(
      `ariaLabel={t(isDirect ? "sections.directTiming" : "sections.offerTiming")}`
    );
  });

  it("wears the outlined skin, and takes it from the SYSTEM", () => {
    // «واجعل الحقول بيضاء بحد خفيف دون الظل الداخلي». The filled well
    // is still the platform's default; this page opts into a NAMED
    // third skin, declared once in the field component. A page writing
    // its own `border-…` on a control is what the guards refuse, and
    // it is how a system stops being one.
    const field = read("components/ui/field.tsx");
    const select = read("components/ui/select.tsx");

    expect(field).toContain("export const OUTLINED_CLASSES");
    expect(field).toContain("border border-line-control");
    expect(select).toContain("export const SELECT_OUTLINED_CLASSES");

    // No elevation at all — the line is the whole of the shape.
    const outlined = field.slice(
      field.indexOf("export const OUTLINED_CLASSES"),
      field.indexOf("export type FieldAppearance"),
    );
    expect(outlined).toContain("bg-surface");
    expect(outlined).toContain("shadow-none");
    expect(outlined).not.toMatch(/shadow-(inset|soft|raised|card)\b/);

    // And every control on the page asks for it by name.
    expect(FORM).toContain('appearance="outlined"');
    expect(FORM).not.toMatch(
      /<(Input|Select|Textarea)[^>]*className="[^"]*border-/s,
    );
  });

  it("types an English answer left to right, and an Arabic one right to left", () => {
    // «اضبط الكتابة داخل الحقول الإنجليزية من اليسار لليمين». The
    // LABEL follows the page; the ANSWER follows its own language, or
    // the caret, the punctuation and a half-typed word all fight the
    // box they are in. Both halves, because half a bidi fix is a bug
    // on the other locale.
    for (const field of [
      "nameEn",
      "descriptionEn",
      "salesUnitNameEn",
      "packageContentUnitNameEn",
    ]) {
      expect([
        field,
        FLAT_FORM.includes(`textField("${field}", { dir: "ltr",`),
      ]).toEqual([field, true]);
    }
    for (const field of [
      "nameAr",
      "descriptionAr",
      "salesUnitNameAr",
      "packageContentUnitNameAr",
    ]) {
      expect([
        field,
        FLAT_FORM.includes(`textField("${field}", { dir: "rtl",`),
      ]).toEqual([field, true]);
    }

    // AND THE EXAMPLE INSIDE THE BOX MATCHES THE BOX'S DIRECTION. A
    // Latin run opening a right-to-left line puts its own full stop in
    // front of it — «e.g. كرتون» rendered as «.e.g كرتون».
    for (const catalogue of [AR, EN]) {
      const hints = catalogue.supplier.listings.form.placeholders;
      for (const key of [
        "nameAr",
        "descriptionAr",
        "salesUnitNameAr",
        "packageContentUnitNameAr",
      ]) {
        expect([key, /[A-Za-z]/.test(hints[key])]).toEqual([key, false]);
      }
      for (const key of [
        "nameEn",
        "descriptionEn",
        "salesUnitNameEn",
        "packageContentUnitNameEn",
      ]) {
        expect([key, /[؀-ۿ]/.test(hints[key])]).toEqual([key, false]);
      }
    }
  });

  it("puts the two buttons on the reading side of the bar", () => {
    // «اجعل شريط الأزرار مضغوطًا: إضافة المنتج وإلغاء يمينًا، وملاحظة
    // الحقول المطلوبة يسارًا» — the opposite of the reference drawing,
    // and the later of the two instructions. In the DOM that is the
    // buttons FIRST, which is also the order a keyboard reaches them.
    const bar = FORM.slice(FORM.lastIndexOf("<Card>"));
    expect(bar.indexOf('type="submit"')).toBeLessThan(
      bar.indexOf("requiredNote"),
    );
    expect(bar).not.toContain("flex-row-reverse");
    // Compact: the ordinary card measure, not the roomier one.
    expect(bar).not.toContain("<Card sectioned>");
  });

  it("lays the cards out as the approved reference draws them", () => {
    // THE REFERENCE IS THREE CARDS AND A BAR: what the product is,
    // what it is sold as beside what it takes to ship, then the two
    // buttons. It was six cards, then one; this is neither guess — it
    // is the drawing the owner approved.
    //
    // SIX IN THE FILE, NEVER SIX ON A SCREEN. The product scope draws
    // three and the offer scope two, and the two sets are the branches
    // of one conditional — whichever is on screen shares the same
    // action bar, so a reader sees four cards or three.
    //
    // `FormSection` is still refused: it renders a card per SECTION,
    // which is how six of them happened.
    expect(FORM).not.toContain("FormSection");
    expect(FORM.match(/<Card\b/g) ?? []).toHaveLength(6);

    // The selling card and the shipping card share one row, seven
    // columns to five, and stack below `lg`.
    expect(FORM).toContain('className="col-span-12 lg:col-span-7"');
    expect(FORM).toContain('className="col-span-12 lg:col-span-5"');
  });

  it("stands the label BESIDE its control, not above it", () => {
    // The owner's instruction: «استبدل مكان التسمية من فوق الحقل إلى
    // جانب الحقل تكون موازية له». A stacked label costs a row of the
    // page per field, and a card asking seven questions spends seven.
    //
    // ONE ROW COMPONENT, at module scope, so every control in the form
    // — the text fields, the two category lists, the branch and the
    // price — is laid out by the same rule and none of them can drift
    // back to a label of its own on a line of its own.
    expect(SHAPE).toContain("function FieldRow(");
    expect(SHAPE).toContain('labelWidth = "sm:w-28"');
    expect(SHAPE).toContain("flex flex-wrap items-center gap-x-control-gap");

    // Nothing stacks a label over a control by hand any more.
    expect(FORM).not.toMatch(
      /<div className=\{cn\("flex flex-col gap-1", options\.span\)\}/,
    );
    expect(FORM).not.toMatch(/<div className="flex flex-col gap-1">\s*<Label/);

    // AND THE ERROR KEEPS THE CONTROL'S COLUMN. Under the label it
    // would point at the name rather than at the answer.
    expect(SHAPE.replace(/\s+/g, " ")).toContain(
      '<span aria-hidden="true" className={cn("hidden sm:block sm:shrink-0", labelWidth)} />',
    );

    // IT STACKS ON A PHONE, and that is not a contradiction: a cell
    // already half the screen wide has no room for two columns, and a
    // label squeezed to four characters is worse than one above the
    // box. The label is full width until `sm`.
    expect(SHAPE).toContain('cn("w-full sm:shrink-0", labelWidth)');
  });

  it("never lets a name crush the box it names", () => {
    // WHAT THE OWNER REPORTED: four fields across a card five columns
    // wide, each cell about a hundred pixels — the fixed label took all
    // of it and the input collapsed to a sliver.
    //
    // TWO CURES, and both are needed. The card now lays those fields
    // out TWO across instead of four, which is what makes the reported
    // card right; and every control declares the narrowest it may
    // become, with the row free to wrap, so a cell that genuinely
    // cannot hold both puts the label back on its own line rather than
    // squeezing the answer to nothing.
    expect(SHAPE).toContain("min-w-[9rem] flex-1");
    expect(SHAPE).toContain('const HALF12 = "col-span-12 sm:col-span-6"');
    expect(SHAPE).not.toContain("QUARTER12");

    // And the short names take a narrower column, because spending
    // «وحدة المحتوى بالعربية»'s room on «الوزن (كجم)» is what left the
    // box with nothing.
    expect(SHAPE).toContain('const SHORT_LABEL = "sm:w-24"');
  });

  it("gives every control the width its CONTENT needs", () => {
    // A span per field, so a price is half a row and a package unit a
    // third — and every base span is the full width of its grid, so a
    // phone gets one field per row and never scrolls sideways.
    expect(FORM).toContain("grid grid-cols-12");
    expect(FORM).toContain("grid grid-cols-6");
    expect(SHAPE).toContain("col-span-6 sm:col-span-3");
    expect(SHAPE).toContain("col-span-6 sm:col-span-2");
    expect(SHAPE).toContain("col-span-12 sm:col-span-6");

    // Nothing lays a control out full-bleed by hand any more.
    expect(FORM).not.toMatch(/<Input[^>]*className="w-full/);
  });

  it("asks for package content OUTRIGHT, with no disclosure to open", () => {
    // It was optional and folded behind a `<details>`. The owner made
    // it required, so the summary row the disclosure cost is returned
    // and the three controls join the rest — a group that is always
    // answered has nothing to disclose.
    expect(FORM).not.toContain("<details");
    expect(FORM).not.toContain("hasPackageContent");

    const rules = read("lib/listing-form.ts");
    // Required: the rule passes `true` for mandatory, and the three
    // names are asked for the same way the quantity is.
    expect(rules).toContain(
      "PRODUCT_DECIMAL_FIELDS.packageContentQuantity,\n        true",
    );
    expect(rules).toContain(
      "PRODUCT_TEXT_LIMITS.packageContentUnitNameAr, true",
    );
    expect(rules).toContain(
      "PRODUCT_TEXT_LIMITS.packageContentUnitNameEn, true",
    );
    // And the "all three or none" rule is gone with the "none".
    expect(rules).not.toContain("ALL THREE PACKAGE FIELDS, OR NONE");
  });

  it("draws NO bar of its own — the strip above carries the way back", () => {
    // THIS HAS BEEN BOTH WAYS ROUND. The title and the way back were
    // given a dark bar of their own, and then the owner gave every tab
    // a strip of its own and had the bars deleted: «احذف الشريط اللي
    // حطيته أنت سابقًا». Two rows of chrome above one form is what that
    // removed.
    const offerPage = read(
      "app/[locale]/supplier/products/[id]/offers/new/page.tsx",
    );

    for (const page of [PAGE, offerPage]) {
      expect(page).not.toContain("bg-primary");
      expect(page).not.toContain("text-primary-foreground");
      // The title is the plain line it always was.
      expect(page).toContain(
        '<h1 className="text-lg font-semibold text-content">',
      );
      // And nothing on the page links back any more — the strip does.
      expect(page).not.toContain("ArrowLeft");
    }

    // THE WAY BACK IS DECLARED ONCE, beside the nav map, for both.
    const links = read("components/supplier/supplier-bar-actions.ts");
    expect(links).toContain('rest === "/products/new"');
    expect(links).toContain("const offerForm =");
    expect(links).toContain("labels.backToProducts");
    expect(links).toContain("labels.backToProduct");
  });

  it("writes no section descriptions, which the owner banned platform-wide", () => {
    // «ألغِ الشرح أسفل عناوين الصفحات والأقسام والخيارات في كامل
    // المنصه، مع إبقاء رسائل الأخطاء الضرورية».
    expect(AR.supplier.listings.form.sectionHints).toBeUndefined();
    expect(EN.supplier.listings.form.sectionHints).toBeUndefined();
  });

  it("writes NO instruction under any field", () => {
    // The owner's rule, platform-wide: «التعليمات اللي موجوده دائما تحت
    // الحقول لا احتاجها». A label names the field; a paragraph under it
    // explaining how to fill it is a second sentence doing the first
    // one's job.
    //
    // ERROR MESSAGES ARE NOT INSTRUCTIONS and stay — the same
    // distinction the owner drew the first time.
    expect(FORM).not.toContain("hints.");
    expect(AR.supplier.listings.form.hints).toBeUndefined();
    expect(EN.supplier.listings.form.hints).toBeUndefined();
    expect(FORM).toContain("<FieldError");
  });

  it("still CHECKS the bounds it stopped printing", () => {
    // Removing the sentence that stated the limits made the check the
    // only thing left to tell a supplier — and it was never being run:
    // `limits` reached the component and not the validator.
    expect(FORM).toContain(
      "validateListingForm(values, {\n      scope,\n      limits,",
    );
    // And the bounds are the OFFER'S — a duration and a target quantity
    // — so they are checked in that scope and nowhere else.
    const rules = read("lib/listing-form.ts");
    expect(rules.indexOf("minDurationHours")).toBeGreaterThan(
      rules.indexOf("the offer"),
    );
  });

  it("puts the way back on the OPEN TAB'S OWN STRIP", () => {
    // «اجعل الشريط كأنه امتداد للسان» — one row per page, in the same
    // place on every one of them, wearing the open tab's own colour so
    // the two read as a single shape.
    const bar = read("components/portal/portal-page-bar.tsx");

    // THE STRIP IS A LINE NOW, NOT A FILL — «نلغي لون اللسان والشريط
    // البرتقالي ونكتفي بخط برتقالي على اللسان والشريط من أعلى
    // والجوانب». What joins it to the open tab is the accent it is
    // RULED in, along the top and the far side, on the sheet's own
    // white.
    // THE ACCENT RULE IS NOT ON THIS STRIP ANY MORE — it moved to the
    // tab row, which is the only thing that knows where the tabs end.
    // «إذا ضغطت على الرئيسية، من بداية اللسان إلى نهاية اللسان الخامل»:
    // the rule is the width of the TAB ROW, and written here it was the
    // width of the SHEET, running on past the last tab to the far edge
    // of the page.
    expect(bar).not.toContain("border-t");
    // AND NOTHING AT THE FOOT OR ON THE SIDES either — «وألغِ الخط
    // الداكن السفلي», and the all-round hairline before it drew a box.
    expect(bar).not.toContain("border-b");
    expect(bar).not.toContain("border-s");
    expect(bar).not.toContain("border-e");
    expect(bar).not.toContain("border-x");
    // IT IS THE OPEN TAB'S OWN AMBER, and it FLOATS — «وحّد لون
    // اللسان مع الشريط باللون البرتقالي للنشط… خلّ اللسان مع الشريط
    // بالتصميم العائم، والشريط خلّه منحني من الزوايا».
    //
    // It was the sheet's white with a five-pixel accent rule between
    // the two, which is a JOIN drawn between two surfaces. One surface
    // needs no join.
    // AND IT IS A RUN, NOT A FLAT FILL — «عندما يصل للشريط يبدأ
    // اللون بالتدرّج إلى أسفل الشريط». It STARTS at the open tab's own
    // navy, which is what makes the seam disappear: the strip does not
    // sit beside the tab's colour, it continues it. The floor is the
    // same navy lifted to 80%, measured so white keeps AAA at the
    // palest end of the run — a gradient is only as legible as that.
    // AND THE RUN IS GONE WITH THE SURFACE. «بنلغي الشريط من جميع
    //  الصفحات… وأي معلومات في الأشرطة تبقى في الصفحة بنفس خلفية
    //  الصفحة، مع تغيير لون الكتابة للبرتقالي.» The run began at the
    // open folder tab's own fill so the two would read as one piece
    // of paper; there is no tab and no bar left for it to join.
    expect(bar).not.toContain("bg-[image:var(--chrome-run-strip)]");
    expect(bar).toContain("text-accent-interactive");
    expect(bar).not.toMatch(/bg-primary/);
    // NO SURFACE AT ALL, so nothing that dressed one is left: no card
    // corner, no lift, no fill. What parts this line from the page is
    // that it is the only orange on it.
    expect(bar).not.toContain("shadow-card");
    expect(bar).not.toContain("rounded-t-card");
    expect(bar).not.toContain("bg-surface");
    expect(bar).not.toContain("rounded-se-2xl");
    // AND NO WHITE INK. White needed a dark ground; the ground is the
    // page's own now, where white is invisible and the identity's
    // orange measures 4.8:1.
    expect(bar).not.toContain("text-primary-foreground");
    expect(bar).not.toContain("text-secondary");
    // NOTHING ON THE SIDES.
    expect(bar).not.toContain("border-s");
    expect(bar).not.toContain("border-e");
    expect(bar).not.toContain("border-x");
    // AND ITS INK IS THE IDENTITY'S ORANGE, now that the ground under
    // it is the page's own — «مع تغيير لون الكتابة للبرتقالي بنفس
    //  درجة لون الشريط النحيف».
    expect(bar).toContain("text-accent-interactive");
    expect(bar).toContain("links.back");
    // THE FLOOR IS THE CONTROL'S, NOT THE RAIL'S. This used to read
    // `min-h-nav`, which the strip has not carried since «قلّل ارتفاع
    // الشريط بتخفيف الحشو» — it passed on the COMMENT that explains why
    // the rail floor came off, which is a guard asserting its own
    // documentation.
    // AND ITS FLOOR IS THE CONTROL'S BARE HEIGHT, with no air of its
    // own on top — «ألغِ أي أزرار داخل مربع… عشان أقلّل ارتفاع الشريط».
    // Nothing in it is boxed any more, so there is no box padding to
    // sit around: the strip rests exactly on the 32px its controls
    // stand at, and the two accent rules close it. Fifty became
    // forty-two.
    expect(bar).toContain("min-h-control");
    expect(bar.replace(/\/\/.*$/gm, "")).not.toContain("py-1");
    // AND FORTY-FOUR IS NOT THE FLOOR ANY MORE. It was, while this
    // matched the console's sections BAR; there is no bar left to
    // match.
    expect(bar).not.toContain("min-h-nav");

    // AND WHAT A PAGE HANDS UP SITS AT THE FAR END — «عدّلهم وحطهم
    // يسار». In Arabic the row runs right to left, so the far end is
    // the left: a page's own controls sit opposite the way back rather
    // than crowding it.
    expect(bar.indexOf("PORTAL_STRIP_SLOT}")).toBeGreaterThan(
      bar.indexOf("links.back"),
    );

    // AND THE PIXEL OF OVERLAP IS GONE WITH THE COLOUR. Two boxes
    // that merely touch show the parent through as a hairline
    // wherever their shared edge lands on a half pixel — which
    // mattered while one was navy above a navy ground. Both are the
    // page's own ground now, so there is nothing to show through.
    expect(bar).not.toContain("-mt-px");
  });

  it("carries NOTHING that was not moved into it", () => {
    // A date and a search box were tried in the strip and struck off —
    // «احذف التاريخ وأي شيء أنت أضفته للشريط». What is left is what the
    // deleted dark bars used to hold: a page's one action, and the way
    // back out of a form.
    const bar = read("components/portal/portal-page-bar.tsx");

    expect(bar).not.toContain("CalendarDays");
    expect(bar).not.toContain('role="search"');
    expect(bar).not.toContain("useSearchParams");
    expect(bar).not.toContain("<Input");

    // AND THE TERM CAME BACK, BUT NOT HERE. «حقل بحث بجانب أيقونة
    // الإشعارات» — the chrome's one search field is on the ROW OF
    // TABS, not in this strip, which is where the struck-off one used
    // to be.
    //
    // THIS USED TO ASSERT that the products page read no `searchParams`
    // at all, and that was right while its list came back whole: a
    // search box over a list nobody paged is a filter, and the browser
    // could do it.
    //
    // The catalogue is PAGED now — it grows with the supplier's
    // business and the five-hundred ceiling it had was answering
    // wrongly — so it reads a page number and a term of its own and
    // sends both to the API. What is still true, and is what this
    // guards, is that the strip above holds neither.
    expect(bar).not.toContain("searchParams");
    const catalogue = read("app/[locale]/supplier/products/page.tsx");
    expect(catalogue).toContain("searchParams");
    expect(catalogue).toContain("CatalogueSearch");
    // The field is rendered by the row from plain strings now, not
    // handed down as a node — see the search tests for why.
    expect(read("components/portal/folder-tab-nav.tsx")).toContain(
      "{searchLabels ? (",
    );
  });
});
