"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import {
  isRegistrationConflict,
  toUserFacingError,
  type UserFacingError,
} from "@/lib/error-messages";
import { hasUsableCoordinates, type Coordinates } from "@/lib/geolocation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LocationPicker } from "./location-picker";

export interface CityOption {
  id: string;
  nameAr: string;
  nameEn: string;
}

/**
 * `title` is already resolved for the active locale by the caller.
 *
 * Unlike a city, a policy has no stored bilingual pair to choose
 * between: a PolicyDocument carries a code, and the display name comes
 * from this app's message catalogue. Carrying `titleAr`/`titleEn` here
 * would be inventing a distinction the data does not have.
 */
export interface PolicyOption {
  id: string;
  title: string;
}

export interface RegisterFormProps {
  locale: string;
  accountType: "TRADER" | "SUPPLIER";
  cities: CityOption[];
  policies: PolicyOption[];
}

/**
 * Company registration.
 *
 * No one-time code: the account is created with a CR number, an email
 * and a password, and the user signs in with the CR number afterwards.
 *
 * Submission is blocked until real coordinates exist — from the browser
 * or typed by hand. No sentinel, no city centroid, no default pair.
 */
export function RegisterForm({ locale, accountType, cities, policies }: RegisterFormProps) {
  const t = useTranslations("register");
  const common = useTranslations("common");
  const root = useTranslations();

  const router = useRouter();
  const errorId = useId();

  const [form, setForm] = useState({
    crNumber: "",
    legalName: "",
    email: "",
    password: "",
    primaryMobile1: "",
    primaryMobile2: "",
    cityId: "",
    shortAddress: "",
  });
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [acceptedPolicyIds, setAcceptedPolicyIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [conflict, setConflict] = useState(false);

  const allPoliciesAccepted =
    policies.length > 0 && policies.every((p) => acceptedPolicyIds.includes(p.id));

  const canSubmit =
    !submitting &&
    hasUsableCoordinates(coordinates) &&
    allPoliciesAccepted &&
    form.cityId !== "" &&
    form.crNumber.trim() !== "" &&
    form.email.trim() !== "" &&
    form.password !== "";

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function togglePolicy(id: string) {
    setAcceptedPolicyIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guarded rather than merely disabled: a disabled button is a UI
    // affordance, not a constraint, and Enter can still submit a form.
    if (!canSubmit || !coordinates) return;

    setSubmitting(true);
    setFailure(null);
    setConflict(false);

    const path =
      accountType === "TRADER" ? "/auth/register/trader" : "/auth/register/supplier";

    try {
      await apiClient.post(path, {
        crNumber: form.crNumber.trim(),
        legalName: form.legalName.trim(),
        email: form.email.trim(),
        password: form.password,
        primaryMobile1: form.primaryMobile1.trim(),
        primaryMobile2: form.primaryMobile2.trim(),
        cityId: form.cityId,
        shortAddress: form.shortAddress.trim(),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        acceptedPolicyVersionIds: acceptedPolicyIds,
      });

      router.replace(`/${locale}/login`);
      router.refresh();
    } catch (error) {
      // The API answers every identity conflict identically, on
      // purpose — it does not say whether the CR number or the email is
      // taken, because that would let anyone enumerate the platform's
      // members. The UI must not speculate either; it offers the two
      // routes a legitimate returning user needs.
      setConflict(isRegistrationConflict(error));
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  const cityLabel = (city: CityOption) => (locale.startsWith("ar") ? city.nameAr : city.nameEn);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label={t("crNumber")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            inputMode="numeric"
            autoComplete="off"
            required
            value={form.crNumber}
            onChange={(e) => set("crNumber", e.target.value)}
          />
        )}
      </Field>

      <Field label={t("legalName")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            required
            value={form.legalName}
            onChange={(e) => set("legalName", e.target.value)}
          />
        )}
      </Field>

      <Field label={t("email")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        )}
      </Field>

      <Field label={t("password")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("mobile1")} required requiredLabel={common("required")}>
          {({ inputId }) => (
            <Input
              id={inputId}
              inputMode="tel"
              required
              value={form.primaryMobile1}
              onChange={(e) => set("primaryMobile1", e.target.value)}
            />
          )}
        </Field>

        <Field label={t("mobile2")} required requiredLabel={common("required")}>
          {({ inputId }) => (
            <Input
              id={inputId}
              inputMode="tel"
              required
              value={form.primaryMobile2}
              onChange={(e) => set("primaryMobile2", e.target.value)}
            />
          )}
        </Field>
      </div>

      <Field label={t("city")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <select
            id={inputId}
            required
            value={form.cityId}
            onChange={(e) => set("cityId", e.target.value)}
            className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-content"
          >
            <option value="">{t("cityPlaceholder")}</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {cityLabel(city)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label={t("shortAddress")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            required
            value={form.shortAddress}
            onChange={(e) => set("shortAddress", e.target.value)}
          />
        )}
      </Field>

      <LocationPicker value={coordinates} onChange={setCoordinates} />

      <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium text-content">{t("policies.legend")}</legend>

        {policies.length === 0 ? (
          <p className="text-sm text-warning-text">{t("policies.unavailable")}</p>
        ) : (
          policies.map((policy) => (
            <label key={policy.id} className="flex items-start gap-2 text-sm text-content">
              <input
                type="checkbox"
                checked={acceptedPolicyIds.includes(policy.id)}
                onChange={() => togglePolicy(policy.id)}
                className="mt-1 border-line-strong"
              />
              <span>{policy.title}</span>
            </label>
          ))
        )}
      </fieldset>

      <div id={errorId} role="alert" aria-live="assertive">
        {failure ? (
          <div className="rounded-md border border-danger bg-surface px-3 py-3">
            <p className="text-sm text-content">{root(failure.messageKey)}</p>

            {conflict ? (
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <Link href={`/${locale}/login`} className="text-secondary hover:opacity-90">
                  {t("conflict.signIn")}
                </Link>
                <Link
                  href={`/${locale}/forgot-password`}
                  className="text-secondary hover:opacity-90"
                >
                  {t("conflict.recoverAccess")}
                </Link>
              </div>
            ) : null}

            {failure.requestId ? (
              <p className="mt-2 text-xs text-content-muted">
                {root("errors.requestIdLabel")}:{" "}
                <span className="font-mono">{failure.requestId}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {!hasUsableCoordinates(coordinates) ? (
        <p className="text-sm text-content-muted">{t("location.requiredNotice")}</p>
      ) : null}

      <Button type="submit" variant="secondary" disabled={!canSubmit} isLoading={submitting}>
        {submitting ? common("loading") : t("submit")}
      </Button>
    </form>
  );
}
