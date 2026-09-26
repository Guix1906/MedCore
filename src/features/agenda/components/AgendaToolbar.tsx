import type { DragEvent, MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, MapPin, Search, X } from "lucide-react";
import { addDays, addMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateLong, type Activity } from "@/components/agenda/agenda-types";
import { toLocalDateInputValue } from "@/lib/date-utils";
import { AgendaFilters, type ViewMode } from "./AgendaFilters";

export function CityFilterDropdown({
  cityFilter,
  onCityChange,
  cities,
}: {
  cityFilter: string;
  onCityChange: (value: string) => void;
  cities: string[];
}) {
  return (
    <label className="flex h-10 max-w-full items-center gap-2 rounded-full border border-input bg-card px-3 text-sm shadow-xs">
      <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Cidade de atendimento</span>
      <select
        value={cityFilter}
        onChange={(event) => onCityChange(event.target.value)}
        className="min-w-0 max-w-[170px] bg-transparent py-1 text-foreground"
      >
        <option value="todas">Todas as cidades</option>
        {cities.map((city) => (
          <option key={city} value={city}>
            {city}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AgendaToolbar({
  date,
  onSetDate,
  onShiftDay,
  onToday,
  draggedRef,
  onReschedule,
  label,
  search = "",
  onSearchChange,
  cityFilter,
  onCityChange,
  cities,
  view,
  onViewChange,
}: {
  date: Date;
  onSetDate: (date: Date) => void;
  onShiftDay: (direction: number) => void;
  onToday: () => void;
  draggedRef: MutableRefObject<Activity | null>;
  onReschedule: (activity: Activity, newStart: Date) => void;
  label?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  cityFilter?: string;
  onCityChange?: (value: string) => void;
  cities?: string[];
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}) {
  const drop = (direction: number) => (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.classList.remove("bg-primary/20");
    const activity = draggedRef.current;
    if (!activity) return;
    const next =
      view === "mes"
        ? addMonths(activity.start, direction)
        : addDays(activity.start, direction * (view === "semana" ? 7 : 1));
    onReschedule(activity, next);
    draggedRef.current = null;
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-glass-strong p-3 glass-blur md:px-5">
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <Button variant="outline" onClick={onToday} className="mr-1">
          Hoje
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            view === "mes" ? "Mês anterior" : view === "semana" ? "Semana anterior" : "Dia anterior"
          }
          onClick={() => onShiftDay(-1)}
          onDragOver={(event) => {
            if (draggedRef.current) {
              event.preventDefault();
              event.currentTarget.classList.add("bg-primary/20");
            }
          }}
          onDragLeave={(event) => event.currentTarget.classList.remove("bg-primary/20")}
          onDrop={drop(-1)}
        >
          <ChevronLeft />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="min-w-0 rounded-full px-2 py-2 text-left text-[15px] font-semibold text-foreground hover:bg-foreground/[0.05] md:px-3"
              aria-label="Escolher data"
            >
              <span className="block leading-snug">{label ?? formatDateLong(date)}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2">
            <label htmlFor="agenda-date" className="text-sm font-medium">
              Ir para a data
            </label>
            <Input
              id="agenda-date"
              type="date"
              value={toLocalDateInputValue(date)}
              onChange={(event) => {
                if (!event.target.value) return;
                const [year, month, day] = event.target.value.split("-").map(Number);
                const next = new Date(date);
                next.setFullYear(year, month - 1, day);
                onSetDate(next);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            view === "mes" ? "Próximo mês" : view === "semana" ? "Próxima semana" : "Próximo dia"
          }
          onClick={() => onShiftDay(1)}
          onDragOver={(event) => {
            if (draggedRef.current) {
              event.preventDefault();
              event.currentTarget.classList.add("bg-primary/20");
            }
          }}
          onDragLeave={(event) => event.currentTarget.classList.remove("bg-primary/20")}
          onDrop={drop(1)}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 xl:w-auto">
        {onSearchChange && (
          <div className="relative min-w-[160px] flex-1 xl:w-64">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Buscar na agenda"
              placeholder="Paciente, profissional ou título"
              className="rounded-full pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Limpar busca"
                className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {cityFilter !== undefined && onCityChange && cities && cities.length > 0 && (
          <CityFilterDropdown cityFilter={cityFilter} onCityChange={onCityChange} cities={cities} />
        )}
        <AgendaFilters view={view} onViewChange={onViewChange} />
      </div>
    </div>
  );
}
