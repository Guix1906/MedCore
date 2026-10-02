import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Calendar,
  Plus,
  RefreshCw,
  Trash2,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  Clock,
  Wallet,
  AlertCircle,
  Sparkles,
  Building,
  CreditCard,
  Layers,
  ChevronRight,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import type { FinanceSnapshot, FinancialAccount } from "./finance-schema";
import { refreshFinance } from "./finance-api";

export interface RecurringTransaction {
  id: string;
  type: "receita" | "despesa";
  amount: number;
  description: string;
  category: string | null;
  account_id: string | null;
  payment_method: string | null;
  frequency: string;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  next_run: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  financial_accounts?: { name: string } | null;
}

interface CustosFixosMensaisProps {
  finance: FinanceSnapshot;
  onRefreshFinance?: () => void;
}

export function CustosFixosMensais({ finance, onRefreshFinance }: CustosFixosMensaisProps) {
  const queryClient = useQueryClient();
  const [openNewModal, setOpenNewModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Consulta todos os custos fixos / transações recorrentes de despesa
  const {
    data: custosFixos = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["recurring-transactions-expenses"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("recurring_transactions")
        .select("*, financial_accounts(name)")
        .eq("type", "despesa")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Erro ao buscar custos fixos recorrentes:", error);
        return [];
      }
      return (data as unknown as RecurringTransaction[]) || [];
    },
  });

  // Cálculos de Resumo dos Custos Fixos
  const resumo = useMemo(() => {
    const ativos = custosFixos.filter((c) => c.is_active);
    const totalMensal = ativos.reduce((acc, c) => acc + Number(c.amount || 0), 0);
    const countAtivos = ativos.length;
    const countTotal = custosFixos.length;

    // Próximos vencimentos ordenados por dia do mês
    const sortedByDay = [...ativos].sort(
      (a, b) => (Number(a.day_of_month) || 1) - (Number(b.day_of_month) || 1),
    );

    return {
      totalMensal,
      countAtivos,
      countTotal,
      proximos: sortedByDay.slice(0, 3),
    };
  }, [custosFixos]);

  // Alterna o status ativo / pausado do custo fixo
  const toggleAtivo = async (item: RecurringTransaction) => {
    const novoStatus = !item.is_active;
    const { error } = await (supabase.from as any)("recurring_transactions")
      .update({ is_active: novoStatus })
      .eq("id", item.id);

    if (error) {
      toast.error("Erro ao alterar status do custo fixo: " + error.message);
      return;
    }
    toast.success(novoStatus ? "Custo fixo ativado!" : "Custo fixo pausado.");
    void refetch();
  };

  // Exclui um custo fixo
  const handleDelete = async (id: string) => {
    const { error } = await (supabase.from as any)("recurring_transactions").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir custo fixo: " + error.message);
      return;
    }
    toast.success("Custo fixo excluído com sucesso.");
    setDeletingId(null);
    void refetch();
  };

  // Gera automaticamente as parcelas mensais no Contas a Pagar (tabela transactions)
  const syncRecurringTransactions = async (specificItem?: RecurringTransaction) => {
    setSyncing(true);
    try {
      const itemsToSync = specificItem ? [specificItem] : custosFixos.filter((c) => c.is_active);
      let totalCreated = 0;

      // Gera para os próximos 6 a 12 meses
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-indexed

      for (const item of itemsToSync) {
        if (!item.is_active) continue;

        const day = Number(item.day_of_month) || 10;
        const startDate = new Date(item.start_date || now);
        const endDate = item.end_date ? new Date(item.end_date) : null;

        // Projeta 12 meses a partir do mês atual
        for (let i = 0; i < 12; i++) {
          const targetDate = new Date(currentYear, currentMonth + i, day);

          // Verifica limite de data de início e fim
          if (targetDate < new Date(startDate.getFullYear(), startDate.getMonth(), 1)) {
            continue;
          }
          if (endDate && targetDate > endDate) {
            break;
          }

          const dueDateStr = targetDate.toISOString().slice(0, 10);
          const monthYearLabel = targetDate.toLocaleDateString("pt-BR", {
            month: "short",
            year: "numeric",
          });

          // Verifica se já existe um lançamento para este custo fixo nesta data
          const { data: existing } = await (supabase.from as any)("transactions")
            .select("id")
            .eq("recurrence_id", item.id)
            .eq("due_date", dueDateStr)
            .maybeSingle();

          if (!existing) {
            const desc = `${item.description} (${monthYearLabel.toUpperCase()})`;
            const { error: insErr } = await (supabase.from as any)("transactions").insert({
              type: "despesa",
              amount: Number(item.amount),
              description: desc,
              category: item.category || "Custos Fixos",
              account_id: item.account_id || null,
              payment_method: item.payment_method || "boleto",
              due_date: dueDateStr,
              date: dueDateStr,
              status: "pendente",
              is_recurring: true,
              recurrence_id: item.id,
              installment_number: i + 1,
              installment_total: 12,
            });

            if (!insErr) {
              totalCreated++;
            }
          }
        }
      }

      if (totalCreated > 0) {
        toast.success(`${totalCreated} lançamento(s) gerado(s) no Contas a Pagar!`);
        void refreshFinance(queryClient);
        onRefreshFinance?.();
      } else {
        toast.info("Todos os lançamentos dos próximos meses já estão em dia no Contas a Pagar.");
      }
    } catch (err: any) {
      toast.error("Erro ao sincronizar parcelas: " + (err?.message || ""));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOPO: AVISO E BOTÕES                                                   */}
      {/* ========================================================================= */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
              <Calendar className="h-4 w-4" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Custos Fixos Mensais Recorrentes
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Cadastre contas fixas da clínica (ex: aluguel, condomínio, software, limpeza). O sistema
            mantém a conta como recorrente e cria automaticamente cada parcela mensal no Contas a
            Pagar e no Fluxo de Caixa.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncRecurringTransactions()}
            disabled={syncing || custosFixos.length === 0}
            className="h-9 px-3.5 text-xs font-semibold gap-1.5 border-border bg-card hover:bg-muted/60 text-foreground cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            Sincronizar Próximos Meses
          </Button>

          <Button
            size="sm"
            onClick={() => setOpenNewModal(true)}
            className="h-9 px-4 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary-hover text-white shadow-xs rounded-xl cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Cadastrar Custo Fixo
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. CARDS DE RESUMO NA TELA                                                */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card rounded-2xl border border-border p-4.5 shadow-2xs">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
            Total Mensal Recorrente
          </span>
          <div className="text-2xl font-bold text-destructive mt-1 tabular-nums">
            {currency(resumo.totalMensal)}
            <span className="text-xs font-normal text-muted-foreground ml-1">/mês</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-1">
            Soma dos {resumo.countAtivos} custos fixos ativos
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-border p-4.5 shadow-2xs">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
            Custos Fixos Cadastrados
          </span>
          <div className="text-2xl font-bold text-foreground mt-1">
            {resumo.countAtivos}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ativos ({resumo.countTotal} total)
            </span>
          </div>
          <p className="text-2xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 font-medium">
            <CheckCircle2 size={12} />
            Gerados automaticamente a cada mês
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-border p-4.5 shadow-2xs">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
            Próximos Vencimentos Recorrentes
          </span>
          {resumo.proximos.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-2">Nenhum custo fixo ativo.</p>
          ) : (
            <div className="mt-1 space-y-1">
              {resumo.proximos.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-xs text-foreground/90 font-medium"
                >
                  <span className="truncate max-w-[140px]">{item.description}</span>
                  <span className="font-semibold text-destructive tabular-nums">
                    Dia {item.day_of_month}: {currency(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. LISTAGEM DE CUSTOS FIXOS CADASTRADOS                                   */}
      {/* ========================================================================= */}
      <div className="bg-card rounded-2xl border border-border p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Contas Fixas Cadastradas ({custosFixos.length})
          </h3>
          <span className="text-xs text-muted-foreground">
            Lançamentos mensais recorrentes da clínica
          </span>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Carregando custos fixos...
          </p>
        ) : custosFixos.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="h-11 w-11 rounded-2xl bg-muted text-muted-foreground mx-auto flex items-center justify-center">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Nenhum custo fixo mensal cadastrado
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md mx-auto">
                Cadastre suas despesas recorrentes (como aluguel, luz, internet, sistemas). O
                sistema manterá a recorrência e gerará as contas automaticamente mês a mês.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setOpenNewModal(true)}
              className="h-9 px-4 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary-hover text-white shadow-xs rounded-xl cursor-pointer mx-auto"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Cadastrar Primeiro Custo Fixo
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {custosFixos.map((item) => {
              const accountName = item.financial_accounts?.name || "Conta principal";
              return (
                <div
                  key={item.id}
                  className={`py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl px-3 transition-colors ${
                    item.is_active ? "hover:bg-muted/40" : "bg-muted/20 opacity-60"
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {item.description}
                      </span>
                      {item.category && (
                        <span className="inline-flex items-center text-2xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                          {item.category}
                        </span>
                      )}
                      <span
                        className={`text-2xs font-bold px-2 py-0.5 rounded-full ${
                          item.is_active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.is_active ? "Ativo (Todo mês)" : "Pausado"}
                      </span>
                    </div>

                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                      <span className="flex items-center gap-1 font-medium text-foreground/80">
                        <Clock size={12} className="text-primary" />
                        Vencimento: <strong>Todo dia {item.day_of_month || 10}</strong>
                      </span>
                      <span>Forma: {item.payment_method?.toUpperCase() || "BOLETO"}</span>
                      <span>Conta: {accountName}</span>
                      <span>Início: {formatClinicalDate(item.start_date)}</span>
                      {item.end_date && <span>Término: {formatClinicalDate(item.end_date)}</span>}
                    </div>

                    {item.notes && (
                      <p className="text-2xs text-muted-foreground bg-muted/40 p-1.5 rounded-lg border border-border-soft mt-1">
                        <b>Obs:</b> {item.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                    <div className="text-right">
                      <div className="text-sm font-bold text-destructive tabular-nums">
                        {currency(item.amount)}
                      </div>
                      <span className="text-2xs text-muted-foreground">por mês</span>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs font-semibold px-2.5 gap-1 border-border cursor-pointer shadow-2xs"
                      onClick={() => syncRecurringTransactions(item)}
                      title="Gerar as próximas parcelas desta conta"
                    >
                      <RefreshCw size={12} />
                      Gerar Parcelas
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => toggleAtivo(item)}
                      title={item.is_active ? "Pausar custo fixo" : "Reativar custo fixo"}
                    >
                      {item.is_active ? (
                        <PauseCircle size={15} className="text-warning" />
                      ) : (
                        <PlayCircle size={15} className="text-success" />
                      )}
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive/80 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      onClick={() => setDeletingId(item.id)}
                      title="Excluir custo fixo"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Confirmação de Exclusão */}
      <Dialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir custo fixo mensal?</DialogTitle>
            <DialogDescription>
              A regra de recorrência será removida. Os lançamentos que já foram gerados e pagos no
              Contas a Pagar permanecerão preservados no histórico.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeletingId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && handleDelete(deletingId)}
            >
              Sim, excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Cadastro de Custo Fixo */}
      {openNewModal && (
        <CadastrarCustoFixoModal
          accounts={finance.accounts}
          onClose={() => setOpenNewModal(false)}
          onCreated={() => {
            setOpenNewModal(false);
            void refetch();
            void syncRecurringTransactions();
          }}
        />
      )}
    </div>
  );
}

// ============== MODAL DE CADASTRO DO CUSTO FIXO MENSAL ==============
function CadastrarCustoFixoModal({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: FinancialAccount[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Aluguel");
  const [amount, setAmount] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("10");
  const [paymentMethod, setPaymentMethod] = useState("boleto");
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [repetition, setRepetition] = useState("mensal");
  const [endDate, setEndDate] = useState("");
  const [hasEndDate, setHasEndDate] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = [
    "Aluguel",
    "Condomínio",
    "Energia Elétrica",
    "Água / Saneamento",
    "Internet e Telefonia",
    "Software & Sistemas",
    "Limpeza & Conservação",
    "Contabilidade",
    "Segurança",
    "Marketing e Publicidade",
    "Folha de Pagamento",
    "Impostos Fixos",
    "Outros Custos Fixos",
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDesc = description.trim();
    if (!cleanDesc) {
      toast.error("Informe a descrição do custo fixo (ex: Aluguel da Clínica).");
      return;
    }

    const valNum = Number(amount.replace(/\./g, "").replace(",", "."));
    if (isNaN(valNum) || valNum <= 0) {
      toast.error("Informe um valor mensal válido.");
      return;
    }

    const dayNum = parseInt(dayOfMonth, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      toast.error("Informe um dia de vencimento válido (entre 1 e 31).");
      return;
    }

    setSaving(true);
    try {
      const now = new Date(startDate || new Date());
      const nextRunDate = new Date(now.getFullYear(), now.getMonth(), dayNum);
      const nextRunIso = nextRunDate.toISOString().slice(0, 10);

      const { data, error } = await (supabase.from as any)("recurring_transactions")
        .insert({
          type: "despesa",
          description: cleanDesc,
          category: category.trim() || "Custos Fixos",
          amount: valNum,
          day_of_month: dayNum,
          payment_method: paymentMethod,
          account_id: accountId || null,
          start_date: startDate,
          end_date: hasEndDate && endDate ? endDate : null,
          frequency: repetition,
          next_run: nextRunIso,
          is_active: true,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Imediatamente gera as parcelas dos próximos 12 meses no Contas a Pagar
      const recId = data?.id;
      if (recId) {
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const maxMonths = 12;

        for (let i = 0; i < maxMonths; i++) {
          const tDate = new Date(currentYear, currentMonth + i, dayNum);
          if (hasEndDate && endDate && tDate > new Date(endDate)) break;

          const dueStr = tDate.toISOString().slice(0, 10);
          const monthLabel = tDate.toLocaleDateString("pt-BR", {
            month: "short",
            year: "numeric",
          });

          await (supabase.from as any)("transactions").insert({
            type: "despesa",
            amount: valNum,
            description: `${cleanDesc} (${monthLabel.toUpperCase()})`,
            category: category.trim() || "Custos Fixos",
            account_id: accountId || null,
            payment_method: paymentMethod,
            due_date: dueStr,
            date: dueStr,
            status: "pendente",
            is_recurring: true,
            recurrence_id: recId,
            installment_number: i + 1,
            installment_total: maxMonths,
          });
        }
      }

      toast.success(
        "Custo fixo mensal cadastrado! O sistema manterá a recorrência e já gerou as parcelas nos próximos meses do Contas a Pagar.",
      );
      onCreated();
    } catch (err: any) {
      toast.error("Erro ao cadastrar custo fixo: " + (err?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="border-b border-border-soft px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Cadastrar Custo Fixo Mensal
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Cadastre uma vez. O sistema cria e agenda automaticamente os lançamentos dos
                próximos meses.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[75vh] overflow-y-auto">
            {/* Descrição */}
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Descrição do Custo Fixo *
              </label>
              <input
                required
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                placeholder="Ex.: Aluguel da Clínica, Condomínio Edifício, Software MedCore"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Categoria */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Categoria
              </label>
              <select
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Valor */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Valor Mensal (R$) *
              </label>
              <input
                required
                type="text"
                inputMode="decimal"
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card font-semibold tabular-nums"
                placeholder="Ex.: 3.500,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {/* Dia do Vencimento */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Dia do Vencimento (1 a 31) *
              </label>
              <input
                required
                type="number"
                min="1"
                max="31"
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                placeholder="Ex.: 10"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
              />
            </div>

            {/* Forma de Pagamento */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Forma de Pagamento
              </label>
              <select
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="boleto">Boleto Bancário</option>
                <option value="pix">PIX</option>
                <option value="debito_automatico">Débito Automático</option>
                <option value="transferencia">Transferência TED/DOC</option>
                <option value="cartao_credito">Cartão de Crédito</option>
                <option value="dinheiro">Dinheiro</option>
              </select>
            </div>

            {/* Conta Bancária */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Conta Bancária / Caixa
              </label>
              <select
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">— Selecione a conta —</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Data de Início */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Data de Início
              </label>
              <input
                required
                type="date"
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            {/* Repetição */}
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Repetição
              </label>
              <select
                disabled
                className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-muted/60 text-muted-foreground"
                value={repetition}
                onChange={(e) => setRepetition(e.target.value)}
              >
                <option value="mensal">Mensal (Todo mês)</option>
              </select>
            </div>

            {/* Data Final (opcional) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-foreground/80">Data Final</label>
                <label className="text-2xs text-muted-foreground flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasEndDate}
                    onChange={(e) => setHasEndDate(e.target.checked)}
                    className="rounded border-border text-primary h-3.5 w-3.5"
                  />
                  Definir término
                </label>
              </div>
              <input
                type="date"
                disabled={!hasEndDate}
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card disabled:opacity-40"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            {/* Observações */}
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                Observações
              </label>
              <textarea
                rows={2}
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary bg-card"
                placeholder="Ex.: Contrato com vencimento anual, reajuste pelo IPCA em julho..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border-soft flex items-center justify-between bg-card">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles size={13} className="text-primary" />
              Lançamentos criados automaticamente
            </span>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="rounded-full text-xs font-semibold"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="rounded-full bg-primary hover:bg-primary-hover text-white text-xs font-semibold px-5"
              >
                {saving ? "Salvando e gerando..." : "Salvar Custo Fixo"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
