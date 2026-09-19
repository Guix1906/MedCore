import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { reportingRows } from "./finance-math";

export async function getFinancialSnapshot() {
  const { data, error } = await supabase.rpc("get_financial_snapshot");
  if (error) throw error;
  if (!data)
    throw new Error(
      "Não foi possível carregar o financeiro. Verifique a migração e as permissões.",
    );
  return data;
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
    ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
  );
}
