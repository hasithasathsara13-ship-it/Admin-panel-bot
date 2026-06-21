import * as React from "react";
import { cn } from "../../lib/cn";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-gradient-to-r from-gray-200/60 via-gray-100/40 to-gray-200/60",
        className,
      )}
      {...props}
    />
  );
}
