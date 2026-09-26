import { Calendar, CalendarDays, CalendarRange, List } from "lucide-react";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";

export type ViewMode = "dia" | "semana" | "mes" | "lista";
const OPTIONS = [
  { value: "dia", label: "Dia", icon: CalendarDays },
  { value: "semana", label: "Semana", icon: CalendarRange },
  { value: "mes", label: "Mês", icon: Calendar },
  { value: "lista", label: "Lista", icon: List },
] as const;

/** Troca de visualização no estilo do Calendário do macOS (Dia · Semana · Mês · Lista). */
export function AgendaFilters({
  view,
  onViewChange,
}: {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}) {
  return (
    <SegmentedControl
      aria-label="Visualização da agenda"
      value={view}
      onChange={onViewChange}
      options={OPTIONS.map(({ value, label, icon: Icon }) => ({
        value,
        label: (
          <>
            <Icon aria-hidden="true" className="hidden sm:block" />
            {label}
          </>
        ),
      }))}
    />
  );
}
