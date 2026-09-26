import { addDays, addMonths } from "date-fns";
// Normalização das fontes (tasks, events, deadlines) em uma "Activity" única
// usada pelo calendário diário. Mantemos as tabelas existentes; aqui só
// projetamos os campos para o componente visual.

export type ActivityKind = "tarefa" | "evento" | "prazo" | "audiencia" | "feriado";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type Activity = {
  id: string;
  source: "task" | "event" | "deadline";
  kind: ActivityKind;
  title: string;
  description: string | null;
  start: Date;
  end: Date | null;
  allDay: boolean;
  assignedTo: string | null;
  caseId: string | null;
  caseTitle: string | null;
  location: string | null;
  priority: TaskPriority | null;
  status: string | null;
  raw: unknown;
};

// Paleta por tipo (azul/roxo/vermelho/âmbar/esmeralda) — contraste para superfícies claras
export const KIND_COLOR: Record<
  ActivityKind,
  { label: string; bar: string; chip: string; text: string; soft: string; ring: string }
> = {
  tarefa: {
    label: "Tarefa",
    bar: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-400/30",
    text: "text-sky-800 dark:text-sky-300",
    soft: "bg-sky-500/10 border-sky-400/20",
    ring: "ring-sky-400/30",
  },
  evento: {
    label: "Evento",
    bar: "bg-primary/80",
    chip: "bg-primary/15 text-primary border-primary/15",
    text: "text-primary",
    soft: "bg-primary/10 border-primary/10",
    ring: "ring-primary/15",
  },
  prazo: {
    label: "Prazo",
    bar: "bg-destructive",
    chip: "bg-destructive/15 text-destructive border-destructive/15",
    text: "text-destructive",
    soft: "bg-destructive/10 border-destructive/10",
    ring: "ring-destructive/15",
  },
  audiencia: {
    label: "Audiência",
    bar: "bg-warning/80",
    chip: "bg-warning/15 text-warning border-warning/15",
    text: "text-warning",
    soft: "bg-warning/10 border-warning/10",
    ring: "ring-warning/15",
  },
  feriado: {
    label: "Feriado",
    bar: "bg-[#FF7597]",
    chip: "bg-[#FF7597] text-white border-none font-semibold shadow-xs",
    text: "text-destructive",
    soft: "bg-[#FF7597]/15 border-[#FF7597]/30",
    ring: "ring-[#FF7597]/40",
  },
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export const GOLD = "#D4AF37";

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function formatDateLong(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function shiftAgendaDate(
  date: Date,
  view: "dia" | "semana" | "mes" | "lista",
  direction: number,
): Date {
  return view === "mes"
    ? addMonths(date, direction)
    : addDays(date, direction * (view === "semana" ? 7 : 1));
}
