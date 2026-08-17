import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DSCardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: "sm" | "md" | "lg";
}

/**
 * Card — primitivo padronizado do design system MedCore.
 * `interactive` ativa hover-lift sutil.
 */
export const Card = forwardRef<HTMLDivElement, DSCardProps>(
  ({ className, interactive, padding = "md", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "surface-2",
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
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        {eyebrow ? <div className="text-eyebrow mb-1.5">{eyebrow}</div> : null}
        <h3 className="text-[15px] font-semibold text-foreground leading-tight truncate">
          {title}
        </h3>
        {subtitle ? <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
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
}

const accentBg: Record<NonNullable<KPIProps["accent"]>, string> = {
  primary: "bg-[color-mix(in_oklab,#6d3ff5_10%,transparent)] text-primary",
  success: "bg-[color-mix(in_oklab,#16b364_12%,transparent)] text-[#16b364]",
  warning: "bg-[color-mix(in_oklab,#f59e0b_14%,transparent)] text-[#b45309]",
  danger: "bg-[color-mix(in_oklab,#ef3e5c_12%,transparent)] text-[#c62b48]",
  info: "bg-[color-mix(in_oklab,#2986ff_12%,transparent)] text-[#2986ff]",
};

export function KPICard({ label, value, hint, trend, icon, accent = "primary" }: KPIProps) {
  const positive = trend ? trend.value >= 0 : false;
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <div className={cn("grid place-items-center h-8 w-8 rounded-lg", accentBg[accent])}>
            {icon}
          </div>
        ) : null}
      </div>
      <div className="text-[26px] font-semibold text-foreground leading-none tabular-nums">
        {value}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              positive
                ? "bg-[color-mix(in_oklab,#16b364_12%,transparent)] text-[#0f8a4a]"
                : "bg-[color-mix(in_oklab,#ef3e5c_12%,transparent)] text-[#c62b48]",
            )}
          >
            {positive ? "▲" : "▼"} {Math.abs(trend.value).toFixed(1)}%
          </span>
        ) : null}
        {hint}
      </div>
    </Card>
  );
}
