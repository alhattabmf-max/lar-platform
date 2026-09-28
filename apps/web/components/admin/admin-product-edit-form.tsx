"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Gift, Tags, Truck } from "lucide-react";
import {
  PRODUCT_TEXT_LIMITS,
  type AdminProductDetail,
  type AdminTaxonomyNodeItem,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { localized } from "@/lib/localized";
import type { AppLocale } from "@/i18n/routing";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
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
 * A SUPPLIER'S PRODUCT, EDITED FROM THE CONSOLE — IN THE SUPPLIER'S OWN
 * CARDS.
 *
 * «استخدم بطاقة إضافة المنتج في صفحة المورد نفس ترتيبها بالضبط، وبدل
 *  إضافة منتج زر تعديل وجنبه إلغاء وزر شطب وزر إيقاف.»
 *
 * SO THE ARRANGEMENT IS NOT A NEW ONE. Three cards in the order the
 * supplier's «إضافة منتج» draws them — what the product IS with its
 * picture beside the names, then how it is sold, then what it takes to
 * move it — built from the same parts (`SectionTitle`, `FieldRow`, the
 * parcel mark, the span constants) rather than from a copy of them.
 *
 * AND THE SAME WORDS. The field names, the section titles, the
 * placeholders and the two footnotes are read from
 * `supplier.listings.form`, not restated under `admin`: «الوزن (كجم)»
 * must mean the same thing on both screens, and two catalogues are two
 * places for it to stop meaning it.
 *
 * WHAT DIFFERS IS THE ROW OF BUTTONS. Where the supplier submits a new
 * product, this saves an edit — and beside it stand the console's own
 * answers, passed in from the page: suspend, and erase.
 *
 * ONLY WHAT CHANGED IS SENT. Every field is compared against the value
 * that arrived from the server, and an untouched field is omitted from
 * the body entirely — which the API reads as "leave this column alone".
 * Sending the whole form would make every save look like a fifteen-field
 * edit in the audit log, and the log is half the reason this exists.
 *
 * AN EMPTY NULLABLE FIELD IS A CLEAR, sent as `null` rather than `""`.
 * The API distinguishes the two deliberately: `undefined` keeps, `null`
 * removes, a value sets.
 *
 * THE SOFT SALES-UNIT REFERENCE IS NOT ON THIS FORM, because it is not
 * on the supplier's card either. Nothing reads it for business logic —
 * the two unit NAMES are the source of truth for every snapshot, offer
 * and order — so it is an autocomplete hint, and a console screen is
 * not where one is corrected.
 */

export interface AdminProductEditLabels {
  save: string;
  cancel: string;
  working: string;
  saved: string;
  noChange: string;
  errorTitle: string;
  requestIdLabel: string;
}

const asText = (value: string) => value.trim();

/** Empty means "none", which the API spells `null`. */
const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function AdminProductEditForm({
  product,
  taxonomy,
  locale,
  cancelHref,
  images,
  actions,
  labels,
}: {
  product: AdminProductDetail;
  taxonomy: readonly AdminTaxonomyNodeItem[];
  locale: AppLocale;
  /** Where «إلغاء» goes: the register this product was opened from. */
  cancelHref: string;
  /** The picture column, rendered by the page beside the names. */
  images: ReactNode;
  /** The console's own answers — suspend, erase — beside save. */
  actions: ReactNode;
  labels: AdminProductEditLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const t = useTranslations("supplier.listings.form");
  const common = useTranslations("common");

  const [nameAr, setNameAr] = useState(product.nameAr);
  const [nameEn, setNameEn] = useState(product.nameEn);
  const [descriptionAr, setDescriptionAr] = useState(product.descriptionAr ?? "");
  const [descriptionEn, setDescriptionEn] = useState(product.descriptionEn ?? "");
  const [salesUnitNameAr, setSalesUnitNameAr] = useState(product.salesUnitNameAr);
  const [salesUnitNameEn, setSalesUnitNameEn] = useState(product.salesUnitNameEn);
  const [packageQuantity, setPackageQuantity] = useState(
    product.packageContentQuantity ?? "",
  );
  const [packageUnitAr, setPackageUnitAr] = useState(
    product.packageContentUnitNameAr ?? "",
  );
  const [packageUnitEn, setPackageUnitEn] = useState(
    product.packageContentUnitNameEn ?? "",
  );
  const [weight, setWeight] = useState(product.weightPerUnit);
  const [length, setLength] = useState(product.lengthCm);
  const [width, setWidth] = useState(product.widthCm);
  const [height, setHeight] = useState(product.heightCm);

  const byId = useMemo(
    () => new Map(taxonomy.map((node) => [node.id, node])),
    [taxonomy],
  );

  /** The top of this node's ancestry — the category, as the card names it. */
  const rootOf = useMemo(
    () => (id: string) => {
      let node = byId.get(id);
      while (node?.parentId) node = byId.get(node.parentId);
      return node?.id ?? "";
    },
    [byId],
  );

  const [rootId, setRootId] = useState(() => rootOf(product.taxonomyNodeId));
  const [taxonomyNodeId, setTaxonomyNodeId] = useState(product.taxonomyNodeId);

  const roots = useMemo(
    () =>
      taxonomy.filter(
        (node) => node.parentId === null && (node.isActive || node.id === rootId),
      ),
    [taxonomy, rootId],
  );

  // The chosen category's own branches, plus — whatever its state — the
  // branch this product already sits on. Dropping a deactivated node the
  // product uses would silently move it somewhere nobody chose.
  const branches = useMemo(
    () =>
      taxonomy.filter(
        (node) =>
          node.parentId === rootId &&
          (node.isActive || node.id === product.taxonomyNodeId),
      ),
    [taxonomy, rootId, product.taxonomyNodeId],
  );

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nothing, setNothing] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const touch = () => {
    if (saved) setSaved(false);
    if (nothing) setNothing(false);
  };

  function chooseRoot(next: string) {
    setRootId(next);
    // A category with no branches IS the filing point — the API takes a
    // leaf directly. One with branches has no valid answer yet.
    const children = taxonomy.filter((node) => node.parentId === next);
    setTaxonomyNodeId(children.length === 0 ? next : "");
    touch();
  }

  /**
   * The body: every field whose value differs from what the server sent.
   *
   * Numbers are compared as NUMBERS against the decimal string the
   * server returned — `"1.500"` and `1.5` are the same value, and
   * comparing the raw strings would report a change on every save.
   */
  function changedFields(): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    const text = (key: string, next: string, current: string) => {
      if (asText(next) !== current) body[key] = asText(next);
    };
    const nullableText = (key: string, next: string, current: string | null) => {
      const value = orNull(next);
      if (value !== current) body[key] = value;
    };
    const decimal = (key: string, next: string, current: string) => {
      const value = asText(next);
      if (value === "") return;
      if (Number(value) !== Number(current)) body[key] = Number(value);
    };

    text("nameAr", nameAr, product.nameAr);
    text("nameEn", nameEn, product.nameEn);
    nullableText("descriptionAr", descriptionAr, product.descriptionAr);
    nullableText("descriptionEn", descriptionEn, product.descriptionEn);
    text("salesUnitNameAr", salesUnitNameAr, product.salesUnitNameAr);
    text("salesUnitNameEn", salesUnitNameEn, product.salesUnitNameEn);

    // The package group is all-or-nothing on the server. Clearing the
    // quantity therefore sends all three as null in one body, so a clear
    // is a whole clear rather than a refusal.
    const quantity = orNull(packageQuantity);
    if (quantity === null && product.packageContentQuantity !== null) {
      body.packageContentQuantity = null;
      body.packageContentUnitNameAr = null;
      body.packageContentUnitNameEn = null;
    } else if (quantity !== null) {
      if (
        product.packageContentQuantity === null ||
        Number(quantity) !== Number(product.packageContentQuantity)
      ) {
        body.packageContentQuantity = Number(quantity);
      }
      nullableText(
        "packageContentUnitNameAr",
        packageUnitAr,
        product.packageContentUnitNameAr,
      );
      nullableText(
        "packageContentUnitNameEn",
        packageUnitEn,
        product.packageContentUnitNameEn,
      );
    }

    decimal("weightPerUnit", weight, product.weightPerUnit);
    decimal("lengthCm", length, product.lengthCm);
    decimal("widthCm", width, product.widthCm);
    decimal("heightCm", height, product.heightCm);

    if (taxonomyNodeId !== "" && taxonomyNodeId !== product.taxonomyNodeId) {
      body.taxonomyNodeId = taxonomyNodeId;
    }

    return body;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const body = changedFields();
    if (Object.keys(body).length === 0) {
      setNothing(true);
      setSaved(false);
      return;
    }

    setBusy(true);
    setNothing(false);
    setFailure(null);
    setSaved(false);

    try {
      await apiClient.patch(`/admin/products/${product.id}`, body);
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setFailure(toUserFacingError(caught));
    } finally {
      setBusy(false);
    }
  }

  /** One named box, the label beside it — the card's own field shape. */
  const field = (
    name:
      | "nameAr"
      | "nameEn"
      | "salesUnitNameAr"
      | "salesUnitNameEn"
      | "packageContentQuantity"
      | "packageContentUnitNameAr"
      | "packageContentUnitNameEn"
      | "weightPerUnit"
      | "lengthCm"
      | "widthCm"
      | "heightCm",
    value: string,
    set: (next: string) => void,
    options: {
      dir?: "rtl" | "ltr";
      required?: boolean;
      numeric?: boolean;
      maxLength?: number;
      className?: string;
      labelWidth?: string;
    } = {},
  ) => (
    <FieldRow
      className={options.className}
      labelWidth={options.labelWidth}
      label={
        <Label
          htmlFor={`admin-product-${name}`}
          required={options.required}
          requiredLabel={common("required")}
        >
          {t(`fields.${name}`)}
        </Label>
      }
      control={
        <Input
          id={`admin-product-${name}`}
          appearance="outlined"
          dir={options.dir}
          inputMode={options.numeric ? "decimal" : undefined}
          maxLength={options.maxLength}
          placeholder={t(`placeholders.${name}`)}
          value={value}
          onChange={(event) => {
            set(event.target.value);
            touch();
          }}
          disabled={busy}
          data-testid={`admin-product-${name}`}
        />
      }
    />
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-card-gap">
      {/* ======================================= بيانات المنتج === */}
      <Card ariaLabel={t("sections.item")}>
        <CardBody>
          <SectionTitle icon={<Tags className="size-5 text-secondary" />}>
            {t("sections.item")}
          </SectionTitle>

          <div className="grid grid-cols-12 gap-x-4 gap-y-2">
            <div className="col-span-12 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:col-span-9">
              {field("nameAr", nameAr, setNameAr, {
                dir: "rtl",
                required: true,
                maxLength: PRODUCT_TEXT_LIMITS.nameAr,
              })}
              {field("nameEn", nameEn, setNameEn, {
                dir: "ltr",
                required: true,
                maxLength: PRODUCT_TEXT_LIMITS.nameEn,
              })}

              <FieldRow
                label={
                  <Label htmlFor="admin-product-category" required requiredLabel={common("required")}>
                    {t("fields.category")}
                  </Label>
                }
                control={
                  <Select
                    id="admin-product-category"
                    appearance="outlined"
                    value={rootId}
                    onChange={(event) => chooseRoot(event.target.value)}
                    disabled={busy}
                    data-testid="admin-product-category"
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

              {/* THE SUB-CATEGORY KEEPS ITS PLACE IN THE GRID ALWAYS, and
                  is answerable only when the chosen category has
                  branches — a category with none is a leaf the API takes
                  directly, and an enabled control offering nothing would
                  be a question with no answer. */}
              <FieldRow
                label={
                  <Label
                    htmlFor="admin-product-branch"
                    required={branches.length > 0}
                    requiredLabel={common("required")}
                  >
                    {t("fields.taxonomyNodeId")}
                  </Label>
                }
                control={
                  <Select
                    id="admin-product-branch"
                    appearance="outlined"
                    value={taxonomyNodeId}
                    disabled={busy || branches.length === 0}
                    onChange={(event) => {
                      setTaxonomyNodeId(event.target.value);
                      touch();
                    }}
                    data-testid="admin-product-branch"
                  >
                    <option value="">{t("placeholderBranch")}</option>
                    {branches.map((node) => (
                      <option key={node.id} value={node.id}>
                        {localized(locale, node.nameAr, node.nameEn)}
                      </option>
                    ))}
                  </Select>
                }
              />

              <FieldRow
                label={
                  <Label htmlFor="admin-product-descriptionAr">
                    {t("fields.descriptionAr")}
                  </Label>
                }
                control={
                  <Textarea
                    id="admin-product-descriptionAr"
                    appearance="outlined"
                    dir="rtl"
                    rows={2}
                    maxLength={PRODUCT_TEXT_LIMITS.descriptionAr}
                    placeholder={t("placeholders.descriptionAr")}
                    value={descriptionAr}
                    onChange={(event) => {
                      setDescriptionAr(event.target.value);
                      touch();
                    }}
                    disabled={busy}
                    className="resize-y"
                    data-testid="admin-product-descriptionAr"
                  />
                }
              />
              <FieldRow
                label={
                  <Label htmlFor="admin-product-descriptionEn">
                    {t("fields.descriptionEn")}
                  </Label>
                }
                control={
                  <Textarea
                    id="admin-product-descriptionEn"
                    appearance="outlined"
                    dir="ltr"
                    rows={2}
                    maxLength={PRODUCT_TEXT_LIMITS.descriptionEn}
                    placeholder={t("placeholders.descriptionEn")}
                    value={descriptionEn}
                    onChange={(event) => {
                      setDescriptionEn(event.target.value);
                      touch();
                    }}
                    disabled={busy}
                    className="resize-y"
                    data-testid="admin-product-descriptionEn"
                  />
                }
              />
            </div>

            {/* THE PICTURE'S OWN COLUMN, with the rule the supplier's
                card draws between it and the names — and only from `lg`,
                because a phone stacks the two and a line across a stack
                separates nothing. */}
            <div className="col-span-12 flex flex-col lg:col-span-3 lg:border-s lg:border-line lg:ps-4">
              {images}
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-12 gap-card-gap">
        {/* ========================== وحدة البيع ومحتوى العبوة === */}
        <Card className="col-span-12 lg:col-span-7" ariaLabel={t("sections.selling")}>
          <CardBody>
            <SectionTitle icon={<Gift className="size-5 text-secondary" />}>
              {t("sections.selling")}
            </SectionTitle>

            <div className="grid grid-cols-6 gap-x-4 gap-y-2">
              {field("salesUnitNameAr", salesUnitNameAr, setSalesUnitNameAr, {
                dir: "rtl",
                required: true,
                maxLength: PRODUCT_TEXT_LIMITS.salesUnitNameAr,
                className: HALF6,
              })}
              {field("salesUnitNameEn", salesUnitNameEn, setSalesUnitNameEn, {
                dir: "ltr",
                required: true,
                maxLength: PRODUCT_TEXT_LIMITS.salesUnitNameEn,
                className: HALF6,
              })}
              {field("packageContentQuantity", packageQuantity, setPackageQuantity, {
                numeric: true,
                className: THIRD6,
              })}
              {field("packageContentUnitNameAr", packageUnitAr, setPackageUnitAr, {
                dir: "rtl",
                maxLength: PRODUCT_TEXT_LIMITS.packageContentUnitNameAr,
                className: THIRD6,
              })}
              {field("packageContentUnitNameEn", packageUnitEn, setPackageUnitEn, {
                dir: "ltr",
                maxLength: PRODUCT_TEXT_LIMITS.packageContentUnitNameEn,
                className: THIRD6,
              })}
            </div>

            <p className="text-center text-xs text-content-muted">{t("packageExample")}</p>
          </CardBody>
        </Card>

        {/* ================================== الوزن والأبعاد === */}
        <Card className="col-span-12 lg:col-span-5" ariaLabel={t("sections.shipping")}>
          <CardBody className="flex h-full flex-col justify-between">
            <SectionTitle icon={<Truck className="size-5 text-accent" />}>
              {t("sections.shipping")}
            </SectionTitle>

            <div className="grid grid-cols-12 gap-x-4 gap-y-2">
              {field("weightPerUnit", weight, setWeight, {
                required: true,
                numeric: true,
                className: HALF12,
                labelWidth: SHORT_LABEL,
              })}
              {field("lengthCm", length, setLength, {
                required: true,
                numeric: true,
                className: HALF12,
                labelWidth: SHORT_LABEL,
              })}
              {field("widthCm", width, setWidth, {
                required: true,
                numeric: true,
                className: HALF12,
                labelWidth: SHORT_LABEL,
              })}
              {field("heightCm", height, setHeight, {
                required: true,
                numeric: true,
                className: HALF12,
                labelWidth: SHORT_LABEL,
              })}
            </div>

            <div className="flex items-center justify-center gap-8">
              <p className="text-xs text-content-muted">{t("shippingNote")}</p>
              <ParcelMark className="h-14 w-auto shrink-0" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* THE ROW OF ANSWERS — «زر تعديل وجنبه إلغاء وزر شطب وزر إيقاف».
          Save first because it is what the form is for; the way out
          beside it; and the console's own two, passed in by the page,
          last — the further from the primary action, the better, when
          one of them is permanent. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} data-testid="admin-product-save">
          {busy ? labels.working : labels.save}
        </Button>

        {/* A LINK, NOT A BUTTON THAT GOES BACK. `router.back()` returns
            to wherever the reader came from, which after a save is this
            same page again; the register is the one destination that is
            true however this page was reached. Nothing typed here has
            been written, so leaving is not an act to confirm. */}
        <ButtonLink href={cancelHref} variant="ghost">
          {labels.cancel}
        </ButtonLink>

        {actions}

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {labels.errorTitle}: {root(failure.messageKey)}
            {failure.requestId ? (
              <span className="ms-2 font-mono text-xs text-content-muted">
                {labels.requestIdLabel} {failure.requestId}
              </span>
            ) : null}
          </p>
        ) : null}

        {saved ? (
          <p role="status" className="text-sm text-success">
            {labels.saved}
          </p>
        ) : null}

        {nothing ? (
          <p role="status" className="text-sm text-content-muted">
            {labels.noChange}
          </p>
        ) : null}
      </div>
    </form>
  );
}
