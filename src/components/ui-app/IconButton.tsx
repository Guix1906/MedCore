import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

/**
 * Botão quadrado de ícone (9×9) com borda e opcional tooltip.
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
      {...rest}
      className={cn(
        "h-9 w-9 grid place-items-center rounded-md border border-border bg-card hover:bg-accent hover:border-border text-foreground transition-colors",
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
