import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { extractEventId, reportingRows } from "./finance-math";
import type { FinanceSnapshot, FinancialTitle, FinancialPayment } from "./finance-schema";

export { extractEventId } from "./finance-math";

/** Chave do agendamento de origem de um título gerado pela agenda (`origin_key = event:<id>`). */
export function getTitleEventKey(t: Pick<FinancialTitle, "origin_key"> | null | undefined): string | null {
  return t ? extractEventId(t.origin_key) : null;
}

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Normaliza tipos do snapshot vindo do banco. Não cria, oculta nem altera registros:
 * títulos, baixas, contas e permissões são exatamente os retornados por get_financial_snapshot.
 */
function normalizeFinancialSnapshot(raw: Partial<FinanceSnapshot> | null | undefined): FinanceSnapshot {
  const titles: FinancialTitle[] = (Array.isArray(raw?.titles) ? raw.titles : [])
    .filter((t) => t && t.id)
    .map((t) => ({
      ...t,
      id: String(t.id),
      type: t.type === "despesa" ? "despesa" : "receita",
      amount: toNumber(t.amount),
      paid_amount: toNumber(t.paid_amount),
      due_date: t.due_date ? String(t.due_date).slice(0, 10) : "",
      date: t.date ? String(t.date).slice(0, 10) : "",
      status: String(t.status || "pendente"),
    }));

  const payments: FinancialPayment[] = (Array.isArray(raw?.payments) ? raw.payments : [])
    .filter((p) => p && p.id)
    .map((p) => ({
      ...p,
      id: String(p.id),
      transaction_id: String(p.transaction_id || ""),
      amount: toNumber(p.amount),
      paid_on: p.paid_on ? String(p.paid_on).slice(0, 10) : "",
    }));

  return {
    titles,
    payments,
    accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
    scopes: Array.isArray(raw?.scopes) ? raw.scopes : [],
    patients: Array.isArray(raw?.patients) ? raw.patients : [],
  };
}

export async function getFinancialSnapshot(): Promise<FinanceSnapshot> {
  const { data, error } = await supabase.rpc("get_financial_snapshot");
  if (error) throw error;
  return normalizeFinancialSnapshot(data as FinanceSnapshot | null);
}

export async function getFinancialReportingRows() {
  const data = await getFinancialSnapshot();
  if (!data.scopes.length) throw new Error("Sem permissão para consultar indicadores financeiros.");
  return reportingRows(data);
}

export async function refreshFinance(qc: QueryClient) {
  await Promise.all(
    [
      "financial-snapshot",
      "cash-flow-snapshot",
      "financial-operations",
      "transactions",
      "treatment-installments",
      "treatment-finance-plans",
      "treatment-ledger",
      "treatment-alerts",
      "treatments-list",
      "dashboard",
      "reports-data",
    ].map((key) => qc.invalidateQueries({ queryKey: [key], refetchType: "all" })),
  );
}
