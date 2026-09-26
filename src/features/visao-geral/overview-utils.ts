import {
  addDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { Activity } from "@/components/agenda/agenda-types";
import { statusLabel } from "@/features/agenda/lib/sidebar-filters";
import { parseMeta } from "@/features/dashboard/dashboard-utils";
import { toLocalDateInputValue } from "@/lib/date-utils";

export type OverviewPeriod = "semana" | "mes" | "ano";
export function overviewRange(date: Date, period: OverviewPeriod) {
  const start =
    period === "ano"
      ? startOfYear(date)
      : period === "mes"
        ? startOfMonth(date)
        : startOfWeek(date, { weekStartsOn: 0 });
  const end =
    period === "ano"
      ? endOfYear(date)
      : period === "mes"
        ? endOfMonth(date)
        : endOfWeek(date, { weekStartsOn: 0 });
  return { start, end };
}

export function appointmentStatus(activity: Activity) {
  return statusLabel(parseMeta(activity.description)?.status ?? activity.status) ?? "Não informado";
}

export function summarizeAgenda(
  activities: Activity[],
  reference: Date,
  period: OverviewPeriod,
  professional = "todos",
  status = "todos",
) {
  const { start, end } = overviewRange(reference, period);
  const inRange = activities.filter(
    (activity) =>
      activity.source === "event" &&
      activity.kind !== "feriado" &&
      activity.start >= start &&
      activity.start <= end,
  );
  const filtered = inRange.filter(
    (activity) =>
      (professional === "todos" || activity.assignedTo === professional) &&
      (status === "todos" || appointmentStatus(activity) === status),
  );
  const statusCounts = new Map<string, number>();
  const professionals = new Map<string, number>();
  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label) => ({
    label,
    count: 0,
  }));
  const buckets: { key: string; label: string; count: number }[] = [];
  if (period === "ano") {
    for (let month = 0; month < 12; month++) {
      const day = new Date(start.getFullYear(), month, 1);
      buckets.push({
        key: toLocalDateInputValue(day).slice(0, 7),
        label: day.toLocaleDateString("pt-BR", { month: "short" }),
        count: 0,
      });
    }
  } else {
    for (let day = start; day <= end; day = addDays(day, 1))
      buckets.push({
        key: toLocalDateInputValue(day),
        label: day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        count: 0,
      });
  }
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const activity of filtered) {
    const label = appointmentStatus(activity);
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
    const key = toLocalDateInputValue(activity.start).slice(0, period === "ano" ? 7 : 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.count++;
    weekDays[activity.start.getDay()].count++;
    const owner = activity.assignedTo ?? "";
    professionals.set(owner, (professionals.get(owner) ?? 0) + 1);
  }
  return {
    start,
    end,
    total: filtered.length,
    buckets,
    weekDays,
    statusCounts,
    professionals,
    availableStatuses: Array.from(new Set(inRange.map(appointmentStatus))).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
    availableProfessionals: Array.from(
      new Set(inRange.flatMap((activity) => (activity.assignedTo ? [activity.assignedTo] : []))),
    ),
  };
}
