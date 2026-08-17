import { memo } from "react";
import { Check, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type PillOption = { value: string; label: string };

export const PillSelect = memo(function PillSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: PillOption[];
}) {
  const current = options.find((o) => o.value === value)?.label ?? label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-9 px-3.5 rounded-full border border-border bg-card hover:bg-accent hover:border-border text-sm text-foreground inline-flex items-center gap-1.5 transition-colors">
          <span className="text-muted-foreground text-[11px] uppercase tracking-wider">
            {label}:
          </span>{" "}
          {current}
          <ChevronRight className="h-3 w-3 rotate-90 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-muted border-border text-foreground">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => onChange(o.value)}
            className="focus:bg-accent"
          >
            {o.label}
            {o.value === value && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
