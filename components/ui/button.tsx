"use client";

import * as React from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "danger" | "ghost" | "whatsapp";
type Size = "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-glow)] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-55";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dark)] text-white shadow-[var(--shadow-glow-indigo)] hover:from-[var(--color-accent-hover)] hover:to-[var(--color-accent)] hover:shadow-[0_0_30px_-10px_var(--color-accent)] hover:-translate-y-px active:translate-y-0",
  danger:
    "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-500/30 hover:from-red-400 hover:to-red-500 hover:shadow-md hover:-translate-y-px active:translate-y-0",
  ghost:
    "border border-[var(--panel-border-soft)] bg-[var(--color-surface)] text-[var(--color-text-primary)] backdrop-blur-sm hover:bg-[var(--panel-hover)] hover:border-[var(--color-border-card)] active:bg-[var(--color-surface-hover)]",
  whatsapp:
    "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/30 hover:from-emerald-400 hover:to-emerald-500 hover:shadow-md hover:-translate-y-px active:translate-y-0",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-xs",
  md: "h-10 px-5 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}
