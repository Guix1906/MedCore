import { useEffect, useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getBrazilianHolidays } from "@/lib/holidays";
import { isSameDay } from "@/components/agenda/agenda-types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
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

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly string[];
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs"
      >
        <option value="">Todos</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function AgendaSidebar({
  selectedDate,
  onSelectDate,
  filters: filtersProp,
  onFiltersChange,
  options,
  className,
}: {
  className?: string;
  selectedDate?: Date;
  onSelectDate?: (date: Date) => void;
  filters?: AgendaFilterValues;
  onFiltersChange?: (filters: AgendaFilterValues) => void;
  options?: Partial<AgendaFilterOptions>;
} = {}) {
  const [internalSelected, setInternalSelected] = useState(() => selectedDate ?? new Date());
  const selected = selectedDate ?? internalSelected;
  const [month, setMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const [internalFilters, setInternalFilters] = useState<AgendaFilterValues>(EMPTY_AGENDA_FILTERS);
  const filters = filtersProp ?? internalFilters;
  useEffect(() => {
    if (selectedDate) setMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedDate]);
  const holidays = useMemo(() => getBrazilianHolidays(month.getFullYear()), [month]);
  const cells = Array.from(
    { length: 42 },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index - month.getDay() + 1),
  );
  const activeCount = Object.values(filters).filter(Boolean).length;
  const apply = (next: AgendaFilterValues) => {
    setInternalFilters(next);
    onFiltersChange?.(next);
  };
  const filterLabels: { key: FilterKey; label: string }[] = [
    { key: "status", label: "Status" },
    { key: "profissional", label: "Profissional" },
    { key: "paciente", label: "Paciente" },
    { key: "procedimento", label: "Tipo de atividade" },
    { key: "sala", label: "Local de atendimento" },
    { key: "convenio", label: "Convênio" },
  ];
  return (
    <div
      className={cn(
        "agenda-sidebar-scroll min-h-0 w-full flex-1 overflow-y-auto bg-card",
        className,
      )}
    >
      <div className="border-b border-hairline p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Mês anterior"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="text-sm font-semibold capitalize">
            {month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </p>
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Próximo mês"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {WEEKDAYS.map((day) => (
            <span key={day} className="pb-1 text-center text-xs text-muted-foreground">
              {day}
            </span>
          ))}
          {cells.map((date) => {
            const active = isSameDay(date, selected);
            const holiday = holidays.find((item) => isSameDay(item.date, date));
            return (
              <button
                key={date.toISOString()}
                type="button"
                aria-pressed={active}
                aria-label={`${date.toLocaleDateString("pt-BR", { dateStyle: "full" })}${holiday ? `, ${holiday.title}` : ""}`}
                title={holiday?.title}
                onClick={() => {
                  setInternalSelected(date);
                  onSelectDate?.(date);
                }}
                className={cn(
                  "relative mx-auto flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                  active
                    ? "bg-primary font-semibold text-primary-foreground"
                    : date.getMonth() !== month.getMonth()
                      ? "text-muted-foreground hover:bg-foreground/[0.06]"
                      : "text-foreground hover:bg-foreground/[0.06]",
                  !active && isSameDay(date, new Date()) && "font-semibold text-primary",
                )}
              >
                {date.getDate()}
                {holiday && !active && (
                  <span className="absolute bottom-1 size-1 rounded-full bg-success" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Refinar agenda{activeCount > 0 ? ` (${activeCount})` : ""}
          </h3>
          <button
            type="button"
            disabled={!activeCount}
            onClick={() => apply(EMPTY_AGENDA_FILTERS)}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-40"
          >
            Limpar
          </button>
        </div>
        {filterLabels.map(({ key, label }) => (
          <FilterSelect
            key={key}
            label={label}
            value={filters[key]}
            options={options?.[key] ?? []}
            onChange={(value) => apply({ ...filters, [key]: value })}
          />
        ))}
      </div>
    </div>
  );
}
