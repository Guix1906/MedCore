import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { getBrazilianHolidays } from "@/lib/holidays";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export const AGENDA_FILTER_KEYS = [
  "status",
  "profissional",
  "paciente",
  "procedimento",
  "sala",
  "convenio",
  "tipoConsulta",
] as const;

export type FilterKey = (typeof AGENDA_FILTER_KEYS)[number];
export type AgendaFilterValues = Record<FilterKey, string | null>;
export type AgendaFilterOptions = Record<FilterKey, string[]>;

export const EMPTY_AGENDA_FILTERS: AgendaFilterValues = {
  status: null,
  profissional: null,
  paciente: null,
  procedimento: null,
  sala: null,
  convenio: null,
  tipoConsulta: null,
};

function buildMonthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: { day: number; muted: boolean; date: Date }[] = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    cells.push({ day: d, muted: true, date: new Date(year, month - 1, d) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, muted: false, date: new Date(year, month, d) });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push({ day: nextDay, muted: true, date: new Date(year, month + 1, nextDay) });
    nextDay++;
    if (cells.length >= 42) break;
  }
  return cells;
}

function FilterSelect({
  label,
  placeholder = "Todos",
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string | null;
  options: readonly string[];
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="space-y-1.5" ref={ref}>
      <label className="text-[15px] font-medium text-neutral-800 block mb-1">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full h-9 px-3 rounded-lg bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 text-left text-[14px] text-neutral-800 flex items-center justify-between transition-colors font-normal"
        >
          <span className="truncate">{value ?? placeholder}</span>
          <ChevronDown className="h-4 w-4 text-neutral-400 shrink-0 ml-1" />
        </button>

        {open && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white rounded-lg border border-neutral-200 shadow-lg py-1 max-h-56 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-[14px] text-neutral-700 hover:bg-neutral-100 flex items-center justify-between"
            >
              <span>{placeholder}</span>
              {!value && <Check className="h-3.5 w-3.5 text-[#6C4CF7]" />}
            </button>
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-[14px] text-neutral-700 hover:bg-neutral-100 flex items-center justify-between"
              >
                <span className="truncate">{opt}</span>
                {value === opt && <Check className="h-3.5 w-3.5 text-[#6C4CF7]" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgendaSidebar({
  selectedDate,
  onSelectDate,
  filters: filtersProp,
  onFiltersChange,
  options,
  onNewAppointment,
}: {
  selectedDate?: Date;
  onSelectDate?: (d: Date) => void;
  filters?: AgendaFilterValues;
  onFiltersChange?: (f: AgendaFilterValues) => void;
  options?: Partial<AgendaFilterOptions>;
  onNewAppointment?: () => void;
} = {}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState((selectedDate ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState((selectedDate ?? today).getMonth());
  const [internalSelected, setInternalSelected] = useState(new Date(selectedDate ?? today));
  const selected = selectedDate ?? internalSelected;
  const [internalFilters, setInternalFilters] = useState<AgendaFilterValues>(EMPTY_AGENDA_FILTERS);
  const filters = filtersProp ?? internalFilters;
  const opt = (k: FilterKey) => options?.[k] ?? [];

  useEffect(() => {
    if (!selectedDate) return;
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
  }, [selectedDate]);

  const handleSelect = (d: Date) => {
    setInternalSelected(d);
    onSelectDate?.(d);
  };

  const cells = buildMonthMatrix(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else setViewMonth(viewMonth + 1);
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const activeCount = Object.values(filters).filter(Boolean).length;

  const apply = (next: AgendaFilterValues) => {
    setInternalFilters(next);
    onFiltersChange?.(next);
  };

  const setFilter = (k: FilterKey) => (v: string | null) => {
    apply({ ...filters, [k]: v });
  };

  const clearAll = () => {
    apply(EMPTY_AGENDA_FILTERS);
    toast.success("Filtros limpos");
  };

  const yearHolidays = useMemo(() => getBrazilianHolidays(viewYear), [viewYear]);

  return (
    <aside className="agenda-sidebar-scroll w-[310px] shrink-0 h-full overflow-y-auto bg-white border-r border-slate-200 shadow-xs">
      {/* Botão Novo Agendamento */}
      {onNewAppointment && (
        <div className="p-3.5 border-b border-neutral-100 bg-gradient-to-b from-purple-50/40 to-transparent">
          <button
            type="button"
            onClick={onNewAppointment}
            className="w-full h-11 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[14px] font-bold flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all cursor-pointer select-none"
          >
            <Plus size={18} strokeWidth={2.5} />
            <span>+ Novo Agendamento</span>
          </button>
        </div>
      )}

      {/* Mini calendar */}
      <div className="px-4 pt-4 pb-4 border-b border-neutral-200">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={prevMonth}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-600 hover:bg-neutral-100 transition-colors"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4.5 w-4.5" />
          </button>
          <div className="text-[15px] font-medium text-neutral-800 capitalize tracking-tight">
            {MONTHS[viewMonth]} de {viewYear}
          </div>
          <button
            onClick={nextMonth}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-600 hover:bg-neutral-100 transition-colors"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-y-1">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="text-center text-[12.5px] font-medium text-neutral-500 pb-1">
              {d}
            </div>
          ))}
          {cells.map((c, i) => {
            const active = isSameDay(c.date, selected) && !c.muted;
            const holiday = !c.muted
              ? yearHolidays.find((h) => isSameDay(h.date, c.date))
              : null;
            return (
              <button
                key={i}
                onClick={() => handleSelect(c.date)}
                title={holiday ? `🇧🇷 Feriado: ${holiday.title}` : undefined}
                className={[
                  "relative h-7.5 w-7.5 mx-auto text-[12px] rounded-full flex items-center justify-center transition-colors cursor-pointer select-none",
                  active
                    ? "bg-[#6C4CF7] text-white font-semibold shadow-md scale-105"
                    : c.muted
                      ? "text-neutral-300 font-normal"
                      : holiday
                        ? "text-emerald-700 font-semibold bg-emerald-50 hover:bg-emerald-100"
                        : "text-neutral-800 font-medium hover:bg-neutral-100",
                ].join(" ")}
              >
                {c.day}
                {holiday && !active && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="p-5 space-y-4.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[16.5px] font-extrabold text-neutral-900 tracking-tight">
            Filtros
            {activeCount > 0 && (
              <span className="ml-2 text-[13px] font-bold text-[#6C4CF7]">({activeCount})</span>
            )}
          </h3>
          <button
            onClick={clearAll}
            disabled={activeCount === 0}
            className="text-[14px] font-bold text-[#6C4CF7] hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer"
          >
            Limpar filtros
          </button>
        </div>

        <FilterSelect
          label="Status"
          value={filters.status}
          options={opt("status")}
          onChange={setFilter("status")}
        />
        <FilterSelect
          label="Profissional"
          value={filters.profissional}
          options={opt("profissional")}
          onChange={setFilter("profissional")}
        />
        <FilterSelect
          label="Paciente"
          value={filters.paciente}
          options={opt("paciente")}
          onChange={setFilter("paciente")}
        />
        <FilterSelect
          label="Procedimento"
          value={filters.procedimento}
          options={opt("procedimento")}
          onChange={setFilter("procedimento")}
        />
        <FilterSelect
          label="Sala de atendimento"
          placeholder="Todas"
          value={filters.sala}
          options={opt("sala")}
          onChange={setFilter("sala")}
        />
      </div>
    </aside>
  );
}
