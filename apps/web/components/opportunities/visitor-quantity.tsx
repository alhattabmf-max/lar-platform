"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/field";

/**
 * The quantity stepper on a public offer page.
 *
 * A VISITOR can set a quantity — the reference shows the control before
 * sign-in, because seeing what an order would look like is part of what
 * persuades someone to register. It submits nothing: the buttons beside
 * it lead to registration and sign-in, and the real purchase path is
 * behind the trader guard where checkout's own lock is the authority on
 * what is actually available.
 *
 * `step` is the offer's minimum order, which is also its increment — one
 * value serves both, so the stepper can never land on a quantity the
 * server would reject for not being a multiple.
 *
 * `max` is `unsoldQuantity`, and it is a CEILING FOR THE INPUT, not a
 * promise: what a later cancellation or refund does to sellable quantity
 * is deferred, so this must not be read as guaranteed availability.
 */
export interface VisitorQuantityProps {
  label: string;
  increaseLabel: string;
  decreaseLabel: string;
  step: number;
  max: number;
}

export function VisitorQuantity({
  label,
  increaseLabel,
  decreaseLabel,
  step,
  max,
}: VisitorQuantityProps) {
  // A zero or negative step would make the control impossible to
  // operate; fall back to one rather than render something inert.
  const increment = step > 0 ? step : 1;
  const [quantity, setQuantity] = useState(increment);
  const id = useId();

  const ceiling = max > 0 ? max : increment;
  const clamp = (value: number) =>
    Math.min(ceiling, Math.max(increment, value));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-sm text-content-muted">
        {label}:
      </label>

      <div className="flex items-center gap-1 rounded-md border border-line">
        <button
          type="button"
          aria-label={decreaseLabel}
          disabled={quantity - increment < increment}
          onClick={() => setQuantity((q) => clamp(q - increment))}
          className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-lg text-content disabled:opacity-[var(--state-disabled-opacity)]"
        >
          −
        </button>

        {/* Read-only: the value only ever moves in whole increments, and
            a free-text box invites a quantity the server must then
            refuse. */}
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          readOnly
          value={quantity}
          // The shared field, narrowed and centred: it sits
          // BETWEEN two buttons, so it drops the rounding and
          // keeps only the dividing edges.
          className="w-16 rounded-none border-x border-y-0 text-center shadow-none"
        />

        <button
          type="button"
          aria-label={increaseLabel}
          disabled={quantity + increment > ceiling}
          onClick={() => setQuantity((q) => clamp(q + increment))}
          className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-lg text-content disabled:opacity-[var(--state-disabled-opacity)]"
        >
          +
        </button>
      </div>
    </div>
  );
}
