"use client";

import { Building2, Store } from "lucide-react";

/**
 * Which kind of account this will be.
 *
 * REQUIRED AND VISIBLE. The page used to read it from `?as=supplier`
 * and quietly register a buyer when the parameter was absent — so
 * anybody who reached `/register` from anywhere but one specific link
 * got the wrong kind of account without ever being asked. The choice is
 * what decides the endpoint, the stored `accountType`, the permissions
 * and the portal, so it belongs in front of the person making it.
 *
 * RADIO INPUTS, NOT BUTTONS. A radio group is one tab stop with arrow
 * keys between the options, announces "1 of 2" and its own checked
 * state, and cannot be submitted with nothing chosen. Two styled
 * buttons would need every one of those rebuilt by hand.
 */

export type AccountTypeValue = "TRADER" | "SUPPLIER";

export interface AccountTypeLabels {
  legend: string;
  trader: string;
  traderHint: string;
  supplier: string;
  supplierHint: string;
}

export function AccountTypeChoice({
  value,
  onChange,
  labels,
  disabled = false,
}: {
  /** Null until a choice is made — there is no default. */
  value: AccountTypeValue | null;
  onChange: (value: AccountTypeValue) => void;
  labels: AccountTypeLabels;
  disabled?: boolean;
}) {
  const options: {
    value: AccountTypeValue;
    label: string;
    hint: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "TRADER",
      label: labels.trader,
      hint: labels.traderHint,
      icon: <Store className="size-5" aria-hidden />,
    },
    {
      value: "SUPPLIER",
      label: labels.supplier,
      hint: labels.supplierHint,
      icon: <Building2 className="size-5" aria-hidden />,
    },
  ];

  return (
    <fieldset className="flex flex-col gap-2" data-testid="account-type-choice">
      <legend className="px-1 text-sm font-medium text-content">
        {labels.legend}
      </legend>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const checked = value === option.value;

          return (
            <label
              key={option.value}
              className={[
                "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2",
                checked ? "border-secondary bg-background" : "border-line",
                disabled ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              <input
                type="radio"
                name="accountType"
                value={option.value}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                data-testid={`account-type-${option.value}`}
                className="mt-1 border-line-strong"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-content">
                  {option.icon}
                  {option.label}
                </span>
                <span className="text-xs text-content-muted">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
