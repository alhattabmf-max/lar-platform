"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdminPlatformBillingProfile } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { newIdempotencyKey, type IdempotencyKey } from "@/lib/idempotency";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * The platform's own billing identity, as a form.
 *
 * A NEW VERSION EVERY TIME. The API has no update endpoint: POST appends
 * version N+1 and leaves every earlier one untouched, because documents
 * already issued were computed against them. So the submit button never
 * says "save" once a profile exists — it says which version it is about
 * to create, which is the only honest label for a control that cannot
 * undo itself.
 *
 * THE FIELDS ARE THE SERVER'S. `addressSnapshot` used to be an opaque
 * `@IsObject()` that accepted `{}`, and this form filled it with a
 * typed city name. Both are gone: the address is a declared shape —
 * a `cityId` from the reference table and a short address — and the
 * server resolves the city and snapshots its names itself, so nothing
 * typed here can put a city name on a document that disagrees with the
 * city it claims to be.
 *
 * WHAT THE BROWSER REFUSES IS NOT WHAT DECIDES. Every check below is
 * made by the service too. This exists so a reader is told which field
 * is missing before a request is sent, not instead of the server.
 *
 * ONE VERSION PER PRESS. An `Idempotency-Key` is minted when the form
 * mounts and sent with the request; the server claims it and replays
 * rather than appending a second permanent version. Disabling the
 * button while busy is a courtesy on top of that, not the mechanism.
 */

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC_DIGITS =
  "۰۱۲۳۴۵۶۷۸۹";

/**
 * Mirrors `normalizeDigitsAndWhitespace` on the API.
 *
 * Not shared code — the two packages have no common runtime module — so
 * it is written out and kept identical on purpose. If they ever diverge,
 * the server's is the one that decides; this exists only so the browser
 * does not reject a VAT number typed in Arabic-Indic digits, which the
 * API accepts.
 */
function normalizeDigits(input: string): string {
  let result = "";
  for (const ch of input) {
    const arabic = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (arabic !== -1) {
      result += String(arabic);
      continue;
    }
    const extended = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(ch);
    if (extended !== -1) {
      result += String(extended);
      continue;
    }
    if (/\s/.test(ch)) continue;
    result += ch;
  }
  // Written as escapes on purpose: these characters are invisible in
  // an editor, and a bidi mark pasted into source is how a file starts
  // reading differently from how it looks.
  return result.replace(/[\u200B-\u200F\uFEFF]/g, "");
}

/** The service's own limits, quoted here so the two cannot drift apart. */
const MAX_LEGAL_NAME_LENGTH = 300;
const VAT_NUMBER_PATTERN = /^\d{15}$/;

export interface PlatformBillingProfileFormLabels {
  legalName: string;
  crNumber: string;
  vatRegistered: string;
  vatNumber: string;
  city: string;
  cityPlaceholder: string;
  shortAddress: string;
  yes: string;
  no: string;
  required: string;
  create: string;
  /**
   * ALREADY RESOLVED, with the version number in it.
   *
   * It was a function taking the number, which cannot cross the
   * server-to-client boundary: Next refuses to serialise a function
   * prop, and a guard test in this repo enforces that rule precisely so
   * it is caught here rather than in a browser. The page knows
   * `current.version` and can say «إصدار النسخة رقم 4» itself.
   */
  newVersion: string;
  working: string;
  saved: string;
  errorTitle: string;
  requestIdLabel: string;
  errorLegalName: string;
  errorCrNumber: string;
  errorVatNumber: string;
  errorAddress: string;
}

type Errors = Partial<
  Record<"legalName" | "crNumber" | "vatNumber" | "cityId" | "shortAddress", string>
>;

