import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Barra de controles que fica fixa logo abaixo do cabeçalho ao rolar,
 * numa pílula de vidro (uma por tela, como a barra de ferramentas do macOS).
 */
export function StickyToolbar({
  children,
  className,
  innerClassName,
  label,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  label?: string;
}) {
  return (
    <div
      role={label ? "toolbar" : undefined}
      aria-label={label}
      className={cn("pointer-events-none sticky top-[72px] z-10 mb-5 flex", className)}
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-hairline bg-glass p-1 shadow-(--glass-shadow) glass-blur",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
