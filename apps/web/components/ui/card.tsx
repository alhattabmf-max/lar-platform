import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Renders as <section> with an accessible name when provided. */
  ariaLabel?: string;
}

export function Card({ children, className, ariaLabel }: CardProps) {
  const Tag = ariaLabel ? "section" : "div";
  return (
    <Tag
      aria-label={ariaLabel}
      className={cn("rounded-lg border border-line bg-surface shadow-sm", className)}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-b border-line px-4 py-3", className)}>{children}</div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-base font-semibold text-content", className)}>{children}</h2>;
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-t border-line px-4 py-3", className)}>{children}</div>;
}
