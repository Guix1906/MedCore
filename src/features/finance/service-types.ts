import { supabase } from "@/integrations/supabase/client";
import { CHART_COLORS } from "@/components/ds/Chart";
import { extractEventId } from "./finance-math";
import type { FinancialTitle } from "./finance-schema";

/**
 * Tipos de serviço das receitas (aba Financeiro > Serviços).
 * Ordem de decisão do tipo de um lançamento:
 *  1. tipo gravado no lançamento (transactions.service_type);
 *  2. serviço escolhido no agendamento que gerou a cobrança (ex.: "Implantes Hormonais");
 *  3. vínculo com plano de acompanhamento;
 *  4. texto da categoria/descrição.
 */

export type ServiceType =
  | "consultas"
  | "planos"
  | "implantes"
  | "medicacoes"
  | "procedimentos"
  | "exames"
  | "outros";

export const SERVICE_TYPES: { id: ServiceType; label: string; color: string }[] = [
  { id: "consultas", label: "Consultas", color: CHART_COLORS.primary },
  { id: "planos", label: "Planos de acompanhamento", color: CHART_COLORS.secondary },
  { id: "implantes", label: "Implantes", color: CHART_COLORS.success },
  { id: "medicacoes", label: "Medicações", color: CHART_COLORS.warning },
  { id: "procedimentos", label: "Procedimentos", color: CHART_COLORS.danger },
  { id: "exames", label: "Exames", color: CHART_COLORS.primarySoft },
  { id: "outros", label: "Outros", color: CHART_COLORS.neutral },
];

const VALID = new Set<string>(SERVICE_TYPES.map((s) => s.id));

const norm = (s: string | null | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Tipo a partir de um nome de serviço/categoria/descrição; null se o texto não indicar. */
export function serviceTypeFromText(text: string | null | undefined): ServiceType | null {
  const s = norm(text);
  if (!s) return null;
  if (/implante/.test(s)) return "implantes";
  if (/medica|injet|tirzepatida|semaglutida|mounjaro|ozempic|wegovy|saxenda|aplicac|soro|vitamina/.test(s))
    return "medicacoes";
  if (/exame|laudo/.test(s)) return "exames";
  if (/procedimento|cirurgi|botox|preenchimento/.test(s)) return "procedimentos";
  if (/consulta|retorno|avaliac|telemedicina|teleconsulta/.test(s)) return "consultas";
  if (/plano|acompanhamento/.test(s)) return "planos";
  return null;
}

export function serviceTypeOf(
  t: FinancialTitle,
  extra: { explicit?: string | null; procedureName?: string | null } = {},
): ServiceType {
  if (extra.explicit && VALID.has(extra.explicit)) return extra.explicit as ServiceType;
  // Cobrança de agendamento nunca é "plano" (o plano tem lançamentos próprios)
  const byProcedure = serviceTypeFromText(extra.procedureName);
  if (byProcedure && byProcedure !== "planos") return byProcedure;
  if (t.treatment_id) return "planos";
  const byText = serviceTypeFromText(`${t.category ?? ""} ${t.description ?? ""}`);
  if (byText && byText !== "planos") return byText;
  // Cobrança gerada pela agenda sem serviço identificado: atendimento = consulta
  if (extractEventId(t.origin_key) || /atendimento/.test(norm(`${t.category} ${t.description}`))) return "consultas";
  return "outros";
}

/** Grava o tipo de serviço de um lançamento (precisa da migração 20261008120000). */
export async function setTitleServiceType(id: string, type: ServiceType) {
  const { error } = await (supabase.rpc as any)("set_title_service_type", {
    p_id: id,
    p_service_type: type,
  });
  if (error) throw error;
}

// Serviços padrão da agenda (ids fixos do formulário de agendamento)
const DEFAULT_PROCEDURES: Record<string, string> = {
  "proc-c1": "Consulta Médica Inicial",
  "proc-c2": "Consulta de Retorno",
  "proc-i1": "Implantes Hormonais",
};

/**
 * Dados extras para classificar as receitas: tipo gravado e o serviço escolhido no
 * agendamento de origem (lido do metadado salvo na descrição do evento).
 */
export async function loadServiceTypeExtras(titles: FinancialTitle[]) {
  const receitas = titles.filter((t) => t.type === "receita");
  const explicit = new Map<string, string>();
  const procedureByTitle = new Map<string, string>();

  // 1. Tipo gravado (sem a migração aplicada a coluna não existe: segue só com a dedução)
  const ids = receitas.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await (supabase as any)
      .from("transactions")
      .select("id, service_type")
      .in("id", ids.slice(i, i + 200));
    if (error) break;
    for (const r of data ?? []) if (r.service_type) explicit.set(r.id, r.service_type);
  }

  // 2. Serviço do agendamento
  const eventIds = [
    ...new Set(receitas.map((t) => extractEventId(t.origin_key)).filter(Boolean) as string[]),
  ];
  if (eventIds.length) {
    const [events, services] = await Promise.all([
      (supabase as any).from("events").select("id, title, description").in("id", eventIds),
      (supabase as any).from("service_types").select("id, name"),
    ]);
    const serviceName = new Map<string, string>(
      (services.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]),
    );
    const procByEvent = new Map<string, string>();
    for (const e of events.data ?? []) {
      const m = String(e.description || "").match(/<!--AGENDAMENTO_META:(.*?)-->/s);
      let proc: string | undefined;
      try {
        const sel = m ? JSON.parse(m[1])?.selectedProcedure : undefined;
        if (sel) proc = serviceName.get(sel) ?? DEFAULT_PROCEDURES[sel] ?? String(sel);
      } catch {
        // metadado ilegível: usa o título do evento
      }
      procByEvent.set(e.id, proc ?? e.title ?? "");
    }
    for (const t of receitas) {
      const ev = extractEventId(t.origin_key);
      const proc = ev ? procByEvent.get(ev) : undefined;
      if (proc) procedureByTitle.set(t.id, proc);
    }
  }
  return { explicit, procedureByTitle };
}
