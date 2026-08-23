import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
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
      const { data, error } = await supabase
        .from("events")
        .select(
          "id, title, description, event_type, starts_at, ends_at, location, assigned_to, case_id",
        )
        .eq("company_id", companyId!);
      if (error) throw error;
      return (data ?? []) as RawEvent[];
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
