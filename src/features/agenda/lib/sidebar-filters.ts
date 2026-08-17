import type { Activity } from "@/components/agenda/agenda-types";
import { KIND_COLOR } from "@/components/agenda/agenda-types";
import type { AgendaFilterOptions, AgendaFilterValues } from "@/components/agenda/AgendaSidebar";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  todo: "Pendente",
  in_progress: "Em andamento",
  doing: "Em andamento",
  confirmed: "Confirmado",
  scheduled: "Agendado",
  done: "Concluído",
  completed: "Concluído",
  cancelled: "Cancelado",
  canceled: "Cancelado",
};

export function statusLabel(status: string | null): string | null {
  if (!status) return null;
  return STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

const uniqSorted = (values: (string | null | undefined)[]) =>
  Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

function haystack(a: Activity) {
  return `${a.title} ${a.description ?? ""} ${a.caseTitle ?? ""} ${a.location ?? ""}`.toLowerCase();
}

export function buildAgendaFilterOptions({
  activities,
  memberNameById,
  patientNames,
  insuranceNames,
}: {
  activities: Activity[];
  memberNameById: Map<string, string>;
  patientNames: string[];
  insuranceNames: string[];
}): AgendaFilterOptions {
  const memberList = Array.from(memberNameById.values());

  return {
    status: uniqSorted(activities.map((a) => statusLabel(a.status))),
    profissional: uniqSorted(memberList.length > 0 ? memberList : activities.map((a) => (a.assignedTo ? (memberNameById.get(a.assignedTo) ?? null) : null))),
    paciente: uniqSorted(patientNames.length > 0 ? patientNames : activities.map(a => a.title)),
    procedimento: uniqSorted(activities.map((a) => KIND_COLOR[a.kind]?.label ?? a.kind)),
    sala: uniqSorted(activities.map((a) => a.location)),
    convenio: uniqSorted(insuranceNames),
    tipoConsulta: uniqSorted(activities.map((a) => KIND_COLOR[a.kind]?.label ?? a.kind)),
  };
}

export function applyAgendaSidebarFilters({
  activities,
  filters,
  memberNameById,
}: {
  activities: Activity[];
  filters: AgendaFilterValues;
  memberNameById: Map<string, string>;
}): Activity[] {
  const active = Object.values(filters).some(Boolean);
  if (!active) return activities;

  return activities.filter((a) => {
    if (a.kind === "feriado") {
      if (filters.procedimento && filters.procedimento !== "Feriado") return false;
      if (filters.tipoConsulta && filters.tipoConsulta !== "Feriado") return false;
      return true;
    }

    if (filters.status && statusLabel(a.status) !== filters.status) return false;

    if (filters.profissional) {
      const owner = a.assignedTo ? (memberNameById.get(a.assignedTo) ?? null) : null;
      if (owner !== filters.profissional) return false;
    }

    const kindLabel = KIND_COLOR[a.kind]?.label ?? a.kind;
    if (filters.procedimento && kindLabel !== filters.procedimento) return false;
    if (filters.tipoConsulta && kindLabel !== filters.tipoConsulta) return false;

    if (filters.sala) {
      if (!a.location || !a.location.toLowerCase().includes(filters.sala.toLowerCase())) return false;
    }

    if (filters.paciente) {
      const target = filters.paciente.toLowerCase();
      const matchInTitle = a.title.toLowerCase().includes(target);
      const matchInHaystack = haystack(a).includes(target);
      if (!matchInTitle && !matchInHaystack) return false;
    }

    if (filters.convenio) {
      const target = filters.convenio.toLowerCase();
      if (!haystack(a).includes(target)) return false;
    }

    return true;
  });
}
