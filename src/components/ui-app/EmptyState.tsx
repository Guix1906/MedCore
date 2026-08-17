import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Estado vazio padronizado.
 * Ilustração SVG opcional + texto + CTA opcional.
 */
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
        "rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center",
        className,
      )}
    >
      {illustration}
      {title && <p className="text-sm font-medium text-foreground mt-1">{title}</p>}
      {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
