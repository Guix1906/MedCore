import { useEffect, useRef } from "react";
import { CountUp } from "countup.js";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StatNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
  format?: (v: number) => string;
}

/**
 * StatNumber — usa countup.js oficial (fluido, respeitando reduced-motion).
 * Se `format` for informado, aplica formatação custom (ex: BRL).
 */
export function StatNumber({
  value,
  prefix,
  suffix,
  decimals = 0,
  duration = 1.2,
  className,
  format,
}: StatNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const cuRef = useRef<CountUp | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!ref.current) return;
    if (reduce) {
      ref.current.textContent = format
        ? format(value)
        : `${prefix ?? ""}${value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix ?? ""}`;
      return;
    }
    const options = {
      duration,
      decimal: ",",
      separator: ".",
      prefix: prefix ?? "",
      suffix: suffix ?? "",
      decimalPlaces: decimals,
      useEasing: true,
      formattingFn: format,
    };
    if (!cuRef.current) {
      cuRef.current = new CountUp(ref.current, value, options);
      if (!cuRef.current.error) cuRef.current.start();
    } else {
      cuRef.current.update(value);
    }
  }, [value, prefix, suffix, decimals, duration, format, reduce]);

  return <span ref={ref} className={cn("tabular-nums", className)} />;
}

export const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
