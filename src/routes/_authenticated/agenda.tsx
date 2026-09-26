import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { addDays, addMonths } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CreateModalRouter, type CreateKind } from "@/components/agenda/agenda-modals";
import { isSameDay, type Activity } from "@/components/agenda/agenda-types";
import AgendaSidebar, {
  EMPTY_AGENDA_FILTERS,
  type AgendaFilterValues,
} from "@/components/agenda/AgendaSidebar";
import { confirmDialog } from "@/components/app/confirm-dialog";
import AppShell from "@/components/AppShell";
import { SectionCard } from "@/components/ui-app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { agendaVisibleIds, filterByAgendaScope } from "@/features/admin/permissions";
import {
  applyAgendaSidebarFilters,
  buildAgendaFilterOptions,
} from "@/features/agenda/lib/sidebar-filters";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useAuth } from "@/hooks/use-auth";
import { useClinicCities } from "@/hooks/use-clinic-cities";
import { useCompanyMembers } from "@/hooks/use-company-members";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { patientsService } from "@/services/api";

import { ActivityDrawer } from "@/features/agenda/components/ActivityDrawer";
import { type ViewMode } from "@/features/agenda/components/AgendaFilters";
import { AgendaHeader } from "@/features/agenda/components/AgendaHeader";
import { AgendaToolbar } from "@/features/agenda/components/AgendaToolbar";
import { DailyGrid } from "@/features/agenda/components/DailyGrid";
import { ListView } from "@/features/agenda/components/ListView";
import { MonthGrid } from "@/features/agenda/components/MonthGrid";
import { WeeklyGrid } from "@/features/agenda/components/WeeklyGrid";
import { useAgendaData } from "@/features/agenda/hooks/use-agenda-data";
import { useAgendaDeepLink } from "@/features/agenda/hooks/use-agenda-deep-link";
import {
  useAgendaFilters,
  type AssignFilter,
  type TypeFilter,
} from "@/features/agenda/hooks/use-agenda-filters";
import { useAgendaKeyboard } from "@/features/agenda/hooks/use-agenda-keyboard";
import { useAgendaMutations } from "@/features/agenda/hooks/use-agenda-mutations";

