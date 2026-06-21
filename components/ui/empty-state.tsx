"use client";

import * as React from "react";
import { Card } from "./card";
import { Button } from "./button";
import { cn } from "../../lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("p-12", className)}>
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        {icon ? (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent-light)] to-transparent text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-border-card)] shadow-sm">
            {icon}
          </div>
        ) : null}
        <div className="mt-5 text-base font-semibold text-[var(--color-text-primary)]">{title}</div>
        {description ? (
          <div className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{description}</div>
        ) : null}
        {actionLabel ? (
          <div className="mt-7">
            <Button
              variant="primary"
              onClick={onAction}
              disabled={!onAction}
            >
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
