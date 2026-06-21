import * as React from "react";
import { cn } from "../../lib/cn";

export function TableShell({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn("min-w-full text-left text-sm", className)} {...props} />
  );
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-5 py-3.5 text-[var(--color-text-primary)]", className)}
      {...props}
    />
  );
}