function formatWeekRange(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short" });
  const yearFmt = new Intl.DateTimeFormat("pt-BR", { year: "numeric" });
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} de ${monthFmt.format(start)} de ${yearFmt.format(start)}`;
  }
  return `${start.getDate()} de ${monthFmt.format(start)} – ${end.getDate()} de ${monthFmt.format(end)} de ${yearFmt.format(end)}`;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda • MedCore" },
      {
        name: "description",
        content:
          "Agenda MedCore — tarefas, eventos e prazos em visão diária, semanal, mensal e lista.",
      },
      { property: "og:title", content: "Agenda • MedCore" },
      {
        property: "og:description",
        content: "Tarefas, eventos e prazos da clínica em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    taskId?: string;
    deadlineId?: string;
    eventId?: string;
    novo?: string | boolean;
    action?: string;
  } => ({
    taskId: (search.taskId as string) || undefined,
    deadlineId: (search.deadlineId as string) || undefined,
    eventId: (search.eventId as string) || undefined,
    novo: (search.novo as string | boolean) || undefined,
    action: (search.action as string) || undefined,
  }),
  component: AgendaPage,
});

function AgendaPage() {
  const { taskId, deadlineId, eventId, novo, action } = Route.useSearch();
  const { user } = useAuth();
  const { companyId } = useActiveCompany();
  const { members, byId } = useCompanyMembers(companyId);
  const { cities: availableCities } = useClinicCities();

  const { data: cases = [] } = useQuery({
    queryKey: qk.casesMini(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (await supabase.from("cases").select("id, title").eq("company_id", companyId!).order("title"))
        .data ?? [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["agenda", "patients-mini"] as const,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const phpPat = await patientsService.getPatients({ limit: 500 });
        if (phpPat && Array.isArray(phpPat)) {
          return phpPat.map((p) => ({
            id: p.id,
            name: p.name,
            insurance: p.insurance || null,
          }));
        }
      } catch {}
      return (
        (await supabase.from("patients").select("id, name, insurance").order("name")).data ?? []
      );
    },
  });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "dia" : "semana",
  );

  const [assignFilter, setAssignFilter] = useState<AssignFilter>("todas");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("todas");
  const [cityFilter, setCityFilter] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });
  const [sidebarFilters, setSidebarFilters] = useState<AgendaFilterValues>(EMPTY_AGENDA_FILTERS);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [createDefault, setCreateDefault] = useState<Date | undefined>();
  const [drawer, setDrawer] = useState<Activity | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "edit">("details");

  const handleOpenDetails = useCallback((a: Activity) => {
    setDrawer(a);
    setDrawerMode("details");
  }, []);

  const handleOpenEdit = useCallback((a: Activity) => {
    setDrawer(a);
    setDrawerMode("edit");
  }, []);
  const draggedRef = useRef<Activity | null>(null);

  const {
    activities: allActivities,
    isLoading,
    isFetching,
    error: agendaError,
    refresh: refreshData,
  } = useAgendaData(companyId, user?.id);
  // Escopo de agenda definido em Administração > Usuários (filtro de exibição).
  const { access, can } = usePermissions();
  const activities = useMemo(
    () =>
      access.mode === "active"
        ? filterByAgendaScope(
            allActivities,
            agendaVisibleIds({
              scope: access.agendaScope,
              ownIds: [user?.id, access.doctorId],
              selectedIds: access.agendaProfessionalIds,
            }),
          )
        : allActivities,
    [allActivities, access, user?.id],
  );

  const refresh = useCallback(() => {
    void refreshData();
  }, [refreshData]);

  const baseFiltered = useAgendaFilters({
    activities,
    typeFilter,
    assignFilter,
    search,
    userId: user?.id,
    memberNameById: byId,
  });

  const sidebarOptions = useMemo(
    () =>
      buildAgendaFilterOptions({
        activities: baseFiltered,
        memberNameById: byId,
        patientNames: patients.map((p) => p.name),
        insuranceNames: patients.map((p) => p.insurance).filter((v): v is string => !!v),
      }),
    [baseFiltered, byId, patients],
  );

  const filtered = useMemo(
    () =>
      applyAgendaSidebarFilters({
        activities: baseFiltered,
        filters: sidebarFilters,
        memberNameById: byId,
      }),
    [baseFiltered, sidebarFilters, byId],
  );

  const finalFiltered = useMemo(() => {
    if (cityFilter === "todas") return filtered;
    const target = cityFilter.toLowerCase();
    return filtered.filter((a) => {
      // Feriados nacionais se aplicam a todas as cidades
      if (a.kind === "feriado") return true;
      if (!a.location) return false;
      return a.location.toLowerCase().includes(target);
    });
  }, [filtered, cityFilter]);

  const dayActivities = useMemo(
    () => finalFiltered.filter((a) => isSameDay(a.start, date)),
    [finalFiltered, date],
  );

  const { complete, remove, reschedule, resize } = useAgendaMutations((a) => {
    refreshData();
    if (a) setDrawer(null);
  });

  useAgendaDeepLink(activities, { taskId, deadlineId, eventId }, setDrawer);

  const shiftDay = useCallback(
    (delta: number) => {
      setDate((current) =>
        view === "mes"
          ? addMonths(current, delta)
          : addDays(current, delta * (view === "semana" ? 7 : 1)),
      );
    },
    [view],
  );
  const goToday = useCallback(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    setDate(d);
  }, []);
  useEffect(() => {
    if (novo || action === "novo") {
      setCreateKind("tarefa");
    }
  }, [novo, action]);

  useAgendaKeyboard({
    onPrev: () => shiftDay(-1),
    onNext: () => shiftDay(1),
    onToday: goToday,
    onNew: () => setCreateKind("tarefa"),
  });

  const handleReschedule = useCallback(
    (a: Activity, newStart: Date) => reschedule.mutate({ a, newStart }),
    [reschedule],
  );
  const handleResize = useCallback(
    (a: Activity, newStart: Date, newEnd: Date) => resize.mutate({ a, newStart, newEnd }),
    [resize],
  );
  const handleSlotClick = useCallback((d: Date) => {
    setCreateDefault(d);
    setCreateKind("tarefa");
  }, []);
  const handleCreatePick = useCallback((k: CreateKind) => {
    setCreateDefault(undefined);
    setCreateKind(k);
  }, []);

  return (
    <AppShell title="Agenda">
      <TooltipProvider delayDuration={200}>
        <div className="flex h-[calc(100dvh-64px)] min-h-0 flex-col text-foreground">
          <AgendaHeader
            isLoading={isFetching}
            onRefresh={refresh}
            onCreate={handleCreatePick}
            onOpenFilters={() => setFiltersOpen(true)}
            activeFilterCount={
              Object.values(sidebarFilters).filter(Boolean).length + Number(cityFilter !== "todas")
            }
            canCreate={can("agenda.manage")}
          />
          {agendaError && (
            <div
              role="alert"
              className="mx-4 mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              Não foi possível atualizar os agendamentos.{" "}
              <button className="font-medium underline" onClick={refresh}>
                Tentar novamente
              </button>
            </div>
          )}
          <div className="mx-3 mb-3 flex min-h-0 flex-1 gap-4 md:mx-5 md:mb-5">
            {/* Em telas largas o calendário e os filtros ficam fixos à esquerda, como no Calendário do macOS. */}
            <aside
              aria-label="Calendário e filtros da agenda"
              className="hidden w-[288px] shrink-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-glass shadow-(--glass-shadow) glass-blur xl:flex"
            >
              <AgendaSidebar
                className="bg-transparent"
                selectedDate={date}
                filters={sidebarFilters}
                onFiltersChange={setSidebarFilters}
                options={sidebarOptions}
                onSelectDate={(next) => {
                  const value = new Date(next);
                  value.setHours(date.getHours(), date.getMinutes(), 0, 0);
                  setDate(value);
                }}
              />
            </aside>
            <SectionCard className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AgendaToolbar
                date={date}
                onSetDate={setDate}
                onShiftDay={shiftDay}
                onToday={goToday}
                draggedRef={draggedRef}
                onReschedule={handleReschedule}
                search={search}
                onSearchChange={setSearch}
                cityFilter={cityFilter}
                onCityChange={setCityFilter}
                cities={availableCities}
                view={view}
                onViewChange={setView}
                label={
                  view === "semana"
                    ? formatWeekRange(date)
                    : view === "mes"
                      ? formatMonthLabel(date)
                      : undefined
                }
              />
              {search.trim() !== "" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary-soft/40 px-4 py-3 text-sm"
                  >
                    <span>
                      {finalFiltered.length} resultado(s) para “{search}” em todas as datas
                    </span>
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="font-medium text-primary hover:underline"
                    >
                      Limpar busca
                    </button>
                  </div>
                  <ListView
                    activities={finalFiltered}
                    loading={isLoading}
                    onActivityClick={handleOpenDetails}
                  />
                </div>
              ) : view === "semana" ? (
                <WeeklyGrid
                  date={date}
                  activities={finalFiltered}
                  loading={isLoading}
                  onActivityClick={handleOpenDetails}
                  onActivityEdit={handleOpenEdit}
                  onSlotClick={handleSlotClick}
                  onReschedule={handleReschedule}
                  onResize={handleResize}
                  draggedRef={draggedRef}
                  onSelectDate={(next) => {
                    setDate(next);
                    setView("dia");
                  }}
                />
              ) : view === "dia" ? (
                <DailyGrid
                  date={date}
                  activities={dayActivities}
                  loading={isLoading}
                  onActivityClick={handleOpenDetails}
                  onActivityEdit={handleOpenEdit}
                  onSlotClick={handleSlotClick}
                  onReschedule={handleReschedule}
                  onResize={handleResize}
                  draggedRef={draggedRef}
                />
              ) : view === "mes" ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <MonthGrid
                    date={date}
                    activities={finalFiltered}
                    loading={isLoading}
                    onActivityClick={handleOpenDetails}
                    onSelectDate={(next) => {
                      setDate(next);
                      setView("dia");
                    }}
                    onReschedule={handleReschedule}
                    draggedRef={draggedRef}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ListView
                    activities={dayActivities}
                    loading={isLoading}
                    onActivityClick={handleOpenDetails}
                  />
                </div>
              )}
            </SectionCard>
          </div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetContent side="left" className="flex w-[min(320px,100vw)] flex-col gap-0 p-0">
              <SheetHeader className="border-b border-border px-5 py-4">
                <SheetTitle>Filtros da agenda</SheetTitle>
                <SheetDescription>Selecione uma data e refine os atendimentos.</SheetDescription>
              </SheetHeader>
              <AgendaSidebar
                selectedDate={date}
                filters={sidebarFilters}
                onFiltersChange={setSidebarFilters}
                options={sidebarOptions}
                onSelectDate={(next) => {
                  const value = new Date(next);
                  value.setHours(date.getHours(), date.getMinutes(), 0, 0);
                  setDate(value);
                }}
              />
            </SheetContent>
          </Sheet>

          <ActivityDrawer
            activity={drawer}
            initialMode={drawerMode}
            onClose={() => setDrawer(null)}
            ownerName={drawer?.assignedTo ? (byId.get(drawer.assignedTo) ?? null) : null}
            onComplete={(a) => complete.mutate(a)}
            onDelete={(a) => {
              confirmDialog({
                title: "Excluir atividade",
                description: "Deseja realmente excluir esta atividade da agenda?",
                confirmText: "Excluir",
              }).then((ok) => {
                if (ok) remove.mutate(a);
              });
            }}
            onSaved={() => {
              refreshData();
              setDrawer(null);
            }}
          />

          <CreateModalRouter
            kind={createKind}
            defaultDate={createDefault}
            ctx={{
              companyId,
              userId: user?.id ?? null,
              cases,
              members,
              onSaved: (createdActivity) => {
                setCreateKind(null);
                refresh();
                if (createdActivity) {
                  setDrawer(createdActivity);
                  setDrawerMode("details");
                }
              },
              onClose: () => setCreateKind(null),
            }}
          />
        </div>
      </TooltipProvider>
    </AppShell>
  );
}
