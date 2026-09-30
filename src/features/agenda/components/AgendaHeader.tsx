import { CalendarDays, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { CreateKind } from "@/components/agenda/agenda-modals";
import { PageHeader } from "@/components/ui-app/PageHeader";
import { Button } from "@/components/ui/button";

export function AgendaHeader({
  isLoading,
  onRefresh,
  onCreate,
  onOpenFilters,
  activeFilterCount = 0,
  canCreate = true,
}: {
  isLoading: boolean;
  onRefresh: () => void;
  onCreate: (kind: CreateKind) => void;
  onOpenFilters: () => void;
  activeFilterCount?: number;
  canCreate?: boolean;
}) {
  return (
    <PageHeader
      title="Agenda"
      description="Organize os atendimentos e acompanhe sua rotina."
      icon={CalendarDays}
      className="mb-0 shrink-0 px-4 py-4 md:px-6"
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Atualizar agenda"
            title="Atualizar agenda"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? "animate-spin" : undefined} />
          </Button>
          <Button variant="outline" onClick={onOpenFilters} className="xl:hidden">
            <SlidersHorizontal />
            Filtros
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {canCreate && (
            <Button onClick={() => onCreate("tarefa")}>
              <Plus />
              <span>Novo agendamento</span>
            </Button>
          )}
        </>
      }
    />
  );
}
