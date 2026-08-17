import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Card de seção principal — bordas arredondadas grandes,
 * shadow suave que escala em hover. Padrão visual usado
 * no calendário, tabelas e painéis principais.
 */
export function SectionCard({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section
      {...rest}
      className={cn(
        "rounded-[2rem] border border-border bg-card backdrop-blur-sm overflow-hidden shadow-soft hover:shadow-elevated transition-all duration-500",
        className,
      )}
    >
      {children}
    </section>
  );
}
