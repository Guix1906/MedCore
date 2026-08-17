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

// Paleta por tipo (azul/roxo/vermelho/âmbar/esmeralda) — versão dark theme
export const KIND_COLOR: Record<
  ActivityKind,
  { label: string; bar: string; chip: string; text: string; soft: string; ring: string }
> = {
  tarefa: {
    label: "Tarefa",
    bar: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-300 border-sky-400/30",
    text: "text-sky-300",
    soft: "bg-sky-500/10 border-sky-400/20",
    ring: "ring-sky-400/30",
  },
  evento: {
    label: "Evento",
    bar: "bg-violet-400",
    chip: "bg-violet-500/15 text-violet-300 border-violet-400/30",
    text: "text-violet-300",
    soft: "bg-violet-500/10 border-violet-400/20",
    ring: "ring-violet-400/30",
  },
  prazo: {
    label: "Prazo",
    bar: "bg-rose-500",
    chip: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    text: "text-rose-300",
    soft: "bg-rose-500/10 border-rose-400/20",
    ring: "ring-rose-400/30",
  },
  audiencia: {
    label: "Audiência",
    bar: "bg-amber-400",
    chip: "bg-amber-500/15 text-amber-200 border-amber-400/30",
    text: "text-amber-300",
    soft: "bg-amber-500/10 border-amber-400/20",
    ring: "ring-amber-400/30",
  },
  feriado: {
    label: "Feriado",
    bar: "bg-[#FF7597]",
    chip: "bg-[#FF7597] text-white border-none font-semibold shadow-xs",
    text: "text-[#FF5277]",
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
