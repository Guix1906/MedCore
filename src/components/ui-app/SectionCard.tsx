import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

export function SectionCard({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section
      {...rest}
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs",
        className,
      )}
    >
      {children}
    </section>
  );
}
