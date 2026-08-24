import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { agendaService } from "@/services/api";
import { qk } from "@/lib/query-keys";
import { mergeWithLocalEvents } from "@/lib/local-events";
import { toActivities, type RawDeadline, type RawEvent, type RawTask } from "../lib/normalize";

const AGENDA_STALE_TIME = 10 * 60_000;
const AGENDA_GC_TIME = 30 * 60_000;

/**
 * Carrega tarefas, eventos e prazos da empresa ativa e assina realtime
 * para invalidar as queries automaticamente. Retorna a lista já
 * normalizada em Activity[] e um refresh manual com cache instantâneo.
 */
export function useAgendaData(
  companyId: string | null | undefined,
  userId: string | null | undefined,
) {
  const qc = useQueryClient();
  const enabled = !!companyId && !!userId;

  const tasksQ = useQuery({
    queryKey: [...qk.agendaLists.tasks(companyId), "all"] as const,
    enabled,
    staleTime: AGENDA_STALE_TIME,
    gcTime: AGENDA_GC_TIME,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const phpTasks = await agendaService.getTasks();
        if (phpTasks && Array.isArray(phpTasks)) {
          return phpTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description || null,
            due_date: t.due_date || null,
            priority: t.priority,
            status: t.status,
            assigned_to: t.assigned_to || null,
            case_id: null,
          })) as RawTask[];
        }
      } catch {}

      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, title, description, due_date, priority, status, assigned_to, case_id",
        )
        .eq("company_id", companyId!);
      if (error) throw error;
      return (data ?? []) as RawTask[];
    },
  });

  const eventsQ = useQuery({
    queryKey: [...qk.agendaLists.events(companyId), "all"] as const,
    enabled,
    staleTime: AGENDA_STALE_TIME,
    gcTime: AGENDA_GC_TIME,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let rawList: RawEvent[] = [];
      try {
        const phpEvents = await agendaService.getEvents();
        if (phpEvents && Array.isArray(phpEvents)) {
          rawList = phpEvents.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description || null,
            event_type: (e.event_type as any) || "meeting",
            starts_at: e.start_time,
            ends_at: e.end_time || null,
            location: e.location || null,
            assigned_to: (e as any).assigned_to || null,
            case_id: null,
          })) as RawEvent[];
        }
      } catch {}

      if (rawList.length === 0) {
        try {
          const { data } = await supabase
            .from("events")
            .select(
              "id, title, description, event_type, starts_at, ends_at, location, assigned_to, case_id",
            )
            .eq("company_id", companyId!);
          rawList = (data ?? []) as RawEvent[];
        } catch {}
      }

      return mergeWithLocalEvents(rawList, companyId);
    },
  });

  const deadlinesQ = useQuery({
    queryKey: [...qk.agendaLists.deadlines(companyId), "all"] as const,
    enabled,
    staleTime: AGENDA_STALE_TIME,
    gcTime: AGENDA_GC_TIME,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const phpDeads = await agendaService.getDeadlines();
        if (phpDeads && Array.isArray(phpDeads)) {
          return phpDeads.map((d) => ({
            id: d.id,
            title: d.title,
            description: d.description || null,
            due_date: d.due_date,
            status: d.status,
            assigned_to: (d as any).assigned_to || null,
            case_id: null,
            is_double_term: false,
          })) as RawDeadline[];
        }
      } catch {}

      const { data, error } = await supabase
        .from("deadlines")
        .select("id, title, description, due_date, status, assigned_to, case_id, is_double_term")
        .eq("company_id", companyId!);
      if (error) throw error;
      return (data ?? []) as RawDeadline[];
    },
  });

  useEffect(() => {
    if (!companyId || !userId) return;
    const invTasks = () =>
      qc.invalidateQueries({ queryKey: [...qk.agendaLists.tasks(companyId), "all"] });
    const invEvents = () =>
      qc.invalidateQueries({ queryKey: [...qk.agendaLists.events(companyId), "all"] });
    const invDeads = () =>
      qc.invalidateQueries({ queryKey: [...qk.agendaLists.deadlines(companyId), "all"] });

    window.addEventListener("medcore_events_updated", invEvents);

    const ch = supabase
      .channel(`agenda-${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `company_id=eq.${companyId}` },
        invTasks,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events", filter: `company_id=eq.${companyId}` },
        invEvents,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deadlines", filter: `company_id=eq.${companyId}` },
        invDeads,
      )
      .subscribe();
    return () => {
      window.removeEventListener("medcore_events_updated", invEvents);
      supabase.removeChannel(ch);
    };
  }, [companyId, userId, qc]);

  const activities = useMemo(
    () =>
      toActivities({
        tasks: tasksQ.data ?? [],
        events: eventsQ.data ?? [],
        deadlines: deadlinesQ.data ?? [],
      }),
    [tasksQ.data, eventsQ.data, deadlinesQ.data],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [...qk.agendaLists.tasks(companyId), "all"] });
    qc.invalidateQueries({ queryKey: [...qk.agendaLists.events(companyId), "all"] });
    qc.invalidateQueries({ queryKey: [...qk.agendaLists.deadlines(companyId), "all"] });
  };

  return {
    activities,
    isLoading: (tasksQ.isLoading && !tasksQ.data) || (eventsQ.isLoading && !eventsQ.data) || (deadlinesQ.isLoading && !deadlinesQ.data),
    refresh,
  };
}
