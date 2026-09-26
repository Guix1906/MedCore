import { CalendarDays, Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import type { CreateKind } from "@/components/agenda/agenda-modals";
import { PageHeader } from "@/components/ui-app/PageHeader";
import { Button } from "@/components/ui/button";
import { wipeAllAppointments } from "@/lib/local-events";
import { toast } from "sonner";

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
  const handleWipeAll = async () => {
    if (
      window.confirm(
        "Deseja realmente excluir todos os agendamentos salvos? Essa ação remove os agendamentos anteriores para iniciar seus testes limpos.",
      )
    ) {
      await wipeAllAppointments();
      onRefresh();
      toast.success("Todos os agendamentos foram excluídos com sucesso.");
    }
  };

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
          <Button
            variant="ghost"
            size="sm"
            onClick={handleWipeAll}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs h-9 px-2.5"
            title="Excluir todos os agendamentos para iniciar do zero"
          >
            <Trash2 className="size-3.5 mr-1" />
            <span>Zerar agendamentos</span>
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
