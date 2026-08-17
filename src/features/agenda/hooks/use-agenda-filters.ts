import { useMemo } from "react";
import type { Activity, ActivityKind } from "@/components/agenda/agenda-types";

export type AssignFilter = "minhas" | "equipe" | "todas";
export type TypeFilter = "todas" | ActivityKind;

function cleanString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Aplica os filtros de tipo, atribuição e busca textual à lista bruta
 * de atividades com busca insensível a acentos e suporte a metadados.
 */
export function useAgendaFilters({
  activities,
  typeFilter,
  assignFilter,
  search,
  userId,
  memberNameById,
}: {
  activities: Activity[];
  typeFilter: TypeFilter;
  assignFilter: AssignFilter;
  search: string;
  userId: string | null | undefined;
  memberNameById: Map<string, string>;
}) {
  return useMemo(() => {
    const q = cleanString(search.trim());
    return activities.filter((a) => {
      if (typeFilter !== "todas" && a.kind !== typeFilter) return false;
      if (assignFilter === "minhas" && a.assignedTo !== userId) return false;
      if (assignFilter === "equipe" && a.assignedTo === userId) return false;
      if (q) {
        const owner = a.assignedTo ? (memberNameById.get(a.assignedTo) ?? "") : "";
        const title = a.title || "";
        const desc = a.description || "";
        const caseTitle = a.caseTitle || "";
        const location = a.location || "";
        let rawStr = "";
        try {
          if (a.raw && typeof a.raw === "object") {
            rawStr = JSON.stringify(a.raw);
          }
        } catch {}

        const hay = cleanString(`${title} ${desc} ${caseTitle} ${location} ${owner} ${rawStr}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activities, typeFilter, assignFilter, search, userId, memberNameById]);
}
