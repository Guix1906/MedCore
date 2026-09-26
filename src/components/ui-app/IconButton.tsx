import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

/**
 * Botão circular de ícone (40 px) com borda e tooltip opcional.
 * Padrão usado nos headers de página para ações secundárias.
 */
export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { tooltip, tooltipSide = "bottom", className, children, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      aria-label={rest["aria-label"] ?? tooltip}
      {...rest}
      className={cn(
        "grid size-10 place-items-center rounded-full border border-border bg-card text-foreground shadow-xs transition-colors hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
});
