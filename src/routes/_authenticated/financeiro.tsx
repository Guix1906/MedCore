import { createFileRoute, useBlocker, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import FinanceTabs, {
  financeTabs,
  resolveFinanceTab,
  type FinanceTabId,
} from "@/components/finance/FinanceTabs";
import { errorMessage } from "@/features/acompanhamentos/followup-utils";
import { getFinancialSnapshot, refreshFinance } from "@/features/finance/finance-api";
import { Button } from "@/components/ui/button";
import TitleList from "@/features/finance/TitleList";
import CashFlow from "@/features/finance/CashFlow";
import { ContasPagarTab } from "@/features/finance/ContasPagarTab";
import { ContasReceberTab } from "@/features/finance/ContasReceberTab";
import BankReconciliation from "@/features/finance/BankReconciliation";
import CategoriesManager from "@/features/finance/CategoriesManager";
import NewTitle from "@/features/finance/NewTitle";
import PaymentHistory from "@/features/finance/PaymentHistory";
import ServiceRevenue from "@/features/finance/ServiceRevenue";
import { OperationLock } from "@/features/finance/OperationForm";
import { toast } from "sonner";
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
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["financial-snapshot"],
    queryFn: getFinancialSnapshot,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  const [selected, setSelected] = useState("");
  const [creatingType, setCreating] = useState<"receita" | "despesa" | null>(null);
  const [creatingPaidNow, setCreatingPaidNow] = useState(false);
  const creating =
    creatingType ?? (search.novo ? (search.tab === "pagar" ? "despesa" : "receita") : null);
  const [cancelId, setCancelId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [operationsLocked, setOperationsLocked] = useState(false);
  const locked = !!active || operationsLocked;
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: locked });
  const data = query.data;
  const currentTitle = data?.titles.find((t) => t.id === selected);
  // Sentido da animação: aba à direita entra pela direita, à esquerda pela esquerda
  const tabIndex = financeTabs.findIndex((t) => t.id === search.tab);
  const prevTabIndex = useRef(tabIndex);
  const direction = Math.sign(tabIndex - prevTabIndex.current);
  useEffect(() => {
    prevTabIndex.current = tabIndex;
  }, [tabIndex]);
  const changeTab = (tab: FinanceTabId) => {
    void navigate({ search: { tab, novo: false }, replace: true });
  };

  return (
    <AppShell title="Financeiro">
      <OperationLock.Provider value={{ active, setActive }}>
        <main className="page-container space-y-5">
          <FinanceTabs activeTab={search.tab} onSelectTab={changeTab} disabled={locked} />
          {query.isPending && search.tab !== "categorias" && <p role="status">Carregando financeiro...</p>}
          {query.error && search.tab !== "categorias" && (
            <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-destructive">
              {errorMessage(query.error)}
              <p>Não foi possível atualizar os dados financeiros.</p>
              <button className="underline" onClick={() => query.refetch()}>
                Tentar novamente
              </button>
            </div>
          )}
          {/* key troca a cada aba: o conteúdo entra deslizando no sentido da navegação */}
          <div key={search.tab} className="fin-tab-enter" data-dir={direction}>
          {search.tab === "categorias" ? (
            <CategoriesManager />
          ) : data && !query.error ? (
            <>
              {search.tab === "fluxo" ? (
                    <CashFlow
                      finance={data}
                      onOpenNew={(type) => {
                        setCreating(type || "receita");
                        setCreatingPaidNow(true);
                      }}
                      onSelectTitle={(id) => setSelected(id)}
                    />
                  ) : search.tab === "pagar" ? (
                    <ContasPagarTab
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onOpenNew={(type) => {
                        setCreating(type || "despesa");
                        setCreatingPaidNow(false);
                      }}
                      onEdit={(item) => setSelected(item.id)}
                      onPay={(item) => setSelected(item.id)}
                      onDelete={(id) => setCancelId(id)}
                    />
                  ) : search.tab === "receber" ? (
                    <ContasReceberTab
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onOpenNew={(type) => {
                        setCreating(type || "receita");
                        setCreatingPaidNow(false);
                      }}
                      onEdit={(item) => setSelected(item.id)}
                      onReceive={(item) => setSelected(item.id)}
                      onDelete={(id) => setCancelId(id)}
                    />
                  ) : search.tab === "servicos" ? (
                    <ServiceRevenue finance={data} />
                  ) : (
                    <BankReconciliation
                      finance={data}
                      onRefresh={() => void query.refetch()}
                      refreshing={query.isFetching}
                      onOpenTitles={(type) => changeTab(type === "receita" ? "receber" : "pagar")}
                    />
                  )}
              {creating && (
                <NewTitle
                  finance={data}
                  type={creating}
                  defaultPaidNow={creatingPaidNow || search.tab === "fluxo"}
                  onClose={() => {
                    setCreating(null);
                    setCreatingPaidNow(false);
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
                  if (!open && !locked && !deleting) setCancelId("");
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Excluir lançamento?</DialogTitle>
                    <DialogDescription>
                      Se já houver recebimentos, eles serão estornados para o caixa continuar
                      correto. Esta ação não devolve dinheiro ao paciente.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" disabled={deleting} onClick={() => setCancelId("")}>
                      Voltar
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true);
                        const { error } = await (supabase.rpc as any)("delete_financial_title", {
                          p_id: cancelId,
                        });
                        setDeleting(false);
                        if (error) {
                          toast.error("Não foi possível excluir", { description: errorMessage(error) });
                          return;
                        }
                        toast.success("Lançamento excluído.");
                        setCancelId("");
                        void refreshFinance(queryClient);
                      }}
                    >
                      {deleting ? "Excluindo..." : "Sim, excluir"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
          </div>
        </main>
      </OperationLock.Provider>
    </AppShell>
  );
}
