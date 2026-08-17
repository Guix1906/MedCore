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
    <div className="rounded-[14px] border border-[#ECEFF5] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[18px] font-bold leading-[1.35] tracking-[-0.01em] text-[#1B2A4A]">
          Filtros
        </h2>
        <span className="text-[14px] font-semibold text-[#6B7280]">{applied} filtro aplicado</span>
        <button
          onClick={() => setApplied(0)}
          className="text-[14px] font-semibold text-[#7C5CFA] hover:underline"
        >
          Limpar filtros
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="flex items-center gap-2 rounded-lg border border-[#ECEFF5] bg-white px-3 py-2 text-[14.5px] font-semibold text-[#111827] transition-colors hover:border-[#D6D9E3]">
          <CalendarRange className="h-3.5 w-3.5 text-[#6B7280]" />
          Período: <span className="font-normal text-[#6B7280]">{period}</span>
        </button>
        <button
          onClick={onAddFilter}
          className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[14.5px] font-semibold text-[#7C5CFA] hover:bg-[#F5F3FF]"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar filtro
        </button>
      </div>
    </div>
  );
}
