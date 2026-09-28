"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { toLocalInput } from "@/lib/opportunity-form";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { FieldRow, HALF6, THIRD6 } from "@/components/forms/listing-parts";

/**
 * AN OFFER, CORRECTED FROM THE CONSOLE — «حذف وتعديل العرض من صفحة
 * الإدارة، دام المشتري ما بعد دفع».
 *
 * THE CONSOLE COULD ONLY STOP AN OFFER. Pause, resume, cancel and
 * cancel-and-refund all answer «أوقفه»; not one of them answers «صحّح
 * السعر». An operator who found a price with a zero too many had to ask
 * the supplier to cancel and publish again, which loses the offer's
 * history to fix a typo.
 *
 * WHAT IT DOES NOT OFFER IS THE PRODUCT AND THE BRANCH. Changing which
 * product an offer sells, or which branch fulfils it, is not a
 * correction — it is a different offer — and the console has no read of
 * one supplier's catalogue to choose from anyway. The API would accept
 * both; this screen does not ask for them.
 *
 * AND THE START IS SHOWN, NOT EDITED, once the offer is on the market.
 * The moment it opened already happened; the server holds it where it
 * is for an ACTIVE or PAUSED offer, and a field that silently does
 * nothing is worse than no field.
 *
 * THE SAME WORDS AS THE SUPPLIER'S OWN FORM, read from
 * `supplier.opportunities.form` rather than restated under `admin`:
 * «الكمية المستهدفة» must mean the same thing on both screens, and two
 * catalogues are two places for it to stop meaning it.
 *
 * ONLY WHAT CHANGED IS SENT. An untouched field is left out of the body
 * entirely, which the API reads as «اترك هذا العمود». Sending the whole
 * form would make every save look like a seven-field edit in the audit
 * log, and the log is half the reason this exists.
 */

export interface AdminOpportunityEditLabels {
  save: string;
  working: string;
  saved: string;
  noChange: string;
  errorTitle: string;
  requestIdLabel: string;
}

export interface AdminEditableOpportunity {
  id: string;
  status: string;
  unitPriceAmount: string;
  targetQuantity: number;
  startAt: string;
  endAt: string;
  expectedPreparationDays: number;
  descriptionAr: string | null;
  descriptionEn: string | null;
}

