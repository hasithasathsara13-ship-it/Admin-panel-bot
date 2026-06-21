import * as React from "react";
import { cn } from "../../lib/cn";

type Variant =
  | "pending"
  | "delivered"
  | "featured"
  | "outOfStock"
  | "neutral";

const variants: Record<Variant, string> = {
  pending: "bg-[var(--color-warning-light)] text-[var(--color-warning)] ring-[var(--color-border-card)] shadow-sm",
  delivered: "bg-[var(--color-success-light)] text-[var(--color-success)] ring-[var(--color-border-card)] shadow-sm",
  featured: "bg-[var(--color-accent-light)] text-[var(--color-accent)] ring-[var(--color-border-card)] shadow-sm",
  outOfStock: "bg-[var(--color-danger-light)] text-[var(--color-danger)] ring-[var(--color-border-card)] shadow-sm",
  neutral: "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] ring-[var(--color-border-card)] shadow-sm",
};

export function Badge({
  className,
  variant = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