export function PlatformBillingProfileForm({
  current,
  cities,
  labels,
}: {
  /** The profile in force, or null on a fresh installation. */
  current: AdminPlatformBillingProfile | null;
  /**
   * The active cities, already named in the reader's language.
   *
   * A SELECT, NOT A TEXT BOX. Cities are reference data with their own
   * table and their own admin screen, and every other address on this
   * platform carries a `cityId`. A typed city name would go onto a
   * commission document with nothing to check it against.
   */
  cities: readonly { id: string; name: string }[];
  labels: PlatformBillingProfileFormLabels;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [legalName, setLegalName] = useState(current?.legalName ?? "");
  const [crNumber, setCrNumber] = useState(current?.crNumber ?? "");
  const [vatRegistered, setVatRegistered] = useState(
    current?.isVatRegistered ? "true" : "false",
  );
  const [vatNumber, setVatNumber] = useState(current?.vatNumber ?? "");
  const [cityId, setCityId] = useState(
    () => current?.addressSnapshot?.cityId ?? "",
  );
  const [shortAddress, setShortAddress] = useState(
    () => current?.addressSnapshot?.shortAddress ?? "",
  );

  const [busy, setBusy] = useState(false);
  // MINTED ONCE, when the form mounts. A key per press would let a
  // timeout and a retry become two permanent versions.
  const [key] = useState<IdempotencyKey>(() => newIdempotencyKey());
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const registered = vatRegistered === "true";

  /** Any edit invalidates the "saved" line — it described a past state. */
  const touch = () => {
    if (saved) setSaved(false);
  };

  function validate(): Errors {
    const found: Errors = {};
    const name = legalName.trim();
    if (name.length === 0 || name.length > MAX_LEGAL_NAME_LENGTH) {
      found.legalName = labels.errorLegalName;
    }
    if (crNumber.trim().length === 0) found.crNumber = labels.errorCrNumber;
    if (registered && !VAT_NUMBER_PATTERN.test(normalizeDigits(vatNumber))) {
      found.vatNumber = labels.errorVatNumber;
    }
    // The SERVER refuses an empty address now — this is the courtesy of
    // naming the missing field before a request is made, not the rule.
    if (cityId === "") found.cityId = labels.errorAddress;
    if (shortAddress.trim().length === 0) found.shortAddress = labels.errorAddress;
    return found;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setFailure(null);
    setSaved(false);

    // EXACTLY THE DECLARED SHAPE. Spreading whatever the stored blob
    // held used to carry unknown keys forward; the DTO is closed now and
    // an extra key is a 400, so the transitional carry-through would
    // break the very form it was meant to protect. The city NAMES are
    // absent on purpose — the service reads them from the city row.
    const addressSnapshot = {
      cityId,
      shortAddress: shortAddress.trim(),
    };

    try {
      await apiClient.post(
        "/admin/platform-billing-profile",
        {
          legalName: legalName.trim(),
          crNumber: crNumber.trim(),
          isVatRegistered: registered,
          // Sent only when registered: the service rejects a VAT number
          // on a profile that is not VAT-registered, and rightly so.
          ...(registered ? { vatNumber: normalizeDigits(vatNumber) } : {}),
          addressSnapshot,
        },
        { idempotencyKey: key },
      );
      setSaved(true);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-6">
        {/* A legal name runs long — the only field given the full row. */}
        <div className="sm:col-span-6">
          <Field
            label={labels.legalName}
            error={errors.legalName}
            required
            requiredLabel={labels.required}
          >
            {({ inputId, errorId, invalid }) => (
              <Input
                id={inputId}
                value={legalName}
                maxLength={MAX_LEGAL_NAME_LENGTH}
                autoComplete="organization"
                onChange={(event) => {
                  setLegalName(event.target.value);
                  touch();
                }}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              />
            )}
          </Field>
        </div>

        {/* A registration number, a yes/no and a tax number are all short.
            None of them earns a full row. */}
        <div className="sm:col-span-2">
          <Field
            label={labels.crNumber}
            error={errors.crNumber}
            required
            requiredLabel={labels.required}
          >
            {({ inputId, errorId, invalid }) => (
              <Input
                id={inputId}
                value={crNumber}
                inputMode="numeric"
                className="font-mono"
                onChange={(event) => {
                  setCrNumber(event.target.value);
                  touch();
                }}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              />
            )}
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label={labels.vatRegistered}>
            {({ inputId, errorId, invalid }) => (
              <Select
                id={inputId}
                value={vatRegistered}
                onChange={(event) => {
                  setVatRegistered(event.target.value);
                  // A number kept behind a "no" would be sent on the next
                  // switch back without anyone re-reading it.
                  if (event.target.value === "false") setVatNumber("");
                  setErrors((current) => ({ ...current, vatNumber: undefined }));
                  touch();
                }}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              >
                <option value="true">{labels.yes}</option>
                <option value="false">{labels.no}</option>
              </Select>
            )}
          </Field>
        </div>

        {/* Shown only when registered. The server refuses a VAT number
            otherwise, so offering the box would be offering a rejection. */}
        {registered ? (
          <div className="sm:col-span-2">
            <Field
              label={labels.vatNumber}
              error={errors.vatNumber}
              required
              requiredLabel={labels.required}
            >
              {({ inputId, errorId, invalid }) => (
                <Input
                  id={inputId}
                  value={vatNumber}
                  inputMode="numeric"
                  className="font-mono"
                  onChange={(event) => {
                    setVatNumber(event.target.value);
                    touch();
                  }}
                  disabled={busy}
                  describedById={errorId}
                  invalid={invalid}
                />
              )}
            </Field>
          </div>
        ) : null}

        <div className="sm:col-span-3">
          <Field
            label={labels.city}
            error={errors.cityId}
            required
            requiredLabel={labels.required}
          >
            {({ inputId, errorId, invalid }) => (
              <Select
                id={inputId}
                value={cityId}
                onChange={(event) => {
                  setCityId(event.target.value);
                  touch();
                }}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              >
                {/* No pre-selected first city: a default nobody chose is
                    a city that ends up on a document by accident. */}
                <option value="">{labels.cityPlaceholder}</option>
                {cities.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="sm:col-span-3">
          <Field
            label={labels.shortAddress}
            error={errors.shortAddress}
            required
            requiredLabel={labels.required}
          >
            {({ inputId, errorId, invalid }) => (
              <Input
                id={inputId}
                value={shortAddress}
                className="font-mono"
                onChange={(event) => {
                  setShortAddress(event.target.value);
                  touch();
                }}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              />
            )}
          </Field>
        </div>
      </div>

      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="block font-mono text-xs text-content-muted">
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

      <div>
        <Button type="submit" disabled={busy}>
          {busy
            ? labels.working
            : current
              ? labels.newVersion
              : labels.create}
        </Button>
      </div>
    </form>
  );
}
