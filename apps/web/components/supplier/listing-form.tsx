"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock, Gift, ImagePlus, Tags, Truck } from "lucide-react";
import { Riyal } from "@/components/ui/riyal";
import type { OpportunityLimits, TaxonomyNodeItem } from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import type { SupplierLocation } from "@/lib/supplier-data";
import {
  EMPTY_LISTING_FORM,
  LISTING_FIELD_ORDER,
  firstListingErrorField,
  hasListingErrors,
  scopeFields,
  toDirectRequest,
  toOfferRequest,
  toProductRequest,
  validateListingForm,
  type ListingField,
  type ListingFormErrors,
  type ListingFormValues,
  type ListingScope,
} from "@/lib/listing-form";
import { localized } from "@/lib/localized";
import type { AppLocale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Label, FieldError, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  ErrorSummary,
  useUnsavedChangesWarning,
} from "@/components/forms/form-shell";
import {
  FieldRow,
  HALF12,
  HALF6,
  ParcelMark,
  SHORT_LABEL,
  SectionTitle,
  THIRD6,
} from "@/components/forms/listing-parts";

/**
 * ONE FORM WITH TWO SCOPES: the product, or an offer on it.
 *
 * A PRODUCT is what the supplier keeps — its names, its category, its
 * picture, the unit it is sold in, what is in the carton, and what a
 * carrier needs. Recording it sells nothing and no trader sees it.
 *
 * AN OFFER is what the market can see — a price, a quantity, the branch
 * it ships from, and how long it runs. The same product carries one
 * after another, which is the whole reason the two are separate: the
 * owner's rule is «يسجّل المورد كل منتجاته وتُحفظ لديه، ثم يُنشئ عرضًا
 * على منتجات مختارة، ويعيد الكرّة على نفس المنتج».
 *
 * THE WORD "OPPORTUNITY" APPEARS NOWHERE a supplier can see. The
 * platform still writes the offer as an `opportunity` row carrying the
 * pinned tax, share tier and commission that every order hangs off, and
 * freezes the product's identity into an append-only snapshot at
 * publication. That split is the ONLY reason a supplier can correct a
 * typo tomorrow without rewriting what somebody bought last month. It
 * is the API's business, not this form's.
 *
 * NOTHING HERE COMPUTES MONEY. The tax split, the total value and the
 * minimum order are resolved and FROZEN server side at publication.
 * An estimate shown here would be a second figure that eventually
 * disagrees with what a buyer was charged.
 *
 * WHAT IS SAVED IS NEVER LOST. Each scope writes more than one row, and
 * a failure between them does not throw the typing away: the panel at
 * the top says what was saved and links to it, and the button stops so
 * a second press cannot make a duplicate.
 *
 * THE CATEGORY IS TWO CONTROLS, not one, because the rule is: pick a
 * category, and pick a branch if it has branches. A single flat list
 * would let a supplier file a product under «مواد البناء» — which the
 * API refuses, and which tells a buyer nothing that «مواد البناء ←
 * بيتزا» does not tell them better.
 */
export interface ListingFormProps {
  /** `product` writes the catalogue row; `offer` puts an existing one on sale. */
  scope: ListingScope;
  locale: AppLocale;
  /** The categories to file a product under. Unread in the offer scope. */
  taxonomy?: readonly TaxonomyNodeItem[];
  /** The branches an offer ships from. Unread in the product scope. */
  locations?: readonly SupplierLocation[];
  /** The product this offer is made on. Required in the offer scope. */
  productId?: string;
  /**
   * The offer already running on this product, when there is one.
   *
   * PRESENT MEANS PUBLISHING IS REFUSED, and the form says so before a
   * button is pressed rather than after — but SAVING IS NOT. The owner's
   * rule bites on the publication alone: «إنشاء العرض كمسودة مسموح في
   * أي وقت؛ الممنوع هو النشر ما دام على المنتج عرض حيّ». So the draft
   * button stays live and the supplier prepares the next offer while
   * the current one runs.
   *
   * The server refuses either way — this is the courtesy, not the rule.
   */
  liveOfferHref?: string;
  backHref: string;
  /**
   * The admin-configured bounds, when they could be read.
   *
   * OPTIONAL on purpose. A failed read degrades to warnings without
   * figures, never to invented defaults — a bound this app made up
   * would refuse an offer the server would have accepted.
   */
  limits?: OpportunityLimits;
}

/** The maximum image a supplier may attach, mirroring the API's own ceiling. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** What was written before something later failed, and where to open it. */
interface SavedSoFar {
  href: string;
  failure: UserFacingError;
}

