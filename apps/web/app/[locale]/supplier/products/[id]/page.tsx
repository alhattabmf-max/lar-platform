import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  loadPolicyLimits,
  loadSupplierOpportunities,
  loadSupplierProduct,
} from "@/lib/supplier-data";
import { productActions, productNextStepKey } from "@/lib/product-actions";
import { loadTaxonomy } from "@/lib/marketplace-data";
import { localized, formatDate } from "@/lib/localized";
import { Gift, Tags, Truck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import {
  FieldRow,
  HALF12,
  HALF6,
  ParcelMark,
  ReadName,
  ReadValue,
  SHORT_LABEL,
  SectionTitle,
  THIRD6,
} from "@/components/forms/listing-parts";
import { StatusBadge } from "@/components/trader/status-badge";
import { Card, CardBody } from "@/components/ui/card";
import { Fact, FactList } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { ProductActions } from "@/components/supplier/product-actions";
import { ProductMediaManager } from "@/components/supplier/product-media-manager";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.products");

/**
 * One product, with its images and the actions the API will accept.
 *
 * An unknown id and another company's product both answer 404 from the API —
 * deliberately, so probing reveals nothing — and this renders Next's own 404
 * for either, which preserves that. An error state instead would imply the
 * record exists and is broken.
 *
 * Every action is gated by `productActions()`, transcribed from the service's
 * own guards. A button the API would refuse is never drawn; when the gate and
 * the server disagree, the server wins and shows its refusal.
 *
 * AND THIS IS WHERE IT IS OFFERED. A product is a record the supplier
 * keeps; an offer is an event on it, repeated as often as the goods are
 * sold again. So the offers made on this product are listed here, and
 * the button that makes another is here too — not in a list of offers
 * that would have to open by asking which product it was for.
 */
export default async function ProductDetailsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({
    locale: appLocale,
    namespace: "supplier.products",
  });
  const status = await getTranslations({
    locale: appLocale,
    namespace: "supplier.status",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });
  // THE CARD'S OWN WORDS, read from the form that draws it rather
  // than restated under `supplier.products`: «الوزن (كجم)» must mean
  // the same thing on the add screen and on this one, and two
  // catalogues are two places for it to stop meaning it.
  const sectionText = await getTranslations({
    locale: appLocale,
    namespace: "supplier.listings.form",
  });
  // Fetched together: the policy read does not depend on the product,
  // and doing them in sequence is two round trips for no benefit.
  const [result, policyLimits, offers, taxonomy] = await Promise.all([
    loadSupplierProduct(id),
    loadPolicyLimits(),
    // THE OFFERS MADE ON THIS PRODUCT. The endpoint returns the
    // company's whole list — there is no per-product route — so the
    // filtering happens here rather than in a request that does not
    // exist.
    loadSupplierOpportunities(),
    // THE CATEGORY ROW READS FROM THE TREE. The product carries the
    // id it was filed under and nothing else — the names, and which
    // of them is the main category and which the branch, are the
    // taxonomy's to say. A failed read costs the two names and
    // nothing else on the page.
    loadTaxonomy(),
  ]);

  if (!result.ok && result.notFound) notFound();

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb
          locale={appLocale}
          label={t("breadcrumbLabel")}
          back={t("backToProducts")}
        />
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const product = result.data;
  const gate = productActions(product);

  // THE MAIN CATEGORY AND THE BRANCH, from the id the product
  // carries. A product filed directly on a main category has no
  // branch, and the row says so with a dash rather than repeating
  // the category — the add card draws the same two rows, and one of
  // them is legitimately empty there too.
  const filedUnder = ((): { root: string | null; branch: string | null } => {
    if (!taxonomy.ok) return { root: null, branch: null };
    const byId = new Map(taxonomy.data.map((node) => [node.id, node]));
    const node = byId.get(product.taxonomyNodeId);
    if (!node) return { root: null, branch: null };

    const path = [node];
    let walker = node;
    while (walker.parentId) {
      const parent = byId.get(walker.parentId);
      if (!parent) break;
      path.unshift(parent);
      walker = parent;
    }

    const name = (index: number) =>
      path[index]
        ? localized(appLocale, path[index].nameAr, path[index].nameEn)
        : null;

    // Deeper than two levels — the taxonomy allows three — and the
    // branch row shows the one the product actually sits on, not the
    // middle of the path: that is where it is filed.
    return {
      root: name(0),
      branch: path.length > 1 ? name(path.length - 1) : null,
    };
  })();
  const name = localized(appLocale, product.nameAr, product.nameEn);
  const archived = product.archivedAt !== null;
  const created = formatDate(product.createdAt, appLocale);

  // ONLY THIS PRODUCT'S OFFERS. A failed read is not an error page: the
  // product itself loaded, and an empty section here says "none
  // listed" rather than claiming there are none.
  const productOffers = offers.ok
    ? offers.data.filter((offer) => offer.productId === product.id)
    : [];
  // A closed or archived product cannot be sold at all. A running offer
  // is a different matter: it stops the next one being PUBLISHED, not
  // written — so the button still opens the form, which says so at its
  // head and offers to save a draft.
  const canOffer = !archived && product.approvalStatus !== "CLOSED";

  // `gap-3`, NOT `gap-6` — «قلّل الحشو بين البطاقة واسم المنتج، وبين
  // بطاقة البيانات والبطاقتين اللي تحتها». Six units separate sections
  // that have nothing to do with each other; these four are one
  // product read top to bottom.
  return (
    <div className="flex flex-col gap-3">
      {/* ONE ROW, AND THE WAY BACK IS AT THE END OF IT — «حط تاريخ
          الإنشاء موازيًا لاسم المنتج، وزر العودة في الجهة المقابلة في
          نفس الصف».

          IT WAS THREE ROWS: a breadcrumb link, the name, and the
          date beneath it — three lines of page before the product
          began, two of which held one short fact each.

          THE LINK BECAME A BUTTON because that is what it is at the
          end of a row: a breadcrumb is a trail you read, and there
          was never more than one step in it to read.

          `items-baseline` SO THE SMALL TEXT SITS ON THE NAME'S OWN
          LINE rather than on the middle of it — and the button is
          `self-center`, because a control centres on the row it is
          in and does not share a typographic baseline with a
          heading. */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold text-content">{name}</h1>

          {/* THE DATE AND THE STATE, ON ONE LINE — «والحالة اللي
            موجودة في البيانات خلها صف واحد موازي لتاريخ الإنشاء».

            THE STATE HAD A BLOCK OF ITS OWN at the head of the first
            card, three lines tall, for a badge and a sentence. It is
            one fact about this product, the same size as the day it
            was added, and the two read together: added then, and
            this is where it stands now.

            WHAT COMES AFTER IT STAYS. A status with no next step
            leaves somebody reading a word and guessing — so the
            sentence that says what to do about it rides on the same
            line rather than being dropped with the block. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-content-muted">
            {created ? (
              <span>
                {t("createdAt")}:{" "}
                <time dateTime={product.createdAt}>{created}</time>
              </span>
            ) : null}
            {created ? <span aria-hidden className="h-3 w-px bg-line" /> : null}
            <StatusBadge
              label={
                archived
                  ? status("productArchived")
                  : status(`product.${product.approvalStatus}`)
              }
              tone={
                archived
                  ? "neutral"
                  : product.approvalStatus === "APPROVED"
                    ? "done"
                    : gate.canSubmit || product.approvalStatus === "SUSPENDED"
                      ? "attention"
                      : "neutral"
              }
            />
            <span>{t(`nextStep.${productNextStepKey(product)}`)}</span>
          </p>
        </div>

        <ButtonLink
          href={`/${appLocale}/supplier/products`}
          variant="ghost"
          className="self-center"
        >
          {t("backToProducts")}
        </ButtonLink>
      </header>

      {/* ==================================== بطاقة المنتج، كما تُضاف
          «اجعل عرض تفاصيل المنتج نفس بطاقة إضافة منتج بالضبط، وإذا
           فيه أزرار إضافية أضفها.»

          THE SAME THREE CARDS THE ADD FORM DRAWS, in the same order,
          the same grid and the same proportions — what the product IS
          with its picture beside the names, then how it is sold, then
          what it takes to move it. Built from the same parts
          (`SectionTitle`, `FieldRow`, the parcel mark, the span
          constants) rather than from a copy of them, which is the only
          way «بالضبط» survives the next change to either screen.

          WHAT STOOD HERE WAS TWO DIFFERENT SHAPES. A status card at
          the top and a «المواصفات» fact list at the bottom, with the
          names, the category and the descriptions nowhere at all — a
          supplier could not read back what he had entered without
          opening the edit form.

          READ, NOT TYPED. `ReadValue` wears the same box as the
          field it stands in for, so the columns line up, but it is a
          value and not a disabled control. The pencil is one press
          away in the row of buttons below.

          THE PICTURES ARE IN THE COLUMN THE ADD CARD DRAWS THEM IN
          — «شيل الصورة من هنا وخلها في الجدول، نفس بطاقة إضافة
          المنتج».

          THEY WERE IN TWO PLACES AND ARE NOW IN ONE. A read-only
          thumbnail sat in this column and the panel that actually
          manages the images sat at the foot of the page, which was
          the same photograph twice and the controls nowhere near
          it. What moved here is the PANEL — the whole of it, so
          adding, reordering, choosing the main image and removing
          one all happen in the place the add form asks for a file.

          NARROW, SO THEY STACK. The panel lays its images out in up
          to three columns when it has the width for them; in this
          one it has room for a single column, and `column` is that
          instruction rather than a guess made with a media query
          about a container's width. */}
      <Card ariaLabel={sectionText("sections.item")}>
        <CardBody>
          <div className="grid grid-cols-12 gap-x-4 gap-y-2">
            <div className="col-span-12 flex flex-col gap-card-gap lg:col-span-9">
              <SectionTitle icon={<Tags className="size-5 text-secondary" />}>
                {sectionText("sections.item")}
              </SectionTitle>

              {/* THE REVIEWER'S OWN WORDS, kept where the state is
                  read. Withholding them leaves somebody told they
                  failed without being told why. */}
              {product.rejectionReason ? (
                <FactList>
                  <Fact
                    label={t("rejectionReason")}
                    value={product.rejectionReason}
                  />
                </FactList>
              ) : null}

              {/* THE ROWS KEEP THEIR OWN HEIGHT — `content-start`.

                A GRID'S DEFAULT `align-content` IS `stretch`, and
                this one is as tall as the picture column beside it,
                which holds a photograph, its two buttons, an upload
                control and a line of limits. All that spare height
                was handed to the three rows of fields, which is why
                the card read as a page of gaps: the padding was the
                picture column's height divided by three.

                START THEM AT THE TOP and the spare height stays at
                the bottom of the column, where it belongs, and the
                fields sit at `gap-y-2` from each other exactly as
                the add card draws them. */}
              <div className="grid grid-cols-1 content-start gap-x-4 gap-y-2 sm:grid-cols-2">
                <FieldRow
                  label={<ReadName>{sectionText("fields.nameAr")}</ReadName>}
                  control={<ReadValue dir="rtl">{product.nameAr}</ReadValue>}
                />
                <FieldRow
                  label={<ReadName>{sectionText("fields.nameEn")}</ReadName>}
                  control={<ReadValue dir="ltr">{product.nameEn}</ReadValue>}
                />
                <FieldRow
                  label={<ReadName>{sectionText("fields.category")}</ReadName>}
                  control={<ReadValue>{filedUnder.root}</ReadValue>}
                />
                <FieldRow
                  label={
                    <ReadName>{sectionText("fields.taxonomyNodeId")}</ReadName>
                  }
                  control={<ReadValue>{filedUnder.branch}</ReadValue>}
                />
                <FieldRow
                  label={
                    <ReadName>{sectionText("fields.descriptionAr")}</ReadName>
                  }
                  control={
                    <ReadValue dir="rtl" multiline>
                      {product.descriptionAr}
                    </ReadValue>
                  }
                />
                <FieldRow
                  label={
                    <ReadName>{sectionText("fields.descriptionEn")}</ReadName>
                  }
                  control={
                    <ReadValue dir="ltr" multiline>
                      {product.descriptionEn}
                    </ReadValue>
                  }
                />
              </div>
            </div>

            {/* THE PICTURE'S OWN COLUMN, with the rule the reference
                draws between it and the names — and only from `lg`,
                because a phone stacks the two and a line across a
                stack separates nothing.

                IT IS A SIBLING OF THE WHOLE LEFT COLUMN, title and
                all, so it begins at the card's own padding and not
                a heading's height below it. */}
            <div className="col-span-12 lg:col-span-3 lg:border-s lg:border-line lg:ps-4">
              <ProductMediaManager
                productId={product.id}
                media={product.media}
                // Undefined when the policy read failed — the component then
                // shows a hint with no figures rather than invented ones.
                limits={policyLimits.ok ? policyLimits.data.media : undefined}
                canEdit={gate.canEditMedia}
                productName={name}
                column
                labels={{
                  heading: t("media.heading"),
                  empty: t("media.empty"),
                  // `.raw` because these two are TEMPLATES the client fills per
                  // image — the index is not known until the list is mapped.
                  // Interpolating them here would need one call per image and a
                  // prop shaped like the array's order.
                  imageAlt: t.raw("media.imageAlt"),
                  mainImageAlt: t.raw("media.mainImageAlt"),
                  mainBadge: t("media.mainBadge"),
                  setMain: t("media.setMain"),
                  remove: t("media.remove"),
                  removePrompt: t("media.removePrompt"),
                  confirm: common("confirm"),
                  cancel: common("cancel"),
                  working: t("actions.working"),
                  addImage: t("media.addImage"),
                  addImageHint: t("media.addImageHint"),
                  // Interpolated HERE, where the translator lives, so the
                  // figures are formatted for the reader's locale and the
                  // Arabic catalogue holds no Latin placeholder names.
                  //
                  // Megabytes to one decimal place: a byte count is not a
                  // number anybody reads. The types are the policy's own list
                  // with the "image/" prefix dropped.
                  addImageLimits: policyLimits.ok
                    ? t("media.addImageLimits", {
                        count: policyLimits.data.media.maxImagesPerProduct,
                        megabytes: (
                          policyLimits.data.media.maxSizeBytes / 1_000_000
                        ).toFixed(1),
                        types: policyLimits.data.media.allowedTypes
                          .map((type) => type.replace(/^image\//, ""))
                          .join("، "),
                      })
                    : t("media.addImageHint"),
                  addImageFull: t("media.addImageFull"),
                  fileTooLarge: policyLimits.ok
                    ? t("media.fileTooLarge", {
                        megabytes: (
                          policyLimits.data.media.maxSizeBytes / 1_000_000
                        ).toFixed(1),
                      })
                    : t("media.addImageHint"),
                  fileTypeNotAllowed: policyLimits.ok
                    ? t("media.fileTypeNotAllowed", {
                        types: policyLimits.data.media.allowedTypes
                          .map((type) => type.replace(/^image\//, ""))
                          .join("، "),
                      })
                    : t("media.addImageHint"),
                  openFull: t("media.openFull"),
                  closeFull: t("media.closeFull"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                  moveUp: t.raw("media.moveUp"),
                  moveDown: t.raw("media.moveDown"),
                  reorderHint: t("media.reorderHint"),
                }}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ==================== وحدة البيع بجانب الشحن، كما في المرجع
          Two narrow cards on one row: what the product is sold as
          takes seven columns and what it takes to move it five, which
          is the proportion the reference draws. Below `lg` they
          stack. */}
      <div className="grid grid-cols-12 gap-card-gap">
        <Card
          className="col-span-12 lg:col-span-7"
          ariaLabel={sectionText("sections.selling")}
        >
          <CardBody>
            <SectionTitle icon={<Gift className="size-5 text-secondary" />}>
              {sectionText("sections.selling")}
            </SectionTitle>

            <div className="grid grid-cols-6 gap-x-4 gap-y-2">
              <FieldRow
                className={HALF6}
                label={
                  <ReadName>{sectionText("fields.salesUnitNameAr")}</ReadName>
                }
                control={
                  <ReadValue dir="rtl">{product.salesUnitNameAr}</ReadValue>
                }
              />
              <FieldRow
                className={HALF6}
                label={
                  <ReadName>{sectionText("fields.salesUnitNameEn")}</ReadName>
                }
                control={
                  <ReadValue dir="ltr">{product.salesUnitNameEn}</ReadValue>
                }
              />
              <FieldRow
                className={THIRD6}
                label={
                  <ReadName>
                    {sectionText("fields.packageContentQuantity")}
                  </ReadName>
                }
                control={
                  <ReadValue>{product.packageContentQuantity}</ReadValue>
                }
              />
              <FieldRow
                className={THIRD6}
                label={
                  <ReadName>
                    {sectionText("fields.packageContentUnitNameAr")}
                  </ReadName>
                }
                control={
                  <ReadValue dir="rtl">
                    {product.packageContentUnitNameAr}
                  </ReadValue>
                }
              />
              <FieldRow
                className={THIRD6}
                label={
                  <ReadName>
                    {sectionText("fields.packageContentUnitNameEn")}
                  </ReadName>
                }
                control={
                  <ReadValue dir="ltr">
                    {product.packageContentUnitNameEn}
                  </ReadValue>
                }
              />
            </div>

            <p className="text-center text-xs text-content-muted">
              {sectionText("packageExample")}
            </p>
          </CardBody>
        </Card>

        <Card
          className="col-span-12 lg:col-span-5"
          ariaLabel={sectionText("sections.shipping")}
        >
          <CardBody>
            <SectionTitle
              icon={<Truck className="size-5 text-accent" />}
              aside={
                <>
                  <p className="text-xs text-content-muted">
                    {sectionText("shippingNote")}
                  </p>
                  <ParcelMark className="h-10 w-auto shrink-0" />
                </>
              }
            >
              {sectionText("sections.shipping")}
            </SectionTitle>

            <div className="grid grid-cols-12 gap-x-4 gap-y-2">
              <FieldRow
                className={HALF12}
                labelWidth={SHORT_LABEL}
                label={
                  <ReadName>{sectionText("fields.weightPerUnit")}</ReadName>
                }
                control={<ReadValue>{product.weightPerUnit}</ReadValue>}
              />
              <FieldRow
                className={HALF12}
                labelWidth={SHORT_LABEL}
                label={<ReadName>{sectionText("fields.lengthCm")}</ReadName>}
                control={<ReadValue>{product.lengthCm}</ReadValue>}
              />
              <FieldRow
                className={HALF12}
                labelWidth={SHORT_LABEL}
                label={<ReadName>{sectionText("fields.widthCm")}</ReadName>}
                control={<ReadValue>{product.widthCm}</ReadValue>}
              />
              <FieldRow
                className={HALF12}
                labelWidth={SHORT_LABEL}
                label={<ReadName>{sectionText("fields.heightCm")}</ReadName>}
                control={<ReadValue>{product.heightCm}</ReadValue>}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ================================== الأزرار، حيث «إضافة منتج»
          «وإذا فيه أزرار إضافية أضفها.»

          THE ADD CARD ENDS IN ONE ROW OF BUTTONS, and so does this —
          in the same place, under the last card. What differs is that
          a product being added has one act and a product that exists
          has five: correct it, sell it, send it for approval, put it
          away, remove it.

          EACH IS DRAWN ONLY WHERE THE SERVER WOULD ACCEPT IT. A
          control into a form that cannot be saved is worse than no
          control: somebody fills it in first and finds out after. */}
      <div className="flex flex-wrap items-center gap-2">
        {gate.canEditMedia ? (
          <ButtonLink
            href={`/${appLocale}/supplier/products/${product.id}/edit`}
            variant="secondary"
          >
            {t("actions.edit")}
          </ButtonLink>
        ) : null}

        {/* TWO WAYS TO SELL IT, and a product may be doing both at
            once: the one-live-listing rule is per sale mode. */}
        {canOffer ? (
          <ButtonLink
            href={`//supplier/products//direct/new`}
            variant="accentInteractive"
          >
            {t("newDirectShort")}
          </ButtonLink>
        ) : null}

        {canOffer ? (
          <ButtonLink
            href={`//supplier/products//offers/new`}
            variant="secondary"
          >
            {t("newOffer")}
          </ButtonLink>
        ) : null}

        {/* THE OFFERS, AS A DOOR AND NOT A TABLE — «ولا عروض هذا
            المنتج، حطها زر بس بدون تفاصيل، إذا ضغط عليه يدخلني على
            العرض».

            A WHOLE CARD STOOD HERE, listing each offer's price, its
            closing date and its state — every one of which is on the
            offer's own page, one press away, and none of which this
            page is about. The button carries no figure, so nothing
            here can disagree with what the offer says about itself.

            NUMBERED ONLY WHEN THERE IS MORE THAN ONE. A single
            offer needs no ordinal to be found, and two buttons
            reading «العرض» would be a coin toss. */}
        {productOffers.map((offer, index) => (
          <ButtonLink
            key={offer.id}
            href={`/${appLocale}/supplier/opportunities/${offer.id}`}
            variant="ghost"
          >
            {productOffers.length === 1
              ? t("openOffer")
              : t("openOfferNumbered", { number: index + 1 })}
          </ButtonLink>
        ))}

        <ProductActions
          productId={product.id}
          gate={gate}
          afterDeleteHref={`/${appLocale}/supplier/products`}
          labels={{
            submit: t("actions.submit"),
            submitPrompt: t("actions.submitPrompt"),
            archive: t("actions.archive"),
            archivePrompt: t("actions.archivePrompt"),
            remove: t("actions.delete"),
            removePrompt: t("actions.deletePrompt"),
            removing: t("actions.deleting"),
            confirm: common("confirm"),
            cancel: common("cancel"),
            submitting: t("actions.working"),
            errorTitle: states("errorTitle"),
            requestIdLabel: states("requestIdLabel"),
          }}
        />
      </div>

      {/* THE «المواصفات» CARD IS GONE, and nothing went with it. It
          listed the weight, the dimensions, the package content and
          the description — every one of which is now a row in the two
          cards above, in the arrangement the add form draws. Leaving
          it would have printed the same four facts twice on one page
          in two different shapes. */}
    </div>
  );
}

async function Breadcrumb({
  locale,
  label,
  back,
}: {
  locale: AppLocale;
  label: string;
  back: string;
}) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link
        href={`/${locale}/supplier/products`}
        className="inline-flex min-h-nav items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
      >
        {back}
      </Link>
    </nav>
  );
}
