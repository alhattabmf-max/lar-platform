import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Table shell.
 *
 * The wrapper scrolls horizontally on its own (`overflow-x-auto`) and is
 * focusable with `tabIndex={0}`, so a keyboard user can reach and scroll
 * a wide table — without this, table content past the viewport edge is
 * unreachable without a mouse. The page body itself never scrolls
 * horizontally, which is what keeps 360px viable.
 *
 * `caption` is required: an unnamed data table is unusable with a screen
 * reader. Callers pass a translated string.
 */
export interface TableProps {
  caption: ReactNode;
  /** Visually hide the caption while keeping it for assistive tech. */
  captionHidden?: boolean;
  children: ReactNode;
  className?: string;
}

export function Table({ caption, captionHidden = true, children, className }: TableProps) {
  return (
    <div
      tabIndex={0}
      role="group"
      className="w-full overflow-x-auto rounded-lg border border-line bg-surface"
    >
      <table className={cn("w-full border-collapse text-sm", className)}>
        <caption className={cn(captionHidden ? "sr-only" : "px-4 py-3 text-start text-content-muted")}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-background">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line last:border-b-0">{children}</tr>;
}

export function TH({ children, scope = "col" }: { children: ReactNode; scope?: "col" | "row" }) {
  return (
    <th scope={scope} className="px-4 py-2.5 text-start font-semibold text-content">
      {children}
    </th>
  );
}

export function TD({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2.5 text-start text-content", className)}>{children}</td>;
}