/** Empty means "none", which the API spells `null`. */
const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function AdminOpportunityEditForm({
  opportunity,
  labels,
}: {
  opportunity: AdminEditableOpportunity;
  labels: AdminOpportunityEditLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const t = useTranslations("supplier.opportunities.form");
  const common = useTranslations("common");

  const [price, setPrice] = useState(opportunity.unitPriceAmount);
  const [quantity, setQuantity] = useState(String(opportunity.targetQuantity));
  const [startAt, setStartAt] = useState(() => toLocalInput(opportunity.startAt));
  const [endAt, setEndAt] = useState(() => toLocalInput(opportunity.endAt));
  const [preparation, setPreparation] = useState(
    String(opportunity.expectedPreparationDays),
  );
  const [descriptionAr, setDescriptionAr] = useState(
    opportunity.descriptionAr ?? "",
  );
  const [descriptionEn, setDescriptionEn] = useState(
    opportunity.descriptionEn ?? "",
  );

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nothing, setNothing] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  // The offer is through its start; the server holds `start_at` where it
  // is, so the field is read-only rather than a lie.
  const onTheMarket =
    opportunity.status === "ACTIVE" || opportunity.status === "PAUSED";

  const touch = () => {
    if (saved) setSaved(false);
    if (nothing) setNothing(false);
  };

  /**
   * The body: every field whose value differs from what the server sent.
   *
   * The price is compared as a NUMBER against the decimal string the
   * server returned — `"12.50"` and `12.5` are the same value, and
   * comparing the raw strings would report a change on every save.
   */
  function changedFields(): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    if (price.trim() !== "" && Number(price) !== Number(opportunity.unitPriceAmount)) {
      body.unitPriceAmount = Number(price);
    }
    if (quantity.trim() !== "" && Number(quantity) !== opportunity.targetQuantity) {
      body.targetQuantity = Number(quantity);
    }
    if (
      preparation.trim() !== "" &&
      Number(preparation) !== opportunity.expectedPreparationDays
    ) {
      body.expectedPreparationDays = Number(preparation);
    }

    // A `datetime-local` gives `YYYY-MM-DDTHH:mm`; the API wants ISO
    // 8601. Compared as INSTANTS, because the two spellings of one
    // moment are not the same string.
    if (!onTheMarket && startAt !== "") {
      const next = new Date(startAt);
      if (next.getTime() !== new Date(opportunity.startAt).getTime()) {
        body.startAt = next.toISOString();
      }
    }
    if (endAt !== "") {
      const next = new Date(endAt);
      if (next.getTime() !== new Date(opportunity.endAt).getTime()) {
        body.endAt = next.toISOString();
      }
    }

    const ar = orNull(descriptionAr);
    if (ar !== opportunity.descriptionAr && ar !== null) body.descriptionAr = ar;
    const en = orNull(descriptionEn);
    if (en !== opportunity.descriptionEn && en !== null) body.descriptionEn = en;

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
      await apiClient.patch(`/admin/opportunities/${opportunity.id}`, body);
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setFailure(toUserFacingError(caught));
    } finally {
      setBusy(false);
    }
  }

  const field = (
    name: string,
    label: string,
    value: string,
    set: (next: string) => void,
    options: {
      type?: string;
      numeric?: boolean;
      readOnly?: boolean;
      className?: string;
    } = {},
  ) => (
    <FieldRow
      className={options.className}
      label={
        <Label htmlFor={`admin-offer-${name}`} required requiredLabel={common("required")}>
          {label}
        </Label>
      }
      control={
        <Input
          id={`admin-offer-${name}`}
          appearance="outlined"
          type={options.type}
          inputMode={options.numeric ? "decimal" : undefined}
          readOnly={options.readOnly}
          value={value}
          onChange={(event) => {
            set(event.target.value);
            touch();
          }}
        />
      }
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-6 gap-x-4 gap-y-3">
        {field("unitPriceAmount", t("fields.unitPriceAmount"), price, setPrice, {
          numeric: true,
          className: THIRD6,
        })}
        {field("targetQuantity", t("fields.targetQuantity"), quantity, setQuantity, {
          numeric: true,
          className: THIRD6,
        })}
        {field(
          "expectedPreparationDays",
          t("fields.expectedPreparationDays"),
          preparation,
          setPreparation,
          { numeric: true, className: THIRD6 },
        )}
        {field("startAt", t("fields.startAt"), startAt, setStartAt, {
          type: "datetime-local",
          readOnly: onTheMarket,
          className: HALF6,
        })}
        {field("endAt", t("fields.endAt"), endAt, setEndAt, {
          type: "datetime-local",
          className: HALF6,
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-offer-descriptionAr">
            {t("fields.descriptionAr")}
          </Label>
          <Textarea
            id="admin-offer-descriptionAr"
            appearance="outlined"
            rows={3}
            dir="rtl"
            value={descriptionAr}
            onChange={(event) => {
              setDescriptionAr(event.target.value);
              touch();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-offer-descriptionEn">
            {t("fields.descriptionEn")}
          </Label>
          <Textarea
            id="admin-offer-descriptionEn"
            appearance="outlined"
            rows={3}
            dir="ltr"
            value={descriptionEn}
            onChange={(event) => {
              setDescriptionEn(event.target.value);
              touch();
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? labels.working : labels.save}
        </Button>
        {saved ? (
          <span className="text-sm text-success-text">{labels.saved}</span>
        ) : null}
        {nothing ? (
          <span className="text-sm text-content-muted">{labels.noChange}</span>
        ) : null}
      </div>

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
    </form>
  );
}
