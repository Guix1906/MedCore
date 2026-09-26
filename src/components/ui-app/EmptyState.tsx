import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export type EmptyStateProps = {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  illustration?: ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  action,
  illustration,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border bg-surface/60 px-5 py-10 text-center",
        className,
      )}
    >
      {illustration && (
        <div
          className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary"
          aria-hidden="true"
        >
          {illustration}
        </div>
      )}
      {title && <p className="text-base font-semibold text-foreground">{title}</p>}
      {description && (
        <div className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
