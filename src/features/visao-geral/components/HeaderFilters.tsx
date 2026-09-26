import { useState } from "react";
import { CalendarRange, Plus } from "lucide-react";

export function HeaderFilters({
  period,
  onAddFilter,
}: {
  period: string;
  onAddFilter?: () => void;
}) {
  const [applied, setApplied] = useState(1);
  return (
    <div className="rounded-[14px] border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold leading-[1.35] tracking-[-0.01em] text-foreground">
          Filtros
        </h2>
        <span className="text-sm font-semibold text-muted-foreground">
          {applied} filtro aplicado
        </span>
        <button
          onClick={() => setApplied(0)}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Limpar filtros
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-input">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          Período: <span className="font-normal text-muted-foreground">{period}</span>
        </button>
        <button
          onClick={onAddFilter}
          className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar filtro
        </button>
      </div>
    </div>
  );
}
