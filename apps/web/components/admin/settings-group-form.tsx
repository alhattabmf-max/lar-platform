"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * One typed settings group, as a real form.
 *
 * THE BOUNDS COME FROM THE SERVER'S OWN DTO and are carried on the
 * input's `min`/`max`, so the browser refuses out-of-range before a
 * request is made — but the refusal that DECIDES is still the server's.
 * These two must never disagree, which is why the numbers are quoted
 * from the DTO at the call site rather than restated here.
 *
 * NO HINT TEXT UNDER ANY FIELD. A unit — «نقطة أساس», «دقيقة» — is part
 * of what the field means and stays; a sentence explaining what the
 * field is for does not. That rule is the platform's, and a guard test
 * enforces it.
 *
 * SAVING IS A WRITE TO A VERSIONED POLICY for several of these groups:
 * the server appends a new version rather than overwriting, and records
 * the actor in the audit log. Nothing about that is decided here — this
 * form sends the values and shows what came back.
 */

export type SettingsField =
  | {
      kind: "int" | "decimal";
      name: string;
      label: string;
      min: number;
      max?: number;
      step?: number;
      /** A unit, not an instruction. */
      unit?: ReactNode;
    }
  | { kind: "boolean"; name: string; label: string }
  | { kind: "text"; name: string; label: string }
  | {
      /**
       * A fixed set of values, any subset of which may be on.
       *
       * The options are the ones the SERVER accepts — `@IsIn` on the
       * DTO — so this control can never offer a value the platform
       * would refuse. Narrowing the list is an operator's business;
       * widening it beyond what the code can decode is not.
       */
      kind: "multi";
      name: string;
      label: string;
      options: readonly { value: string; label: string }[];
    };

export interface SettingsGroupFormLabels {
  save: string;
  working: string;
  saved: string;
  errorTitle: string;
  requestIdLabel: string;
  yes: string;
  no: string;
}

export type SettingsValues = Record<string, string | number | boolean | string[]>;

/** A multi-select is held as a comma-joined string and split on submit. */
const JOIN = ",";

export function SettingsGroupForm({
  path,
  fields,
  initial,
  labels,
  disabled = false,
}: {
  /** The API path, without the `/api/v1` prefix. */
  path: string;
  fields: SettingsField[];
  initial: SettingsValues;
  labels: SettingsGroupFormLabels;
  /** True when the platform, not this screen, owns the value. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const raw = initial[f.name];
        return [f.name, Array.isArray(raw) ? raw.join(JOIN) : String(raw ?? "")];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const set = (name: string, next: string) => {
    setValues((current) => ({ ...current, [name]: next }));
    setSaved(false);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;

    setBusy(true);
    setFailure(null);
    setSaved(false);

    // Typed by field kind, because the DTOs validate types: an int sent
    // as "500" fails @IsInt, and a boolean sent as "true" fails
    // @IsBoolean. The form holds strings; the wire must not.
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.name] ?? "";
      if (f.kind === "boolean") body[f.name] = raw === "true";
      else if (f.kind === "text") body[f.name] = raw;
      else if (f.kind === "multi")
        body[f.name] = raw === "" ? [] : raw.split(JOIN).filter(Boolean);
      else body[f.name] = Number(raw);
    }

    try {
      await apiClient.put(path, body);
      setSaved(true);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field
            key={f.name}
            // THE UNIT MAY BE A DRAWING. The riyal symbol has no code
            // point, so a label carrying it is a node rather than a
            // string — which `Field.label` has always accepted.
            label={
              "unit" in f && f.unit ? (
                <>
                  {f.label} — {f.unit}
                </>
              ) : (
                f.label
              )
            }
          >
            {({ inputId, errorId, invalid }) =>
              f.kind === "multi" ? (
                <div
                  id={inputId}
                  role="group"
                  aria-describedby={errorId}
                  className="flex flex-wrap gap-x-4 gap-y-2 py-1"
                >
                  {f.options.map((option) => {
                    const on = (values[f.name] ?? "").split(JOIN).includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="inline-flex min-h-control items-center gap-control-gap text-[length:var(--control-font-size)]"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={disabled || busy}
                          onChange={(event) => {
                            const current = (values[f.name] ?? "")
                              .split(JOIN)
                              .filter(Boolean);
                            const next = event.target.checked
                              ? [...current, option.value]
                              : current.filter((v) => v !== option.value);
                            set(f.name, next.join(JOIN));
                          }}
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              ) : f.kind === "boolean" ? (
                <Select
                  id={inputId}
                  value={values[f.name]}
                  onChange={(event) => set(f.name, event.target.value)}
                  disabled={disabled || busy}
                  describedById={errorId}
                  invalid={invalid}
                >
                  <option value="true">{labels.yes}</option>
                  <option value="false">{labels.no}</option>
                </Select>
              ) : (
                <Input
                  id={inputId}
                  type={f.kind === "text" ? "text" : "number"}
                  inputMode={f.kind === "int" ? "numeric" : undefined}
                  min={f.kind === "text" ? undefined : f.min}
                  max={f.kind === "text" ? undefined : f.max}
                  step={f.kind === "decimal" ? (f.step ?? "any") : f.kind === "int" ? 1 : undefined}
                  value={values[f.name]}
                  onChange={(event) => set(f.name, event.target.value)}
                  disabled={disabled || busy}
                  describedById={errorId}
                  invalid={invalid}
                />
              )
            }
          </Field>
        ))}
      </div>

      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="block font-mono text-xs text-content-muted">
              {labels.requestIdLabel}: {failure.requestId}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled || busy}>
          {busy ? labels.working : labels.save}
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-success">
            {labels.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}
