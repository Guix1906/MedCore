import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DSCardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

/**
 * Card — superfície opaca padrão do MedCore (conteúdo nunca usa vidro).
 * `interactive` acrescenta apenas borda/sombra de interação.
 */
export const Card = forwardRef<HTMLDivElement, DSCardProps>(
  ({ className, interactive, padding = "md", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "surface-2 min-w-0",
        interactive && "surface-hover cursor-pointer",
        padding === "sm" && "p-4",
        padding === "md" && "p-5",
        padding === "lg" && "p-6",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "DSCard";

export function CardHeader({
  title,
  subtitle,
  action,
  eyebrow,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="text-eyebrow mb-1.5">{eyebrow}</div> : null}
        <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">
          {title}
        </h3>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

interface KPIProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: { value: number; label?: string };
  icon?: ReactNode;
  accent?: "primary" | "success" | "warning" | "danger" | "info";
  className?: string;
}

const accentTint: Record<NonNullable<KPIProps["accent"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

export function KPICard({
  label,
  value,
  hint,
  trend,
  icon,
  accent = "primary",
  className,
}: KPIProps) {
  const positive = trend ? trend.value >= 0 : false;
  return (
    <Card padding="md" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <div
            className={cn("grid size-8 place-items-center rounded-full", accentTint[accent])}
            aria-hidden="true"
          >
            {icon}
          </div>
        ) : null}
      </div>
      <div className="text-[28px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold",
              positive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
            )}
          >
            <span aria-hidden="true">{positive ? "▲" : "▼"}</span>
            <span className="sr-only">{positive ? "Alta de" : "Queda de"}</span>
            {Math.abs(trend.value).toFixed(1)}%
          </span>
        ) : null}
        {hint}
      </div>
    </Card>
  );
}