export function ListingForm({
  scope,
  locale,
  taxonomy = [],
  locations = [],
  productId,
  liveOfferHref,
  backHref,
  limits,
}: ListingFormProps) {
  const t = useTranslations("supplier.listings.form");
  const fieldErrors = useTranslations("supplier.listings.form.errors");
  // The live-offer sentence lives with the OFFERS, because the offer's
  // own page says the same thing to the same person and one wording is
  // the point.
  const offers = useTranslations("supplier.opportunities");
  const common = useTranslations("common");
  // FROM THE ROOT, because `messageKey` is already a full path —
  // `errors.codes.VALIDATION_FAILED`. Scoping this to "errors" asked
  // for `errors.errors.codes.…` and printed the key itself on screen.
  const errorText = useTranslations();
  const router = useRouter();

  const isProduct = scope === "product";
  // A DIRECT LISTING IS AN OFFER WITHOUT A CLOCK. Everything below that
  // asks about the sale asks the same questions; the duration field is
  // the one thing it does not have, and the labels on the quantity and
  // the buttons say «مخزون» rather than «هدف».
  const isDirect = scope === "direct";

  const [values, setValues] = useState<ListingFormValues>(EMPTY_LISTING_FORM);
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<ListingFormErrors>({});
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [saved, setSaved] = useState<SavedSoFar | null>(null);
  // WHICH BUTTON IS WORKING, so the spinner and the label land on the
  // one that was pressed rather than on both.
  const [busy, setBusy] = useState<"publish" | "draft" | null>(null);
  const [dirty, setDirty] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);

  useUnsavedChangesWarning(dirty && busy === null);

  // ------------------------------------------------------ the category
  /**
   * ROOTS AND THEIR BRANCHES, resolved from one flat list.
   *
   * `parentId` may reference a node absent from the list — the contract
   * says so — so a node whose parent is missing is treated as a root
   * rather than dropped. A category nobody can select is a category
   * nothing can be filed under.
   */
  const { roots, branchesOf } = useMemo(() => {
    const present = new Set(taxonomy.map((node) => node.id));
    const byParent = new Map<string, TaxonomyNodeItem[]>();
    const topLevel: TaxonomyNodeItem[] = [];

    for (const node of taxonomy) {
      if (node.parentId && present.has(node.parentId)) {
        const siblings = byParent.get(node.parentId) ?? [];
        siblings.push(node);
        byParent.set(node.parentId, siblings);
      } else {
        topLevel.push(node);
      }
    }

    const sort = (list: TaxonomyNodeItem[]) =>
      [...list].sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      roots: sort(topLevel),
      branchesOf: (id: string) => sort(byParent.get(id) ?? []),
    };
  }, [taxonomy]);

  const [rootId, setRootId] = useState("");
  const branches = rootId ? branchesOf(rootId) : [];

  /**
   * The id that actually goes to the API.
   *
   * A root WITH branches is not a valid answer — the API refuses it —
   * so it is never submitted. A root with none is a leaf and is.
   */
  function chooseRoot(id: string) {
    setRootId(id);
    const children = id ? branchesOf(id) : [];
    update("taxonomyNodeId", children.length > 0 ? "" : id);
  }

  // ------------------------------------------------------------- state
  function update(field: ListingField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function chooseImage(file: File | null) {
    setImage(file);
    setDirty(true);
    setErrors((current) => {
      if (!current.image) return current;
      const next = { ...current };
      delete next.image;
      return next;
    });
  }

  const preview = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image],
  );

  // ------------------------------------------------------------ submit
  /**
   * THE CATALOGUE ROW, THEN ITS PICTURE.
   *
   * Two calls, because `POST /companies/me/products` is JSON and the
   * image goes to the product's own media collection — there is no row
   * to hang a file on until the first one answers. When the second
   * fails the product still EXISTS: saying so and linking to it is the
   * only honest outcome, and it is what stops a second press making a
   * duplicate of everything just typed.
   */
  async function submitProduct() {
    const created = await apiClient.post<{ id: string }>(
      "/companies/me/products",
      toProductRequest(values),
    );
    const href = `/${locale}/supplier/products/${created.id}`;

    try {
      await uploadFile(
        `/companies/me/products/${created.id}/media`,
        image!,
        "file",
      );
    } catch (error) {
      setDirty(false);
      setSaved({ href, failure: toUserFacingError(error) });
      return;
    }

    setDirty(false);
    router.push(href);
    router.refresh();
  }

  /**
   * THE OFFER ROW, AND — ONLY IF ASKED — ITS PUBLICATION.
   *
   * CREATING IS NEVER REFUSED for anything about the company or about
   * another offer: adding is not selling. Publication is where the
   * platform checks that the company is verified, has a bank account
   * and a tax rate, and that no other offer on this product is running
   * — so THAT is what can be blocked, and the draft it leaves behind is
   * a real row the supplier finishes later from the offer's own page.
   *
   * THE ROW IS WRITTEN ONCE. Whichever way the second step goes, this
   * function has already created exactly one offer, and the panel it
   * leaves behind disables both buttons — so a second press cannot
   * write a second copy of the same offer.
   */
  async function submitOffer(publish: boolean) {
    const created = await apiClient.post<{ id: string }>(
      "/companies/me/opportunities",
      // ONE ENDPOINT, ONE ROW, ONE DISCRIMINATOR APART. A direct listing
      // sends no window at all — the API refuses one on that mode
      // rather than ignoring it.
      isDirect ? toDirectRequest(values, productId!) : toOfferRequest(values, productId!),
    );
    const href = `/${locale}/supplier/opportunities/${created.id}`;

    if (!publish) {
      // A draft, and nothing more. No window has started: the pair this
      // row carries is provisional, and publication re-anchors it.
      setDirty(false);
      router.push(href);
      router.refresh();
      return;
    }

    try {
      // The publish that also stamps the window from NOW and submits
      // the product for approval if it has never been approved — the
      // same one the offer's own «نشر» button calls, so there is no
      // second implementation of what publishing means.
      await apiClient.post(`/companies/me/listings/${created.id}/publish`);
    } catch (error) {
      setDirty(false);
      setSaved({ href, failure: toUserFacingError(error) });
      return;
    }

    setDirty(false);
    router.push(href);
    router.refresh();
  }

  /**
   * ONE PATH FOR BOTH BUTTONS.
   *
   * `publish` is the only difference between «نشر العرض» and «حفظ
   * كمسودة»: the same values, the same validation, the same single row
   * written. A second code path would be a second set of rules to keep
   * in step.
   */
  async function run(publish: boolean) {
    if (busy || saved) return;

    // LIMITS REACH THE VALIDATOR. The bounds were being SHOWN and not
    // CHECKED once, so a duration outside them travelled to the server
    // and came back as a refusal. Now that the sentence stating them is
    // gone, the check is the only thing telling the supplier, and it
    // has to actually run.
    const found = validateListingForm(values, {
      scope,
      limits,
      hasImage: image !== null,
    });

    if (isProduct && image && image.size > MAX_IMAGE_BYTES) {
      found.image = {
        key: "imageTooLarge",
        values: { mb: MAX_IMAGE_BYTES / (1024 * 1024) },
      };
    }

    setErrors(found);
    if (hasListingErrors(found)) {
      const first = firstListingErrorField(found);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }

    setBusy(publish ? "publish" : "draft");
    setFailure(null);
    try {
      if (isProduct) await submitProduct();
      else await submitOffer(publish);
    } catch (error) {
      // Nothing was written — a rejected value, a lost connection, a
      // bound the server disagreed about. Everything typed is still on
      // the screen and the button is live again.
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // ENTER PUBLISHES, which is what the primary button does. The draft
    // button is `type="button"` and calls `run(false)` itself, so a
    // keyboard submit can never mean something other than the button it
    // is standing in for.
    void run(true);
  }

  // ------------------------------------------------------------ render
  const fieldId = (field: ListingField | "image") => `listing-${field}`;
  const errorId = (field: ListingField | "image") => `listing-${field}-error`;

  /** Only the scope's own fields can carry an error worth jumping to. */
  const onScreen = new Set<string>(scopeFields(scope));

  const summaryEntries = LISTING_FIELD_ORDER.filter(
    (field) => onScreen.has(field) && errors[field],
  )
    .map((field) => ({
      targetId: fieldId(field),
      message: `${t(`fields.${field}`)}: ${fieldErrors(errors[field]!.key, errors[field]!.values)}`,
    }))
    .concat(
      errors.image
        ? [
            {
              targetId: fieldId("image"),
              message: `${t("fields.image")}: ${fieldErrors(errors.image.key, errors.image.values)}`,
            },
          ]
        : [],
    );

  /**
   * THE WIDTHS THE REFERENCE DRAWS.
   *
   * Each card carries its own grid, because each card asks a different
   * shape of question: the item is two columns of names, the selling
   * terms are two then three, the shipping card is three then four.
   *
   * EVERY ONE OF THEM COLLAPSES TO ONE COLUMN ON A PHONE. The spans
   * only begin at `sm`, so a narrow screen stacks and scrolls
   * naturally with nothing squeezed and nothing sideways.
   */
  /** Half a row in the six-column selling card. */

  /** The example the reference prints inside a field, greyed. */
  const hint = (field: ListingField) => t(`placeholders.${field}`);

  /**
   * One labelled control.
   *
   * `gap-1` rather than `gap-1.5`, and the error slot only renders when
   * there IS an error — an always-present empty paragraph under every
   * field is four pixels twenty-one times over.
   */
  function textField(
    field: ListingField,
    options: {
      required?: boolean;
      type?: string;
      multiline?: boolean;
      span?: string;
      /** Show the reference's greyed example inside the control. */
      placeholder?: boolean;
      rows?: number;
      /**
       * The direction the ANSWER is written in, not the page's.
       *
       * «اسم المنتج بالإنجليزية» is answered in English and must be
       * typed left to right — with the caret, the punctuation and a
       * half-finished word all behaving — while the label above it
       * stays in the page's own direction. Left unset the field simply
       * inherits the page, which is right for every field that has no
       * language of its own: a price, a weight, a count.
       */
      dir?: "ltr" | "rtl";
      /** A narrower name column, where the name is short. */
      labelWidth?: string;
      /**
       * A different name for the same field.
       *
       * `targetQuantity` is the collective target on a group offer and
       * the stock on a direct one — one column, two readings, and the
       * label is the only thing on screen that says which.
       */
      labelKey?: string;
    } = {},
  ) {
    const invalid = Boolean(errors[field]);
    return (
      <FieldRow
        className={options.span}
        labelWidth={options.labelWidth}
        label={
          <Label
            htmlFor={fieldId(field)}
            required={options.required}
            requiredLabel={options.required ? common("required") : undefined}
          >
            {t(options.labelKey ?? `fields.${field}`)}
          </Label>
        }
        control={
          options.multiline ? (
            <Textarea
              id={fieldId(field)}
              appearance="outlined"
              dir={options.dir}
              rows={options.rows ?? 2}
              className="resize-y"
              placeholder={options.placeholder ? hint(field) : undefined}
              value={values[field]}
              invalid={invalid}
              describedById={invalid ? errorId(field) : undefined}
              onChange={(event) => update(field, event.target.value)}
            />
          ) : (
            <Input
              id={fieldId(field)}
              appearance="outlined"
              dir={options.dir}
              type={options.type ?? "text"}
              inputMode={options.type === "number" ? "decimal" : undefined}
              placeholder={options.placeholder ? hint(field) : undefined}
              value={values[field]}
              invalid={invalid}
              describedById={invalid ? errorId(field) : undefined}
              onChange={(event) => update(field, event.target.value)}
            />
          )
        }
        error={
          invalid ? (
            <FieldError id={errorId(field)}>
              {fieldErrors(errors[field]!.key, errors[field]!.values)}
            </FieldError>
          ) : null
        }
      />
    );
  }

  const priceNoteId = `${fieldId("unitPriceAmount")}-note`;
  const priceInvalid = Boolean(errors.unitPriceAmount);

  /** The branch an offer ships from — a select, so it is not `textField`. */
  const branchField = (span: string) => (
    <FieldRow
      className={span}
      label={
        <Label
          htmlFor={fieldId("fulfillmentLocationId")}
          required
          requiredLabel={common("required")}
        >
          {t("fields.fulfillmentLocationId")}
        </Label>
      }
      control={
        <Select
          id={fieldId("fulfillmentLocationId")}
          appearance="outlined"
          value={values.fulfillmentLocationId}
          invalid={Boolean(errors.fulfillmentLocationId)}
          describedById={
            errors.fulfillmentLocationId
              ? errorId("fulfillmentLocationId")
              : undefined
          }
          onChange={(event) =>
            update("fulfillmentLocationId", event.target.value)
          }
        >
          <option value="">{t("placeholderLocation")}</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      }
      error={
        errors.fulfillmentLocationId ? (
          <FieldError id={errorId("fulfillmentLocationId")}>
            {fieldErrors(
              errors.fulfillmentLocationId.key,
              errors.fulfillmentLocationId.values,
            )}
          </FieldError>
        ) : null
      }
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-card-gap">
      <ErrorSummary title={t("errorSummaryTitle")} entries={summaryEntries} />

      {/* WHAT WAS SAVED BEFORE THE NEXT STEP FAILED.
          Not an error and not a success — a row exists, it is not
          finished, and the way to finish it is a page rather than this
          form. The link is the only route offered from here on: the
          submit below is disabled, so pressing again cannot write a
          second copy of everything above. */}
      {saved ? (
        <div
          role="status"
          className="rounded-card border border-warning bg-warning-surface px-card-x py-card-y"
        >
          <p className="font-medium text-warning-text">
            {isProduct ? t("saved.productTitle") : t("saved.offerTitle")}
          </p>
          <p className="mt-1 text-sm text-warning-text">
            {errorText(saved.failure.messageKey)}
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            <Link
              href={saved.href}
              className="mt-2 inline-flex min-h-nav items-center text-sm font-medium text-secondary hover:opacity-[var(--state-hover-opacity)]"
            >
              {isProduct ? t("saved.openProduct") : t("saved.openOffer")}
            </Link>
            {/* THE OFFER THAT IS IN THE WAY, when the refusal was that
                one. A sentence saying another offer is running, with no
                way to reach it, leaves the supplier hunting for it. */}
            {liveOfferHref &&
            saved.failure.messageKey ===
              "errors.codes.PRODUCT_ALREADY_HAS_LIVE_OFFER" ? (
              <Link
                href={liveOfferHref}
                className="mt-2 inline-flex min-h-nav items-center text-sm font-medium text-secondary hover:opacity-[var(--state-hover-opacity)]"
              >
                {offers("liveOffer.open")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* THE OFFER ALREADY RUNNING, and what it means for this one.
          Said BEFORE anything is typed rather than after a refused
          publication — and it does not close the page: the draft button
          below is live, which is the whole shape of the owner's rule. */}
      {!isProduct && liveOfferHref ? (
        <div
          role="status"
          className="rounded-card border border-warning bg-warning-surface px-card-x py-card-y"
        >
          <p className="font-medium text-warning-text">
            {offers("liveOffer.title")}
          </p>
          <p className="mt-1 text-sm text-warning-text">
            {offers("liveOffer.note")}
          </p>
          <Link
            href={liveOfferHref}
            className="mt-2 inline-flex min-h-nav items-center text-sm font-medium text-secondary hover:opacity-[var(--state-hover-opacity)]"
          >
            {offers("liveOffer.open")}
          </Link>
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="rounded-card bg-danger/10 px-card-x py-card-y"
        >
          <p className="font-medium text-danger">
            {errorText(failure.messageKey)}
          </p>
          {failure.requestId ? (
            <p className="mt-1 text-xs text-content-muted">
              {t("requestIdLabel")}:{" "}
              <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {isProduct ? (
        <>
          {/* ======================================= بيانات المنتج ===
              What the product IS: its two names, where it is filed, what
              it looks like and how it is described. The picture sits
              BESIDE the names, in its own column with a rule between,
              exactly as the reference draws it. */}
          <Card ariaLabel={t("sections.item")}>
            <CardBody>
              <SectionTitle icon={<Tags className="size-5 text-secondary" />}>
                {t("sections.item")}
              </SectionTitle>

              <div className="grid grid-cols-12 gap-x-4 gap-y-2">
                <div className="col-span-12 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:col-span-9">
                  {textField("nameAr", {
                    dir: "rtl",
                    required: true,
                    placeholder: true,
                  })}
                  {textField("nameEn", {
                    dir: "ltr",
                    required: true,
                    placeholder: true,
                  })}

                  <FieldRow
                    label={
                      <Label
                        htmlFor="listing-category-root"
                        required
                        requiredLabel={common("required")}
                      >
                        {t("fields.category")}
                      </Label>
                    }
                    control={
                      <Select
                        id="listing-category-root"
                        appearance="outlined"
                        value={rootId}
                        onChange={(event) => chooseRoot(event.target.value)}
                      >
                        <option value="">{t("placeholderCategory")}</option>
                        {roots.map((node) => (
                          <option key={node.id} value={node.id}>
                            {localized(locale, node.nameAr, node.nameEn)}
                          </option>
                        ))}
                      </Select>
                    }
                  />

                  {/* THE SUB-CATEGORY KEEPS ITS PLACE IN THE GRID ALWAYS
                      — the reference draws it beside the main category
                      on every screen — and it is ANSWERABLE only when
                      the chosen category actually has branches. A
                      category with none is a leaf: the API takes it
                      directly, and an enabled control offering nothing
                      would be a question with no answer. So the control
                      is there, and disabled, and carries no required
                      mark it cannot earn. */}
                  {branches.length > 0 ? (
                    <FieldRow
                      label={
                        <Label
                          htmlFor={fieldId("taxonomyNodeId")}
                          required
                          requiredLabel={common("required")}
                        >
                          {t("fields.taxonomyNodeId")}
                        </Label>
                      }
                      control={
                        <Select
                          id={fieldId("taxonomyNodeId")}
                          appearance="outlined"
                          value={values.taxonomyNodeId}
                          invalid={Boolean(errors.taxonomyNodeId)}
                          describedById={
                            errors.taxonomyNodeId
                              ? errorId("taxonomyNodeId")
                              : undefined
                          }
                          onChange={(event) =>
                            update("taxonomyNodeId", event.target.value)
                          }
                        >
                          <option value="">{t("placeholderBranch")}</option>
                          {branches.map((node) => (
                            <option key={node.id} value={node.id}>
                              {localized(locale, node.nameAr, node.nameEn)}
                            </option>
                          ))}
                        </Select>
                      }
                      error={
                        errors.taxonomyNodeId ? (
                          <FieldError id={errorId("taxonomyNodeId")}>
                            {fieldErrors(
                              errors.taxonomyNodeId.key,
                              errors.taxonomyNodeId.values,
                            )}
                          </FieldError>
                        ) : null
                      }
                    />
                  ) : (
                    <FieldRow
                      label={
                        <Label htmlFor={fieldId("taxonomyNodeId")}>
                          {t("fields.taxonomyNodeId")}
                        </Label>
                      }
                      control={
                        <Select
                          id={fieldId("taxonomyNodeId")}
                          appearance="outlined"
                          disabled
                        >
                          <option value="">{t("placeholderBranch")}</option>
                        </Select>
                      }
                    />
                  )}

                  {textField("descriptionAr", {
                    dir: "rtl",
                    multiline: true,
                    placeholder: true,
                  })}
                  {textField("descriptionEn", {
                    dir: "ltr",
                    multiline: true,
                    placeholder: true,
                  })}
                </div>

                {/* THE PICTURE'S OWN COLUMN, with the rule the reference
                    draws between it and the names — and only from `lg`,
                    because a phone stacks the two and a line across a
                    stack separates nothing. */}
                <div className="col-span-12 flex flex-col lg:col-span-3 lg:border-s lg:border-line lg:ps-4">
                  {/* THE INPUT IS THE CONTROL, and it is real. `sr-only`
                      rather than `hidden`: it stays focusable, so the
                      keyboard path is the file picker itself and not a
                      div pretending to be one. The dashed panel is its
                      LABEL, which is what makes the whole area clickable
                      with no script at all — and `peer-focus-visible`
                      paints the ring the invisible input cannot show. */}
                  <input
                    ref={imageInput}
                    id={fieldId("image")}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-invalid={errors.image ? true : undefined}
                    aria-describedby={
                      errors.image ? errorId("image") : undefined
                    }
                    onChange={(event) =>
                      chooseImage(event.target.files?.[0] ?? null)
                    }
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={fieldId("image")}
                    /* THE RING IS ON THE LABEL, not on the panel inside
                       it: `peer-*` compiles to a SIBLING selector, and
                       only the label is a sibling of the input. */
                    className="flex flex-1 cursor-pointer flex-col gap-1 rounded-card peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2"
                  >
                    <span className="text-center text-sm font-medium text-content">
                      {t("fields.image")}
                      <span className="text-danger ms-1" aria-hidden="true">
                        *
                      </span>
                      <span className="sr-only">{common("required")}</span>
                    </span>
                    <span className="mx-auto flex w-full max-w-56 flex-1 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-line-control py-3 transition-colors hover:border-secondary">
                      {preview ? (
                        /* A `blob:` URL that exists only in this tab —
                           there is nothing for an optimizer to fetch.
                           Decorative, so `alt=""`: the file's name is
                           written under it. */
                        <img
                          src={preview}
                          alt=""
                          className="size-16 rounded-control object-cover shadow-soft"
                        />
                      ) : (
                        <ImagePlus
                          className="size-8 text-secondary"
                          aria-hidden="true"
                        />
                      )}
                      <span className="text-sm font-semibold text-secondary">
                        {t("image.choose")}
                      </span>
                      <span className="max-w-full truncate px-2 text-xs text-content-muted">
                        {image ? image.name : t("image.previewHere")}
                      </span>
                    </span>
                  </label>
                  {errors.image ? (
                    <FieldError id={errorId("image")}>
                      {fieldErrors(errors.image.key, errors.image.values)}
                    </FieldError>
                  ) : null}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* ==================== وحدة البيع بجانب الشحن، كما في المرجع
              Two narrow cards on one row: what the product is sold as
              takes seven columns and what it takes to move it five,
              which is the proportion the reference draws. Below `lg`
              they stack. */}
          <div className="grid grid-cols-12 gap-card-gap">
            {/* ========================== وحدة البيع ومحتوى العبوة === */}
            <Card
              className="col-span-12 lg:col-span-7"
              ariaLabel={t("sections.selling")}
            >
              <CardBody>
                <SectionTitle icon={<Gift className="size-5 text-secondary" />}>
                  {t("sections.selling")}
                </SectionTitle>

                <div className="grid grid-cols-6 gap-x-4 gap-y-2">
                  {textField("salesUnitNameAr", {
                    dir: "rtl",
                    required: true,
                    placeholder: true,
                    span: HALF6,
                  })}
                  {textField("salesUnitNameEn", {
                    dir: "ltr",
                    required: true,
                    placeholder: true,
                    span: HALF6,
                  })}

                  {/* PACKAGE CONTENT, REQUIRED AND IN THE OPEN.
                      It was optional and folded away — the owner made it
                      required, so the disclosure row it cost is returned
                      and the three controls join the rest. */}
                  {textField("packageContentQuantity", {
                    required: true,
                    type: "number",
                    placeholder: true,
                    span: THIRD6,
                  })}
                  {textField("packageContentUnitNameAr", {
                    dir: "rtl",
                    required: true,
                    placeholder: true,
                    span: THIRD6,
                  })}
                  {textField("packageContentUnitNameEn", {
                    dir: "ltr",
                    required: true,
                    placeholder: true,
                    span: THIRD6,
                  })}
                </div>

                {/* THE CARD'S OWN FOOTNOTE, not an instruction under a
                    field: one worked example of what the three numbers
                    above mean together. */}
                <p className="text-center text-xs text-content-muted">
                  {t("packageExample")}
                </p>
              </CardBody>
            </Card>

            {/* ================================== الوزن والأبعاد === */}
            <Card
              className="col-span-12 lg:col-span-5"
              ariaLabel={t("sections.shipping")}
            >
              <CardBody>
                <SectionTitle
                  icon={<Truck className="size-5 text-accent" />}
                  aside={
                    <>
                      <p className="text-xs text-content-muted">
                        {t("shippingNote")}
                      </p>
                      <ParcelMark className="h-10 w-auto shrink-0" />
                    </>
                  }
                >
                  {t("sections.shipping")}
                </SectionTitle>

                <div className="grid grid-cols-12 gap-x-4 gap-y-2">
                  {textField("weightPerUnit", {
                    required: true,
                    type: "number",
                    placeholder: true,
                    span: HALF12,
                    labelWidth: SHORT_LABEL,
                  })}
                  {textField("lengthCm", {
                    required: true,
                    type: "number",
                    placeholder: true,
                    span: HALF12,
                    labelWidth: SHORT_LABEL,
                  })}
                  {textField("widthCm", {
                    required: true,
                    type: "number",
                    placeholder: true,
                    span: HALF12,
                    labelWidth: SHORT_LABEL,
                  })}
                  {textField("heightCm", {
                    required: true,
                    type: "number",
                    placeholder: true,
                    span: HALF12,
                    labelWidth: SHORT_LABEL,
                  })}
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      ) : (
        /* ================================= الشروط والمدد، عرضًا واحدًا
           The offer asks five questions and no more. Everything the
           product already answered — its names, its category, its
           picture, its weight — is not asked again, and could not be:
           changing any of it would change the product, not this sale. */
        <div className="grid grid-cols-12 gap-card-gap">
          {/* ============================================ شروط البيع */}
          <Card
            className="col-span-12 lg:col-span-7"
            ariaLabel={t(isDirect ? "sections.directTerms" : "sections.offerTerms")}
          >
            <CardBody>
              <SectionTitle icon={<Gift className="size-5 text-secondary" />}>
                {t(isDirect ? "sections.directTerms" : "sections.offerTerms")}
              </SectionTitle>

              <div className="grid grid-cols-6 gap-x-4 gap-y-2">
                {/* THE PRICE WEARS ITS CURRENCY, and says once — under
                    the field, where the reference puts it — that the
                    figure is tax inclusive. It used to be a parenthesis
                    inside the label, which made the label the longest on
                    the page to carry three words that are not its
                    name. */}
                <FieldRow
                  className={HALF6}
                  label={
                    <Label
                      htmlFor={fieldId("unitPriceAmount")}
                      required
                      requiredLabel={common("required")}
                    >
                      {t("fields.unitPriceAmount")}
                    </Label>
                  }
                  control={
                    <>
                      <div className="relative">
                        <Input
                          id={fieldId("unitPriceAmount")}
                          appearance="outlined"
                          type="number"
                          inputMode="decimal"
                          placeholder={hint("unitPriceAmount")}
                          value={values.unitPriceAmount}
                          invalid={priceInvalid}
                          describedById={
                            priceInvalid
                              ? `${priceNoteId} ${errorId("unitPriceAmount")}`
                              : priceNoteId
                          }
                          onChange={(event) =>
                            update("unitPriceAmount", event.target.value)
                          }
                          // The spinner would sit UNDER the currency and be
                          // an invisible control; a price is a decimal,
                          // which is the one number nobody steps.
                          className="pe-14 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <span
                          aria-hidden="true"
                          /* PART OF THE FIELD, not a tile dropped on it. Now
                         that the field is white with a line, a solid
                         grey block at its end read as a second control;
                         a page-coloured fill behind a hairline divider
                         reads as the field's own currency mark. */
                          className="pointer-events-none absolute inset-y-px end-px flex items-center rounded-e-control border-s border-line-control bg-background px-control-x text-[length:var(--control-font-size)] text-content-muted"
                        >
                          {/* THE MARK ITSELF, not the two letters that stood
                          in for it. `sr-only` keeps what a screen reader
                          used to hear. */}
                          <Riyal />
                          <span className="sr-only">{t("priceCurrency")}</span>
                        </span>
                      </div>
                      <p
                        id={priceNoteId}
                        className="mt-1 text-xs text-content-muted"
                      >
                        {t("priceTaxNote")}
                      </p>
                    </>
                  }
                  error={
                    priceInvalid ? (
                      <FieldError id={errorId("unitPriceAmount")}>
                        {fieldErrors(
                          errors.unitPriceAmount!.key,
                          errors.unitPriceAmount!.values,
                        )}
                      </FieldError>
                    ) : null
                  }
                />

                {textField("targetQuantity", {
                  required: true,
                  type: "number",
                  placeholder: true,
                  span: HALF6,
                  // «الكمية المستهدفة» on a group offer, «المخزون
                  // المتاح» on a direct one. The same column, and the
                  // label is what tells the supplier which question
                  // they are answering.
                  labelKey: isDirect ? "fields.directStock" : undefined,
                })}

                {branchField(HALF6)}
              </div>
            </CardBody>
          </Card>

          {/* ============================================ مدة العرض */}
          <Card
            className="col-span-12 lg:col-span-5"
            ariaLabel={t(isDirect ? "sections.directTiming" : "sections.offerTiming")}
          >
            <CardBody className="flex h-full flex-col justify-between">
              <SectionTitle
                icon={<CalendarClock className="size-5 text-accent" />}
              >
                {t(isDirect ? "sections.directTiming" : "sections.offerTiming")}
              </SectionTitle>

              <div className="grid grid-cols-12 gap-x-4 gap-y-2">
                {/* NO DURATION ON A DIRECT LISTING — «لا مدة انتهاء».
                    A shelf does not expire, the API refuses a window on
                    it, and a field nobody can answer would be an error
                    nobody can clear. */}
                {isDirect
                  ? null
                  : textField("offerDurationDays", {
                      required: true,
                      type: "number",
                      span: HALF12,
                      labelWidth: SHORT_LABEL,
                    })}
                {textField("expectedPreparationDays", {
                  required: true,
                  type: "number",
                  span: isDirect ? HALF12 : HALF12,
                  labelWidth: SHORT_LABEL,
                })}
              </div>

              {/* HOW LONG, NOT FROM WHEN. The window opens the moment
                  the offer goes on sale, so there is no start to ask
                  for — and saying so once here is what stops the
                  question being asked.

                  FOR A DIRECT LISTING the note says the other thing:
                  it stays on sale until the supplier stops it. */}
              <p className="text-xs text-content-muted">
                {t(isDirect ? "directWindowNote" : "offerWindowNote")}
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ================================================ شريط الإجراء
          The reference gives the two buttons a bar of their own at the
          foot of the page, with the required-fields note at the other
          end of it. The SUBMIT is first in the DOM, which is the order
          a keyboard reaches them in. */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-control-gap">
            {/* PUBLISHING IS THE PRIMARY ACT and stays first in the DOM,
                which is the order a keyboard reaches it and the one the
                Enter key stands in for. It is the button that goes dark
                while another offer on this product is running — never
                the draft beside it. */}
            <Button
              type="submit"
              disabled={
                busy !== null ||
                saved !== null ||
                (!isProduct && liveOfferHref !== undefined)
              }
              isLoading={busy === "publish"}
            >
              {busy === "publish"
                ? isProduct
                  ? t("submitting")
                  : isDirect
                    ? t("submittingDirect")
                    : t("submittingOffer")
                : isProduct
                  ? t("submit")
                  : isDirect
                    ? t("submitDirect")
                    : t("submitOffer")}
            </Button>

            {/* SAVING IS NOT SELLING, so this one is never gated by
                another offer, by the company's record, or by anything
                the platform checks at publication. */}
            {isProduct ? null : (
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null || saved !== null}
                isLoading={busy === "draft"}
                onClick={() => void run(false)}
              >
                {busy === "draft" ? t("submittingDraft") : t("submitDraft")}
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push(backHref)}
            >
              {t("cancel")}
            </Button>
          </div>
          <p className="text-xs text-content-muted">
            {t("requiredNote")}
            <span className="text-danger ms-1" aria-hidden="true">
              *
            </span>
          </p>
        </CardBody>
      </Card>
    </form>
  );
}
