import { useEffect, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { OperationLock, fieldClass } from "./OperationForm";
import ManagementReports from "./ManagementReports";
import BankReconciliation from "./BankReconciliation";
import { DfcTab } from "./DfcTab";
import { DreTab } from "./DreTab";
import CashFlow from "./CashFlow";
import FinancialAccounts from "./FinancialAccounts";

export default function FinanceOperations({
  finance,
  mode,
  onLockChange,
  onSelectTitle,
  onOpenTitles,
}: {
  finance: FinanceSnapshot;
  onLockChange: (locked: boolean) => void;
} & (
  | { mode: "contas"; onSelectTitle?: never; onOpenTitles?: never }
  | {
      mode: "fluxo" | "conciliacao" | "dre" | "dfc";
      onSelectTitle: (id: string) => void;
      onOpenTitles: (type: FinancialTitle["type"]) => void;
    }
)) {
  const [scope, setScope] = useState(finance.scopes[0]?.id ?? "legacy");
  const [active, setActive] = useState<string | null>(null);
  const company = scope === "legacy" ? null : scope;
  const allowed = finance.scopes.some((s) => s.id === company);
  const query = useQuery({
    queryKey: ["financial-operations", company],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_financial_operations", {
        p_company: company,
      });
      if (error) throw error;
      if (!data) throw new Error("Operações indisponíveis. Confira as migrações financeiras.");
      return data;
    },
  });
  const cashQuery = useQuery({
    queryKey: ["cash-flow-snapshot", company],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_snapshot", {
        p_company_id: company,
      });
      if (error) throw error;
      if (!data) throw new Error("Fluxo de caixa indisponível.");
      return data;
    },
  });
  useEffect(() => {
    onLockChange(active !== null);
    return () => onLockChange(false);
  }, [active, onLockChange]);
  useBlocker({ shouldBlockFn: () => active !== null, enableBeforeUnload: active !== null });
  const titles = finance.titles.filter((t) => t.company_id === company);
  const ids = new Set(titles.map((t) => t.id));
  const scoped: FinanceSnapshot = {
    ...finance,
    titles,
    payments: finance.payments.filter((p) => ids.has(p.transaction_id)),
    accounts: finance.accounts.filter((a) => a.company_id === company),
    scopes: finance.scopes.filter((s) => s.id === company),
    patients: finance.patients.filter((p) => p.company_id === company),
  };
  const ops = query.data;
  const cash = cashQuery.data;
  return (
    <OperationLock.Provider value={{ active, setActive }}>
      <section className="space-y-4">
        {finance.scopes.length > 1 && (
          <label className="block max-w-xs text-sm">
            Clínica
            <select
              disabled={!!active}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className={fieldClass}
            >
              {finance.scopes.map((s) => (
                <option key={s.id ?? "legacy"} value={s.id ?? "legacy"}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!allowed && <p role="alert">Sem clínica autorizada.</p>}
        {allowed && (query.isPending || cashQuery.isPending) && (
          <p role="status">Carregando dados financeiros...</p>
        )}
        {(query.error || cashQuery.error) && (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-destructive">
            {errorMessage(query.error ?? cashQuery.error)}
            <p>Confira a conexão, as permissões e as migrações financeiras.</p>
            <button
              className="underline"
              onClick={() => {
                void query.refetch();
                void cashQuery.refetch();
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {allowed && ops && cash && !query.error && !cashQuery.error && (
          <div key={`${scope}:${mode}`}>
            {mode === "fluxo" && (
              <CashFlow
                finance={scoped}
                ops={ops}
                cash={cash}
                onSelectTitle={onSelectTitle}
                onOpenTitles={onOpenTitles}
              />
            )}
            {mode === "conciliacao" && (
              <BankReconciliation finance={scoped} ops={ops} onOpenTitles={onOpenTitles} />
            )}
            {mode === "dfc" && <DfcTab finance={scoped} onSelectTitle={onSelectTitle} />}
            {mode === "dre" && <DreTab finance={scoped} onSelectTitle={onSelectTitle} />}
            {mode === "contas" && <FinancialAccounts finance={scoped} cash={cash} ops={ops} />}
          </div>
        )}
      </section>
    </OperationLock.Provider>
  );
}
