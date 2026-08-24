import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import AppShell from "@/components/AppShell";
import { useIsMobile } from "@/hooks/use-mobile";
import { TooltipProvider } from "@/components/ui/tooltip";
import { confirmDialog } from "@/components/app/confirm-dialog";
import { SectionCard } from "@/components/ui-app";
import AgendaSidebar, {
  EMPTY_AGENDA_FILTERS,
  type AgendaFilterValues,
} from "@/components/agenda/AgendaSidebar";
import {
  applyAgendaSidebarFilters,
  buildAgendaFilterOptions,
} from "@/features/agenda/lib/sidebar-filters";
import { CreateModalRouter, type CreateKind } from "@/components/agenda/agenda-modals";
import { type Activity, isSameDay } from "@/components/agenda/agenda-types";
import { useAuth } from "@/hooks/use-auth";
import { useActiveCompany } from "@/hooks/use-active-company";
import { useCompanyMembers } from "@/hooks/use-company-members";
import { useClinicCities } from "@/hooks/use-clinic-cities";
import { supabase } from "@/integrations/supabase/client";
import { patientsService } from "@/services/api";
import { qk } from "@/lib/query-keys";

import { useAgendaData } from "@/features/agenda/hooks/use-agenda-data";
import { useAgendaMutations } from "@/features/agenda/hooks/use-agenda-mutations";
import {
  useAgendaFilters,
  type AssignFilter,
  type TypeFilter,
} from "@/features/agenda/hooks/use-agenda-filters";
import { useAgendaDeepLink } from "@/features/agenda/hooks/use-agenda-deep-link";
import { useAgendaKeyboard } from "@/features/agenda/hooks/use-agenda-keyboard";
import { AgendaHeader } from "@/features/agenda/components/AgendaHeader";
import { AgendaFilters, type ViewMode } from "@/features/agenda/components/AgendaFilters";
import { AgendaToolbar, CityFilterDropdown } from "@/features/agenda/components/AgendaToolbar";
import { DailyGrid } from "@/features/agenda/components/DailyGrid";
import { WeeklyGrid } from "@/features/agenda/components/WeeklyGrid";
import { MonthGrid } from "@/features/agenda/components/MonthGrid";
import { ListView } from "@/features/agenda/components/ListView";
import { ActivityDrawer } from "@/features/agenda/components/ActivityDrawer";

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
      { title: "Agenda • ClinicMed" },
      {
        name: "description",
        content:
          "Agenda ClinicMed — tarefas, eventos e prazos em visão diária, semanal, mensal e lista.",
      },
      { property: "og:title", content: "Agenda • ClinicMed" },
      {
        property: "og:description",
        content: "Tarefas, eventos e prazos da clínica em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
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
      return (await supabase.from("patients").select("id, name, insurance").order("name")).data ?? [];
    },
  });

  const isMobile = useIsMobile();
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

  const { activities, isLoading, refresh: refreshData } = useAgendaData(companyId, user?.id);

  const refresh = useCallback(() => {
    refreshData();
    toast.success("Agenda atualizada");
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

  const shiftDay = useCallback((delta: number) => {
    setDate((cur) => {
      const n = new Date(cur);
      n.setDate(n.getDate() + delta);
      return n;
    });
  }, []);
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
        <div className="relative h-[calc(100vh-64px)] max-h-[calc(100vh-64px)] bg-white text-foreground flex flex-col overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 -z-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(700px 350px at 10% -10%, hsl(var(--primary) / 0.08), transparent 60%), radial-gradient(900px 450px at 100% 0%, hsl(var(--primary) / 0.05), transparent 60%)",
            }}
          />

          <div className="relative flex w-full flex-1 items-stretch min-h-0 bg-white overflow-hidden">
            <div className="hidden h-full self-stretch lg:block bg-white z-20 shrink-0">
              <AgendaSidebar
                selectedDate={date}
                filters={sidebarFilters}
                onFiltersChange={setSidebarFilters}
                options={sidebarOptions}
                onNewAppointment={() => setCreateKind("tarefa")}
                onSelectDate={(d) => {
                  const n = new Date(d);
                  n.setHours(date.getHours(), date.getMinutes(), 0, 0);
                  setDate(n);
                }}
              />
            </div>

            <div className="relative min-w-0 flex-1 px-0 pb-0 pt-0 flex flex-col min-h-0 bg-white overflow-hidden">
              <AgendaHeader isLoading={isLoading} onRefresh={refresh} onCreate={handleCreatePick} />

              <div className="flex-1 flex flex-col min-h-0 bg-white">
                <SectionCard className="rounded-none border-x-0 border-b-0 flex-1 flex flex-col min-h-0 bg-white shadow-none">
                  <div className="relative shrink-0">
                    <AgendaToolbar
                      date={date}
                      onSetDate={setDate}
                      onShiftDay={(delta) => {
                        if (view === "semana") {
                          setDate((cur) => {
                            const n = new Date(cur);
                            n.setDate(n.getDate() + delta);
                            return n;
                          });
                        } else {
                          shiftDay(delta);
                        }
                      }}
                      onToday={goToday}
                      draggedRef={draggedRef}
                      onReschedule={handleReschedule}
                      stepDays={view === "semana" ? 7 : 1}
                      search={search}
                      onSearchChange={setSearch}
                      cityFilter={cityFilter}
                      onCityChange={setCityFilter}
                      cities={availableCities}
                      view={view as any}
                      onViewChange={setView as any}
                      onNewAppointment={() => setCreateKind("tarefa")}
                      label={
                        view === "semana"
                          ? formatWeekRange(date)
                          : view === "mes"
                            ? formatMonthLabel(date)
                            : undefined
                      }
                    />
                  </div>

                  {search.trim() !== "" ? (
                    <div className="p-4">
                      <div className="mb-4 flex items-center justify-between rounded-xl bg-purple-50 border border-purple-200 px-4 py-3 text-xs font-semibold text-[#6D5EF8]">
                        <span>🔍 Resultados da busca por "{search}": {finalFiltered.length} agendamento(s) encontrado(s)</span>
                        <button onClick={() => setSearch("")} className="hover:underline text-muted-foreground font-medium">
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
                      onSelectDate={(d) => {
                        setDate(d);
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
                    <MonthGrid
                      date={date}
                      activities={finalFiltered}
                      loading={isLoading}
                      onActivityClick={handleOpenDetails}
                      onSelectDate={(d) => {
                        setDate(d);
                        setView("dia");
                      }}
                      onReschedule={handleReschedule}
                      draggedRef={draggedRef}
                    />
                  ) : (
                    <ListView
                      activities={finalFiltered}
                      loading={isLoading}
                      onActivityClick={handleOpenDetails}
                    />
                  )}
                </SectionCard>
              </div>




            </div>
          </div>

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
