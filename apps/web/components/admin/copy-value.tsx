"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A value worth copying, and a small button that copies it.
 *
 * EMAIL ADDRESSES ARE LEFT-TO-RIGHT, ALWAYS. In an Arabic table the
 * paragraph direction is RTL, and an address dropped into it renders
 * with its parts reordered — `info@future-solutions.sa` can come out
 * reading as though the domain came first. `dir="ltr"` on the value
 * fixes the address itself while the cell around it stays in the page's
 * direction, which is the only arrangement where both read correctly.
 *
 * IT WRAPS AT THE SEPARATORS. `break-all` would split a domain
 * mid-word; `break-word` with a zero-width opportunity after `@` and
 * `.` lets a long address fold where a reader would fold it.
 *
 * THE BUTTON IS SMALL ON PURPOSE. The requirement was a copy control,
 * not a cell that grows into a block — so it is an icon at text size,
 * named for a screen reader, and it confirms in place rather than
 * raising a toast for something this small.
 */
export function CopyValue({
  value,
  copyLabel,
  copiedLabel,
  testId,
}: {
  value: string;
  /** Names the button, e.g. "Copy the email address". */
  copyLabel: string;
  copiedLabel: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span
        dir="ltr"
        className="min-w-0 break-words text-start"
        data-testid={testId}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            // Long enough to be read, short enough that the row does
            // not sit in a changed state after the reader moved on.
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // A browser that refuses clipboard access leaves the value
            // on screen to select by hand. Nothing is lost, and an
            // error dialog for a copy button would be worse than none.
          }
        }}
        // The state IS the label: a reader who cannot see the tick
        // still hears that it worked.
        aria-label={copied ? copiedLabel : copyLabel}
        data-testid={testId ? `${testId}-copy` : undefined}
        className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-content-muted hover:bg-background hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {copied ? (
          <Check className="size-3.5 text-success" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </span>
  );
}
