import type { Activity } from "@/components/agenda/agenda-types";
import { getHolidayActivitiesForYears } from "@/lib/holidays";

export type RawTask = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "todo" | "in_progress" | "done" | "cancelled";
  assigned_to: string | null;
  case_id: string | null;
  case?: { title: string } | null;
};

export type RawEvent = {
  id: string;
  title: string;
  description: string | null;
  event_type: "hearing" | "meeting" | "deadline" | "other";
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  assigned_to: string | null;
  case_id: string | null;
  case?: { title: string } | null;
};

export type RawDeadline = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  status: string;
  assigned_to: string | null;
  case_id: string | null;
  is_double_term: boolean;
};

/**
 * Normaliza tasks, events, deadlines e feriados nacionais em uma única lista de Activity.
 */
export function toActivities(opts: {
  tasks: RawTask[];
  events: RawEvent[];
  deadlines: RawDeadline[];
}): Activity[] {
  const out: Activity[] = [];

  for (const t of opts.tasks) {
    if (t.status === "done" || t.status === "cancelled") continue;
    out.push({
      id: `task:${t.id}`,
      source: "task",
      kind: "tarefa",
      title: t.title,
      description: t.description,
      start: t.due_date ? new Date(t.due_date) : new Date(),
      end: null,
      allDay: !t.due_date,
      assignedTo: t.assigned_to,
      caseId: t.case_id,
      caseTitle: t.case?.title ?? null,
      location: null,
      priority: t.priority,
      status: t.status,
      raw: t,
    });
  }

  for (const e of opts.events) {
    out.push({
      id: `event:${e.id}`,
      source: "event",
      kind: e.event_type === "hearing" ? "audiencia" : "evento",
      title: e.title,
      description: e.description,
      start: new Date(e.starts_at),
      end: e.ends_at ? new Date(e.ends_at) : null,
      allDay: false,
      assignedTo: e.assigned_to,
      caseId: e.case_id,
      caseTitle: e.case?.title ?? null,
      location: e.location,
      priority: null,
      status: null,
      raw: e,
    });
  }

  for (const d of opts.deadlines) {
    if (d.status === "done") continue;
    const hourMatch = d.description?.match(/limite\s+(\d{1,2}):(\d{2})/i);
    const dt = new Date(d.due_date + "T00:00:00");
    if (hourMatch) dt.setHours(+hourMatch[1], +hourMatch[2], 0, 0);
    else dt.setHours(18, 0, 0, 0);
    out.push({
      id: `deadline:${d.id}`,
      source: "deadline",
      kind: "prazo",
      title: d.title,
      description: d.description,
      start: dt,
      end: null,
      allDay: !hourMatch,
      assignedTo: d.assigned_to,
      caseId: d.case_id,
      caseTitle: null,
      location: null,
      priority: null,
      status: d.status,
      raw: d,
    });
  }

  // Adicionar feriados nacionais brasileiros (cobertura de 20 anos: passado e futuro)
  const currentYr = new Date().getFullYear();
  const holidayYears = Array.from({ length: 20 }, (_, i) => currentYr - 5 + i);
  const holidays = getHolidayActivitiesForYears(holidayYears);
  out.push(...holidays);

  return out;
}
