import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Info, XCircle } from "lucide-react";
import { cn } from "@/utils/cn";

export type StatusTone = "success" | "warning" | "danger" | "info" | "primary" | "neutral";

const toneClass: Record<StatusTone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  info: "border-info/20 bg-info/10 text-info",
  primary: "border-primary/20 bg-primary/10 text-primary",
  neutral: "border-border bg-muted text-muted-foreground",
};

const toneIcon: Record<StatusTone, ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
  primary: Circle,
  neutral: Circle,
};

export type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
  /** Ícone próprio; `false` remove o ícone. Status nunca depende só da cor. */
  icon?: ComponentType<{ className?: string }> | false;
  className?: string;
};

export function StatusBadge({ tone, children, icon, className }: StatusBadgeProps) {
  const Icon = icon === false ? null : (icon ?? toneIcon[tone]);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
