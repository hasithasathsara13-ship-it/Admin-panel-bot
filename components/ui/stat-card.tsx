import * as React from "react";
import { Card } from "./card";
import { cn } from "../../lib/cn";

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "zinc",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: "emerald" | "amber" | "sky" | "violet" | "zinc";
  className?: string;
}) {
  const accentMap: Record<typeof accent, string> = {
    zinc: "from-[var(--color-surface-hover)] via-transparent to-transparent",
    emerald: "from-[var(--color-success-light)] via-transparent to-transparent",
    amber: "from-[var(--color-warning-light)] via-transparent to-transparent",
    sky: "from-[var(--color-accent-light)] via-transparent to-transparent",
    violet: "from-[var(--color-accent-light)] via-transparent to-transparent",
  };

  const iconAccentMap: Record<typeof accent, string> = {
    zinc: "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] ring-[var(--color-border-card)]",
    emerald: "bg-[var(--color-success-light)] text-[var(--color-success)] ring-[var(--color-border-card)]",
    amber: "bg-[var(--color-warning-light)] text-[var(--color-warning)] ring-[var(--color-border-card)]",
    sky: "bg-[var(--color-accent-light)] text-[var(--color-accent)] ring-[var(--color-border-card)]",
    violet: "bg-[var(--color-accent-light)] text-[var(--color-accent)] ring-[var(--color-border-card)]",
  };

  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-300 will-change-transform hover:-translate-y-1 hover:shadow-[var(--shadow-card-hover)]",
        className,
      )}
    >
      {/* Gradient overlay */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90",
          accentMap[accent],
        )}
      />
      {/* Top light reflection */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-text-tertiary)]/30 to-transparent" />
      <div className="relative p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              {label}
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {value}
            </div>
            {hint ? <div className="mt-1.5 text-xs font-medium text-[var(--color-text-secondary)]">{hint}</div> : null}
          </div>
          {icon ? (
            <div className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset backdrop-blur-sm transition-transform duration-300 group-hover:scale-110",
              iconAccentMap[accent],
            )}>
              {icon}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
