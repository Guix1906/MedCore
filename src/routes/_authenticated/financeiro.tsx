import { createFileRoute, useBlocker, type SearchSchemaInput } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import FinanceTabs, {
  resolveFinanceTab,
  type FinanceTabId,
} from "@/components/finance/FinanceTabs";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";
import { getFinancialSnapshot } from "@/features/finance/finance-api";
import TitleList from "@/features/finance/TitleList";
import CashFlow from "@/features/finance/CashFlow";
import { ContasPagarTab } from "@/features/finance/ContasPagarTab";
import { ContasReceberTab } from "@/features/finance/ContasReceberTab";
import BankReconciliation from "@/features/finance/BankReconciliation";
import { DfcTab } from "@/features/finance/DfcTab";
import { DreTab } from "@/features/finance/DreTab";
import FinanceOperations from "@/features/finance/FinanceOperations";
import NewTitle from "@/features/finance/NewTitle";
import PaymentHistory from "@/features/finance/PaymentHistory";
import OperationForm, { OperationLock, Reason, formText } from "@/features/finance/OperationForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro - MedCore" }] }),
  validateSearch: (search: SearchSchemaInput & { tab?: unknown; novo?: unknown }) => ({
    tab: resolveFinanceTab(search.tab),
    novo: [true, "true", "lancamento", "1", 1].some((value) => value === search.novo),
  }),
  component: FinanceiroPage,
});

function FinanceiroPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useQuery({ queryKey: ["financial-snapshot"], queryFn: getFinancialSnapshot });
  const [selected, setSelected] = useState("");
  const [creatingType, setCreating] = useState<"receita" | "despesa" | null>(null);
  const creating =
    creatingType ?? (search.novo ? (search.tab === "pagar" ? "despesa" : "receita") : null);
  const [cancelId, setCancelId] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [operationsLocked, setOperationsLocked] = useState(false);
  const locked = !!active || operationsLocked;
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: locked });
  const data = query.data;
  const currentTitle = data?.titles.find((t) => t.id === selected);
  const changeTab = (tab: FinanceTabId) => {
    void navigate({ search: { tab, novo: false }, replace: true });
  };
  return (
    <AppShell>
      <OperationLock.Provider value={{ active, setActive }}>
        <main className="space-y-5 p-4 md:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Financeiro
          </p>
          <FinanceTabs activeTab={search.tab} onSelectTab={changeTab} disabled={locked} />
          {query.isPending && <p role="status">Carregando financeiro...</p>}
          {query.error && (
            <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
              {errorMessage(query.error)}
              <p>Não foi possível atualizar os dados financeiros.</p>
              <button className="underline" onClick={() => query.refetch()}>
                Tentar novamente
              </button>
            </div>
          )}
          {data && !query.error && (
            <>
              {data.scopes.length === 0 ? (
                <p role="alert">
                  Seu perfil não possui acesso financeiro. Solicite autorização ao administrador.
                </p>
              ) : (
                <>
                  {search.tab === "fluxo" ? (
                    <CashFlow
                      finance={data}
                      onOpenNew={(type) => setCreating(type || "receita")}
                      onSelectTitle={(id) => setSelected(id)}
                    />
                  ) : search.tab === "pagar" ? (
                    <ContasPagarTab
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onOpenNew={(type) => setCreating(type || "despesa")}
                      onEdit={(item) => setSelected(item.id)}
                      onPay={(item) => setSelected(item.id)}
                      onDelete={(id) => setCancelId(id)}
                    />
                  ) : search.tab === "receber" ? (
                    <ContasReceberTab
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onOpenNew={(type) => setCreating(type || "receita")}
                      onEdit={(item) => setSelected(item.id)}
                      onReceive={(item) => setSelected(item.id)}
                      onDelete={(id) => setCancelId(id)}
                    />
                  ) : search.tab === "conciliacao" ? (
                    <BankReconciliation
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onOpenTitles={(type) => changeTab(type === "receita" ? "receber" : "pagar")}
                    />
                  ) : search.tab === "dfc" ? (
                    <DfcTab
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onSelectTitle={(id) => setSelected(id)}
                    />
                  ) : search.tab === "dre" ? (
                    <DreTab
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onSelectTitle={(id) => setSelected(id)}
                    />
                  ) : (
                    <FinanceOperations
                      finance={data}
                      mode={search.tab}
                      onLockChange={setOperationsLocked}
                      onSelectTitle={setSelected}
                      onOpenTitles={(type) => changeTab(type === "receita" ? "receber" : "pagar")}
                    />
                  )}
                </>
              )}
              {creating && (
                <NewTitle
                  finance={data}
                  type={creating}
                  onClose={() => {
                    setCreating(null);
                    if (search.novo)
                      void navigate({ search: { ...search, novo: false }, replace: true });
                  }}
                />
              )}
              {currentTitle && (
                <PaymentHistory
                  key={currentTitle.id}
                  title={currentTitle}
                  data={data}
                  onClose={() => setSelected("")}
                />
              )}
              <Dialog
                open={!!cancelId}
                onOpenChange={(open) => {
                  if (!open && !locked) setCancelId("");
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancelar conta</DialogTitle>
                    <DialogDescription>
                      O registro será preservado no histórico. Esta ação não devolve dinheiro.
                    </DialogDescription>
                  </DialogHeader>
                  {cancelId && (
                    <OperationForm
                      title="Confirmar cancelamento"
                      execute={async (form) => {
                        const result = await supabase.rpc("cancel_financial_title", {
                          p_id: cancelId,
                          p_reason: formText(form, "reason"),
                        });
                        if (!result.error) setCancelId("");
                        return result;
                      }}
                    >
                      <Reason />
                    </OperationForm>
                  )}
                </DialogContent>
              </Dialog>
            </>
          )}
        </main>
      </OperationLock.Provider>
    </AppShell>
  );
}
