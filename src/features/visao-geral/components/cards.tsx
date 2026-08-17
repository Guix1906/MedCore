import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import { StatNumber } from "@/components/ds";
import { cn } from "@/lib/utils";

export const CARD_BASE =
  "rounded-[14px] border border-[#ECEFF5] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all duration-[250ms] hover:-translate-y-[3px] hover:shadow-[0_8px_24px_rgba(16,24,40,0.08)]";

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
      {Icon ? <Icon className="h-[16px] w-[16px] text-[#7C5CFA]" /> : null}
      <span className="text-[17px] font-bold leading-[1.35] tracking-[-0.01em] text-[#1B2A4A]">
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
          className="text-[30px] font-normal leading-none text-[#6B7280]"
        />
        {typeof trend === "number" && (
          <span
            className={cn(
              "flex items-center gap-1 text-[15px] font-semibold",
              up ? "text-[#16b364]" : "text-[#EF4444]",
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
      <TriangleAlert className="h-4 w-4 text-[#F59E0B]" />
      <p className="text-[15px] font-semibold leading-6 tracking-[0.015em] text-[#111827]">
        Não há nada aqui!
      </p>
      <p className="text-[14px] leading-5 text-[#6B7280]">
        Nenhuma venda encontrada para os filtros selecionados
      </p>
    </div>
  );
}
