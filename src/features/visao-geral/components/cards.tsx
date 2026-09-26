import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import { StatNumber } from "@/components/ds";
import { cn } from "@/lib/utils";

export const CARD_BASE =
  "rounded-[14px] border border-border bg-card p-5 shadow-sm transition-all duration-[250ms] hover:-translate-y-[3px] hover:shadow-sm";

export function DashCard({
  className,
  children,
  delay = 0,
}: {
  className?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(CARD_BASE, className)}
    >
      {children}
    </motion.div>
  );
}

export function CardTitle({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-3.5 flex items-center gap-2">
      {Icon ? <Icon className="h-[16px] w-[16px] text-primary" /> : null}
      <span className="text-lg font-semibold leading-[1.35] tracking-[-0.01em] text-foreground">
        {children}
      </span>
    </div>
  );
}

export function KpiCard({
  title,
  value,
  suffix,
  trend,
  icon,
  delay = 0,
}: {
  title: string;
  value: number;
  suffix?: string;
  trend?: number;
  icon?: LucideIcon;
  delay?: number;
}) {
  const up = (trend ?? 0) >= 0;
  return (
    <DashCard delay={delay}>
      <CardTitle icon={icon}>{title}</CardTitle>
      <div className="flex items-end justify-between gap-3">
        <StatNumber
          value={value}
          suffix={suffix}
          className="text-[28px] font-normal leading-none text-muted-foreground"
        />
        {typeof trend === "number" && (
          <span
            className={cn(
              "flex items-center gap-1 text-[15px] font-semibold",
              up ? "text-success" : "text-destructive",
            )}
          >
            {up ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
    </DashCard>
  );
}

export function EmptyHint() {
  return (
    <div className="flex flex-col items-start gap-1.5 py-3">
      <TriangleAlert className="h-4 w-4 text-warning" />
      <p className="text-[15px] font-semibold leading-6 tracking-[0.015em] text-foreground">
        Não há nada aqui!
      </p>
      <p className="text-sm leading-5 text-muted-foreground">
        Nenhuma venda encontrada para os filtros selecionados
      </p>
    </div>
  );
}
