import { useEffect, useRef } from "react";
import type { Activity } from "@/components/agenda/agenda-types";

/**
 * Consome uma única vez os parâmetros de busca `?taskId`, `?deadlineId` ou
 * `?eventId` (deep-link vindo do dashboard) e abre o drawer da atividade.
 */
export function useAgendaDeepLink(
  activities: Activity[],
  params: { taskId?: string; deadlineId?: string; eventId?: string },
  openDrawer: (a: Activity) => void,
) {
  const consumedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${params.taskId ?? ""}|${params.deadlineId ?? ""}|${params.eventId ?? ""}`;
    if (key === "||") return;
    if (consumedRef.current === key) return;
    if (activities.length === 0) return;

    let found: Activity | undefined;
    if (params.taskId) found = activities.find((a) => a.id === `task:${params.taskId}`);
    else if (params.deadlineId)
      found = activities.find((a) => a.id === `deadline:${params.deadlineId}`);
    else if (params.eventId) found = activities.find((a) => a.id === `event:${params.eventId}`);
    if (found) {
      openDrawer(found);
      consumedRef.current = key;
    }
  }, [params.taskId, params.deadlineId, params.eventId, activities, openDrawer]);
}
