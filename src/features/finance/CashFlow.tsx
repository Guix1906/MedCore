import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  Calendar as CalendarIcon,
  Landmark,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  FileSpreadsheet,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  FileText,
  DollarSign,
  X,
  Tag,
  Zap,
  MoreVertical,
  Scale,
  MessageSquare,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  format,
  parseISO,
  isToday,
  startOfDay,
  differenceInDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  addYears,
  subYears,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  currency,
  errorMessage,
  formatClinicalDate,
  localDate,
  moneyCents,
} from "@/features/acompanhamentos/followup-utils";
import { refreshFinance, getTitleEventKey } from "./finance-api";
import { remaining } from "./finance-math";
import { cashFlow } from "./cash-flow-math";
import type { CashAccount, CashFlowSnapshot } from "./cash-flow-schema";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import {
  GraficoFluxoDeCaixa,
  type LancamentoFluxo,
  type ChartGranularity,
} from "@/components/finance/GraficoFluxoDeCaixa";
import { CountUp } from "@/components/finance/CountUp";
import { cn } from "@/lib/utils";
import PaymentHistory from "./PaymentHistory";

type CashEntry = LancamentoFluxo & { date: string };

const balance = (value: number | null) =>
  value === null ? "Pendente de conferência" : currency(value);

export interface CashFlowProps {
  finance: FinanceSnapshot;
  ops?: OperationsSnapshot;
  cash?: CashFlowSnapshot;
  onOpenNew?: (type?: "receita" | "despesa") => void;
  onSelectTitle?: (titleId: string) => void;
  onOpenTitles?: (type: FinancialTitle["type"]) => void;
}

export function CashFlow({ finance, onOpenNew, onSelectTitle }: CashFlowProps) {
  const qc = useQueryClient();

  // Escopo de Clínica e Contas
  const [scope, setScope] = useState<string>("all");
  const [selectedAccount, setSelectedAccount] = useState<string>("todas");
  const [showChart, setShowChart] = useState<boolean>(true);

  // Período e Filtros de Data (Dia, Semana, Mês, Ano, Personalizado)
  const [periodMode, setPeriodMode] = useState<"dia" | "semana" | "mes" | "ano" | "custom">("mes");
  const [currentPeriodDate, setCurrentPeriodDate] = useState(() => new Date());
  const [customStartDate, setCustomStartDate] = useState(() =>
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [customEndDate, setCustomEndDate] = useState(() =>
    format(endOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [chartGranularity, setChartGranularity] = useState<ChartGranularity>("dia");

  const { start, end, periodLabel } = useMemo(() => {
    if (periodMode === "dia") {
      const d = format(currentPeriodDate, "yyyy-MM-dd");
      return {
        start: d,
        end: d,
        periodLabel: format(currentPeriodDate, "dd/MM/yyyy"),
      };
    }
    if (periodMode === "semana") {
      const s = startOfWeek(currentPeriodDate, { weekStartsOn: 1 });
      const e = endOfWeek(currentPeriodDate, { weekStartsOn: 1 });
      return {
        start: format(s, "yyyy-MM-dd"),
        end: format(e, "yyyy-MM-dd"),
        periodLabel: `${format(s, "dd/MM")} - ${format(e, "dd/MM/yyyy")}`,
      };
    }
    if (periodMode === "ano") {
      const s = startOfYear(currentPeriodDate);
      const e = endOfYear(currentPeriodDate);
      return {
        start: format(s, "yyyy-MM-dd"),
        end: format(e, "yyyy-MM-dd"),
        periodLabel: `Ano ${format(currentPeriodDate, "yyyy")}`,
      };
    }
    if (periodMode === "custom") {
      const sLabel = customStartDate ? format(parseISO(customStartDate), "dd/MM/yyyy") : "Início";
      const eLabel = customEndDate ? format(parseISO(customEndDate), "dd/MM/yyyy") : "Fim";
      return {
        start: customStartDate,
        end: customEndDate,
        periodLabel: `${sLabel} - ${eLabel}`,
      };
    }
    // Default: "mes"
    const s = startOfMonth(currentPeriodDate);
    const e = endOfMonth(currentPeriodDate);
    return {
      start: format(s, "yyyy-MM-dd"),
      end: format(e, "yyyy-MM-dd"),
      periodLabel: `${format(s, "dd/MM/yyyy")} - ${format(e, "dd/MM/yyyy")}`,
    };
  }, [periodMode, currentPeriodDate, customStartDate, customEndDate]);

  const handlePrevPeriod = () => {
    if (periodMode === "dia") {
      setCurrentPeriodDate((prev) => subDays(prev, 1));
    } else if (periodMode === "semana") {
      setCurrentPeriodDate((prev) => subWeeks(prev, 1));
    } else if (periodMode === "ano") {
      setCurrentPeriodDate((prev) => subYears(prev, 1));
    } else if (periodMode === "mes") {
      setCurrentPeriodDate((prev) => subMonths(prev, 1));
    }
  };

  const handleNextPeriod = () => {
    if (periodMode === "dia") {
      setCurrentPeriodDate((prev) => addDays(prev, 1));
    } else if (periodMode === "semana") {
      setCurrentPeriodDate((prev) => addWeeks(prev, 1));
    } else if (periodMode === "ano") {
      setCurrentPeriodDate((prev) => addYears(prev, 1));
    } else if (periodMode === "mes") {
      setCurrentPeriodDate((prev) => addMonths(prev, 1));
    }
  };

  // Sub-abas (Lançamentos / Excluídos)
  const [activeSubTab, setActiveSubTab] = useState<"lancamentos" | "excluidos">("lancamentos");

  // Barra de Filtros
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"todos" | "receitas" | "despesas">("todos");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [formaFilter, setFormaFilter] = useState<string>("todas");
  const [origemFilter, setOrigemFilter] = useState<string>("todas");
  const [areaFilter, setAreaFilter] = useState<string>("todas");

  // Modal de Transferência entre contas
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFrom, setTransferFrom] = useState<string>("");
  const [transferTo, setTransferTo] = useState<string>("");
  const [transferAmount, setTransferAmount] = useState<number>(0);
  const [transferNotes, setTransferNotes] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");

  // Modal interno de histórico/baixa caso onSelectTitle não seja fornecido
  const [internalSelectedTitleId, setInternalSelectedTitleId] = useState<string | null>(null);

  // Painel colapsável de auditoria de saldos bancários
  const [showAccountAudit, setShowAccountAudit] = useState(false);


  // Modal de Exclusão de Movimentação
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenDelete = (entry: any) => {
    setEntryToDelete(entry);
    setDeleteReason("");
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!entryToDelete) return;
    const reason = deleteReason.trim();
    if (reason.length < 5) {
      toast.error("Informe o motivo do estorno (mínimo 5 caracteres).");
      return;
    }
    setIsDeleting(true);
    try {
      const { error } = await supabase.rpc("reverse_financial_payment", {
        p_id: entryToDelete.id,
        p_reason: reason,
      });
      if (error) throw error;
      await refreshFinance(qc);
      toast.success("Movimentação estornada.", {
        description: "O registro continua no histórico, na sub-aba Excluídos.",
      });
      setDeleteModalOpen(false);
      setEntryToDelete(null);
      setDeleteReason("");
    } catch (err: any) {
      toast.error(errorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };


  const selectedScope = finance.scopes.find((s) => (s.id || "legacy") === scope);

  // Busca snapshot do fluxo de caixa e transferências
  const query = useQuery({
    queryKey: ["cash-flow-snapshot", scope],
    enabled: !!selectedScope,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_snapshot", {
        p_company_id: scope === "legacy" ? null : scope,
      });
      if (error) throw error;
      if (!data) throw new Error("Fluxo de caixa indisponível. Verifique a migração financeira.");
      return data;
    },
  });

  // Opções de contas bancárias disponíveis
  const availableAccounts = useMemo(() => {
    return finance.accounts.filter(
      (a) => a.active && (scope === "all" || !a.company_id || a.company_id === scope),
    );
  }, [finance.accounts, scope]);

  useEffect(() => {
    if (availableAccounts.length >= 2) {
      setTransferFrom((cur) => (cur ? cur : availableAccounts[0]?.id || ""));
      setTransferTo((cur) => (cur ? cur : availableAccounts[1]?.id || ""));
    } else if (availableAccounts.length === 1) {
      setTransferFrom((cur) => (cur ? cur : availableAccounts[0]?.id || ""));
    }
  }, [availableAccounts]);


  // 1. Movimentações realizadas: somente baixas registradas no banco (transaction_payments)
  const allRealizedEntries = useMemo(() => {
    const titlesById = new Map((finance.titles || []).map((t) => [t.id, t]));
    const accountsById = new Map((finance.accounts || []).map((a) => [a.id, a]));

    return (finance.payments || []).map((p): CashEntry => {
      const t = titlesById.get(p.transaction_id);
      const isExpense = t?.type === "despesa";
      const badgeLabel = getTitleEventKey(t) ? "AGENDAMENTO" : t?.treatment_id ? "PLANO" : "MANUAL";
      return {
        id: p.id,
        transaction_id: p.transaction_id,
        created_at: p.created_at,
        date: p.paid_on,
        description: t?.description || (isExpense ? "Pagamento realizado" : "Recebimento"),
        category: t?.category || (isExpense ? "Despesas Gerais" : "Receitas"),
        client_name: t?.patient_name || p.payer_name || t?.payer_name || "Avulso",
        payment_method: p.payment_method || "—",
        payment_account: (p.account_id && accountsById.get(p.account_id)?.name) || "Conta não informada",
        account_id: p.account_id ?? undefined,
        company_id: t?.company_id || null,
        type: t?.type || "receita",
        is_expense: isExpense,
        amount: Number(p.amount || 0),
        paid_amount: Number(p.amount || 0),
        status: p.reversed_at ? "cancelado" : "pago",
        reversed_at: p.reversed_at,
        reversal_reason: p.reversal_reason,
        badgeLabel,
        title: t,
      };
    });
  }, [finance.payments, finance.titles, finance.accounts]);

  // 2. Estornos e títulos cancelados (sub-aba "Excluídos"), exatamente como registrados no banco
  const excludedEntries = useMemo(() => {
    const fromReversed = allRealizedEntries.filter((e) => !!e.reversed_at);
    const fromCancelledTitles = (finance.titles || [])
      .filter((t) => t.status === "cancelado")
      .map(
        (t): CashEntry => ({
          id: t.id,
          transaction_id: t.id,
          date: t.due_date || t.date,
          description: t.description || "Título cancelado",
          category: t.category || "Geral",
          client_name: t.patient_name || t.payer_name || "Avulso",
          payment_method: "—",
          payment_account: "—",
          company_id: t.company_id || null,
          type: t.type,
          is_expense: t.type === "despesa",
          amount: Number(t.amount || 0),
          paid_amount: 0,
          status: "cancelado",
          reversed_at: t.due_date,
          reversal_reason: "Cancelamento de título",
          badgeLabel: "CANCELADO",
          title: t,
        }),
      );
    return [...fromReversed, ...fromCancelledTitles];
  }, [allRealizedEntries, finance.titles]);

  // 3. Filtragem dos Lançamentos para exibição na tabela
  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = activeSubTab === "excluidos" ? excludedEntries : allRealizedEntries;

    return source.filter((e) => {
      // Clínica / Scope
      if (scope !== "all" && e.company_id && e.company_id !== scope) return false;

      // Conta Bancária
      if (selectedAccount !== "todas") {
        if (e.account_id !== selectedAccount && e.payment_account !== selectedAccount) {
          return false;
        }
      }

      // Período
      if (start && e.date < start) return false;
      if (end && e.date > end) return false;

      // Sub-aba: Lançamentos (exclui cancelados) vs Excluídos (somente cancelados)
      if (activeSubTab === "lancamentos" && (e.status === "cancelado" || e.reversed_at))
        return false;

      // Filtro por tipo (Segmented: Todos / Receitas / Despesas)
      if (typeFilter === "receitas" && e.is_expense) return false;
      if (typeFilter === "despesas" && !e.is_expense) return false;

      // Filtro por natureza
      if (statusFilter === "recebimento" && e.is_expense) return false;
      if (statusFilter === "pagamento" && !e.is_expense) return false;

      // Filtro por forma de pagamento
      if (formaFilter !== "todas") {
        const m = (e.payment_method || "").toLowerCase();
        if (!m.includes(formaFilter.toLowerCase())) return false;
      }

      // Filtro por conta / origem
      if (origemFilter !== "todas") {
        const a = (e.payment_account || "").toLowerCase();
        if (!a.includes(origemFilter.toLowerCase())) return false;
      }

      // Filtro por categoria / área
      if (areaFilter !== "todas") {
        const c = (e.category || "").toLowerCase();
        if (!c.includes(areaFilter.toLowerCase())) return false;
      }

      // Busca textual
      if (q) {
        const text =
          `${e.description} ${e.category} ${e.client_name} ${e.payment_method} ${e.payment_account}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [
    allRealizedEntries,
    excludedEntries,
    activeSubTab,
    scope,
    selectedAccount,
    start,
    end,
    typeFilter,
    statusFilter,
    formaFilter,
    origemFilter,
    areaFilter,
    search,
  ]);

  // 4. Cálculos dos 3 Cards de Métricas e dados do Gráfico
  const { totalEntradas, totalDespesas, saldoFinal, chartData } = useMemo(() => {
    let entradas = 0;
    let saidas = 0;

    const base = allRealizedEntries.filter((e) => {
      if (scope !== "all" && e.company_id && e.company_id !== scope) return false;
      if (selectedAccount !== "todas") {
        if (e.account_id !== selectedAccount && e.payment_account !== selectedAccount) {
          return false;
        }
      }
      if (start && (!e.date || e.date < start)) return false;
      if (end && (!e.date || e.date > end)) return false;
      if (e.status === "cancelado" || e.reversed_at) return false;
      return true;
    });

    // SE NÃO HÁ MOVIMENTAÇÕES REALIZADAS NO PERÍODO OU TODAS FORAM EXCLUÍDAS DO FLUXO DE CAIXA:
    // O fluxo de caixa está zerado/excluído, portanto NÃO DEVE MOSTRAR PREVISTO no gráfico!
    if (base.length === 0) {
      return {
        totalEntradas: 0,
        totalDespesas: 0,
        saldoFinal: 0,
        chartData: [],
      };
    }

    base.forEach((e) => {
      const amt = Number(e.paid_amount || 0);
      if (!e.is_expense) {
        entradas += amt;
      } else {
        saidas += amt;
      }
    });

    // Agrupamento diário para o ComposedChart (inclui Entradas reais e Previsão a Receber)
    const dayMap = new Map<
      string,
      { entradas: number; saidas: number; aReceber: number; iso: string }
    >();
    const sorted = [...base].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    sorted.forEach((e) => {
      const dStr = (e.date || "").slice(0, 10);
      if (!dStr) return;
      let label = dStr;
      try {
        const parsed = parseISO(dStr);
        if (!isNaN(parsed.getTime())) {
          label = format(parsed, "dd/MM/yyyy");
        }
      } catch {
        label = dStr;
      }

      const cur = dayMap.get(label) || { entradas: 0, saidas: 0, aReceber: 0, iso: dStr };
      const paid = Number(e.paid_amount) || 0;
      if (!e.is_expense) {
        cur.entradas += paid;
      } else {
        cur.saidas += paid;
      }
      dayMap.set(label, cur);
    });

    // Títulos a receber (ex.: restante de procedimentos agendados) na data de vencimento
    const titles = Array.isArray(finance?.titles) ? finance.titles : [];
    titles
      .filter((t) => t && t.type === "receita" && t.status !== "cancelado" && remaining(t) > 0)
      .forEach((t) => {
        const dStr = String(t.due_date || t.date || "").slice(0, 10);
        if (!dStr) return;
        if (start && dStr < start) return;
        if (end && dStr > end) return;

        let label = dStr;
        try {
          const parsed = parseISO(dStr);
          if (!isNaN(parsed.getTime())) {
            label = format(parsed, "dd/MM/yyyy");
          }
        } catch {
          label = dStr;
        }

        const cur = dayMap.get(label) || { entradas: 0, saidas: 0, aReceber: 0, iso: dStr };
        cur.aReceber += remaining(t);
        dayMap.set(label, cur);
      });

    // Dias só com valores a receber entram no mapa depois; ordena para o eixo e o acumulado.
    let running = 0;
    const chartPoints = Array.from(dayMap.entries())
      .sort(([, a], [, b]) => (a.iso || "").localeCompare(b.iso || ""))
      .map(([date, vals]) => {
        running += vals.entradas - vals.saidas;
        return {
          date,
          iso: vals.iso,
          entradas: vals.entradas,
          saidas: vals.saidas,
          aReceber: vals.aReceber,
          saldo: running,
        };
      });

    return {
      totalEntradas: entradas,
      totalDespesas: saidas,
      saldoFinal: entradas - saidas,
      chartData: chartPoints,
    };
  }, [allRealizedEntries, finance.titles, scope, selectedAccount, start, end]);

  // Execução de transferência entre contas
  const handleExecuteTransfer = async () => {
    if (transferring) return;
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      setTransferError("Informe um valor válido e positivo para a transferência.");
      return;
    }
    if (!transferFrom || !transferTo || transferFrom === transferTo) {
      setTransferError("Selecione contas de origem e destino diferentes.");
      return;
    }

    setTransferError("");
    setTransferring(true);
    try {
      const fromAcc = finance.accounts.find((a) => a.id === transferFrom);
      const toAcc = finance.accounts.find((a) => a.id === transferTo);

      const { error } = await supabase.rpc("record_account_transfer", {
        p_id: crypto.randomUUID(),
        p_from: transferFrom,
        p_to: transferTo,
        p_amount: transferAmount,
        p_date: localDate(),
        p_description: transferNotes.trim() || "Transferência operacional entre contas",
      });
      if (error) throw error;

      await refreshFinance(qc);
      toast.success(`Transferência de ${currency(transferAmount)} realizada com sucesso!`, {
        description: `De ${fromAcc?.name || "Origem"} para ${toAcc?.name || "Destino"}.`,
      });
      setTransferOpen(false);
      setTransferAmount(0);
      setTransferNotes("");
    } catch (err: any) {
      setTransferError(errorMessage(err));
    } finally {
      setTransferring(false);
    }
  };

  // Exportação para planilha CSV
  const handleExportCsv = () => {
    const headers = [
      "Data",
      "Descrição",
      "Paciente / Pagador",
      "Categoria",
      "Forma de Pagamento",
      "Conta / Caixa",
      "Status",
      "Tipo",
      "Valor (R$)",
    ];

    const rows = filteredEntries.map((e) => [
      formatClinicalDate(e.date),
      `"${(e.description || "").replace(/"/g, '""')}"`,
      `"${(e.client_name || "").replace(/"/g, '""')}"`,
      `"${(e.category || "").replace(/"/g, '""')}"`,
      `"${(e.payment_method || "").replace(/"/g, '""')}"`,
      `"${(e.payment_account || "").replace(/"/g, '""')}"`,
      e.status === "cancelado" ? "Cancelado" : e.is_expense ? "Pago" : "Recebido",
      e.is_expense ? "Despesa" : "Receita",
      `${e.is_expense ? "-" : ""}${e.amount.toFixed(2).replace(".", ",")}`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `fluxo-de-caixa-${start || "inicio"}-${end || "fim"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Planilha CSV exportada com sucesso!");
  };

  // Auditoria por conta do backend legado do MedCore
  let result: ReturnType<typeof cashFlow> | undefined;
  let calculationError = "";
  if (query.data) {
    try {
      result = cashFlow(
        query.data,
        start || `${localDate().slice(0, 7)}-01`,
        end || localDate(),
        selectedAccount === "todas" ? "" : selectedAccount,
      );
    } catch (error) {
      calculationError = errorMessage(error);
    }
  }

  const handleOpenEditOrHistory = (entry: (typeof allRealizedEntries)[0]) => {
    const tid = entry.transaction_id || entry.id;
    if (onSelectTitle) {
      onSelectTitle(tid);
    } else {
      setInternalSelectedTitleId(tid);
    }
  };

  const currentSelectedTitle = useMemo(() => {
    if (!internalSelectedTitleId) return null;
    return finance.titles.find((t) => t.id === internalSelectedTitleId) || null;
  }, [internalSelectedTitleId, finance.titles]);

  return (
    <div className="space-y-6 pb-12">
      {/* ========================================================================= */}
      {/* CABEÇALHO DA TELA COM TÍTULO E BOTÃO NOVO LANÇAMENTO (CANTO SUPERIOR DIREITO) */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            Fluxo de Caixa
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Movimentações realizadas no período, por data de pagamento ou vencimento quando não há
            data de pagamento.
          </p>
        </div>

        {/* Botão Novo Lançamento no Canto Superior Direito */}
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <Button
            size="sm"
            className="h-10 px-4 bg-primary hover:bg-primary-hover text-white font-semibold text-sm shadow-xs cursor-pointer "
            onClick={() =>
              onOpenNew ? onOpenNew("receita") : (window.location.href = "/financeiro?novo=1")
            }
          >
            Novo lançamento
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BARRA DE CONTROLES: CONTAS BANCÁRIAS, NAVEGAÇÃO DE MÊS E EXIBIR/OCULTAR GRÁFICO */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Seletor de Clínica (se houver múltiplas) */}
          {finance.scopes.length > 1 && (
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v);
                setSelectedAccount("todas");
              }}
            >
              <SelectTrigger className="h-9 w-auto min-w-[170px] bg-card border-border text-xs font-medium text-foreground/80 shadow-2xs rounded-lg">
                <Building2 className="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Clínica" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Clínicas</SelectItem>
                {finance.scopes.map((s) => (
                  <SelectItem key={s.id || "legacy"} value={s.id || "legacy"}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Seletor de Conta Bancária */}
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger
              aria-label="Conta bancária do fluxo de caixa"
              className="h-9 w-auto min-w-[190px] bg-card border-border text-xs font-medium text-foreground/80 shadow-2xs rounded-lg"
            >
              <Landmark className="h-3.5 w-3.5 mr-2 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Todas as contas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as contas</SelectItem>
              {availableAccounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Seletor de Período: Dia | Semana | Mês | Ano | Datas */}
          <div className="inline-flex items-center bg-muted/60 p-0.5 rounded-lg border border-border shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setPeriodMode("dia");
                setChartGranularity("dia");
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                periodMode === "dia"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Dia
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriodMode("semana");
                setChartGranularity("dia");
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                periodMode === "semana"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Semana
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriodMode("mes");
                setChartGranularity("dia");
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                periodMode === "mes"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Mês
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriodMode("ano");
                setChartGranularity("anual");
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                periodMode === "ano"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Ano
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode("custom")}
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1",
                periodMode === "custom"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <CalendarIcon className="h-3 w-3" />
              Datas
            </button>
          </div>

          {/* Stepper ou Inputs de Data Personalizada */}
          {periodMode !== "custom" ? (
            <div className="flex items-center bg-card border border-border rounded-lg h-9 px-1 shadow-2xs">
              <button
                type="button"
                onClick={handlePrevPeriod}
                className="h-7 w-7 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground/80 hover:bg-muted transition-colors cursor-pointer"
                title="Período anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-xs font-semibold text-foreground/80 tracking-wide select-none">
                {periodLabel}
              </span>
              <button
                type="button"
                onClick={handleNextPeriod}
                className="h-7 w-7 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground/80 hover:bg-muted transition-colors cursor-pointer"
                title="Próximo período"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg h-9 px-2 shadow-2xs text-xs">
              <span className="text-muted-foreground text-[11px] font-medium">De:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-transparent text-xs text-foreground font-medium outline-hidden cursor-pointer"
              />
              <span className="text-muted-foreground text-[11px] font-medium ml-1">Até:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-transparent text-xs text-foreground font-medium outline-hidden cursor-pointer"
              />
            </div>
          )}

          {/* Botão Alternar Exibição do Gráfico */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-card border-border text-foreground/80 text-xs font-medium gap-1.5 shadow-2xs hover:bg-muted/60 cursor-pointer"
            onClick={() => setShowChart((v) => !v)}
          >
            {showChart ? (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {showChart ? "Ocultar Gráfico" : "Exibir Gráfico"}
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3 CARDS DE MÉTRICAS (ENTRADAS, DESPESAS, RESULTADO DO PERÍODO)             */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* CARD 1: ENTRADAS */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              ENTRADAS
            </span>
            <p className="text-2xl font-semibold text-foreground tracking-tight">
              <CountUp value={totalEntradas} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">Total liquidado no período</p>
          </div>
          <div className="h-8 w-8 rounded-full bg-success/10 text-success flex items-center justify-center shrink-0">
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>

        {/* CARD 2: DESPESAS */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              DESPESAS
            </span>
            <p className="text-2xl font-semibold text-foreground tracking-tight">
              <CountUp value={totalDespesas} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">Despesas da clínica no período</p>
          </div>
          <div className="h-8 w-8 rounded-full bg-destructive/10 text-destructive/80 flex items-center justify-center shrink-0">
            <ArrowDownLeft className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>

        {/* CARD 3: RESULTADO DO PERÍODO */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              RESULTADO DO PERÍODO
            </span>
            <p className="text-2xl font-semibold text-foreground tracking-tight">
              <CountUp value={saldoFinal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">
              Entradas menos despesas (não inclui saldo inicial)
            </p>
          </div>
          <div className="h-8 w-8 rounded-full bg-info/10 text-info flex items-center justify-center shrink-0">
            <ArrowLeftRight className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* GRÁFICO PRINCIPAL ("MOVIMENTO POR DIA / SEMANA / ANO" - APEXCHARTS)        */}
      {/* ========================================================================= */}
      {showChart && (
        <GraficoFluxoDeCaixa
          customChartData={chartData}
          granularity={chartGranularity}
          onGranularityChange={setChartGranularity}
          periodLabel={periodLabel}
          startDate={start}
          endDate={end}
          onDateRangeChange={(s, e) => {
            setCustomStartDate(s);
            setCustomEndDate(e);
            setPeriodMode("custom");
          }}
          onSelectPeriodPreset={(preset) => {
            setPeriodMode(preset);
            if (preset === "ano") setChartGranularity("anual");
            else if (preset === "mes") setChartGranularity("mes");
            else if (preset === "semana") setChartGranularity("semana");
            else setChartGranularity("dia");
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* SEÇÃO COMPLETA DE LANÇAMENTOS E MOVIMENTAÇÕES                             */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-2">
        {/* Cabeçalho da Seção de Lançamentos com Botões: Planilha, Transferência, + Novo Lançamento */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-info flex items-center justify-center text-white shadow-2xs">
              <Landmark className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Lançamentos</h2>
              <p className="text-xs text-muted-foreground">
                Receitas, despesas e movimentações financeiras
              </p>
            </div>
          </div>

          {/* Botões de Ação Topo Direito (Excluir Todas, Planilha e Transferência) */}
          <div className="flex items-center gap-2 flex-wrap">

            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-card border-border text-foreground/80 text-xs font-medium gap-1.5 shadow-2xs hover:bg-muted/60 cursor-pointer"
              onClick={handleExportCsv}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
              Planilha
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-card border-border text-foreground/80 text-xs font-medium gap-1.5 shadow-2xs hover:bg-muted/60 cursor-pointer"
              onClick={() => setTransferOpen(true)}
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-info" />
              Transferência
            </Button>
          </div>
        </div>

        {/* Sub-abas (Lançamentos | Excluídos) */}
        <div className="flex items-center gap-4 border-b border-border text-xs font-semibold">
          <button
            type="button"
            className={cn(
              "pb-2.5 pt-1 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors",
              activeSubTab === "lancamentos"
                ? "border-info text-info"
                : "border-transparent text-muted-foreground hover:text-foreground/80",
            )}
            onClick={() => setActiveSubTab("lancamentos")}
          >
            <Tag className="h-3.5 w-3.5" /> Lançamentos
          </button>
          <button
            type="button"
            className={cn(
              "pb-2.5 pt-1 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors",
              activeSubTab === "excluidos"
                ? "border-info text-info"
                : "border-transparent text-muted-foreground hover:text-foreground/80",
            )}
            onClick={() => setActiveSubTab("excluidos")}
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluídos
          </button>
        </div>

        {/* Barra de Filtros */}
        <div className="rounded-xl border border-border bg-card p-3 shadow-2xs space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Busca por descrição ou paciente */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por desc..."
                className="pl-8 h-8 text-xs bg-card border-border rounded-lg placeholder:text-muted-foreground"
              />
            </div>

            {/* Segmented Buttons (Todos, Receitas, Despesas) */}
            <div className="inline-flex items-center bg-muted p-0.5 rounded-lg border border-border/50">
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  typeFilter === "todos"
                    ? "bg-info text-white shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTypeFilter("todos")}
              >
                Todos
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  typeFilter === "receitas"
                    ? "bg-info text-white shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTypeFilter("receitas")}
              >
                Receitas
              </button>
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  typeFilter === "despesas"
                    ? "bg-info text-white shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setTypeFilter("despesas")}
              >
                Despesas
              </button>
            </div>

            {/* Filtro por Natureza de Liquidação */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                aria-label="Natureza da movimentação realizada"
                className="h-8 w-auto min-w-[130px] text-xs bg-card border-border rounded-lg text-foreground/80"
              >
                <SelectValue placeholder="Todas Realizadas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas Realizadas</SelectItem>
                <SelectItem value="recebimento">Entradas Realizadas</SelectItem>
                <SelectItem value="pagamento">Saídas Realizadas</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro por Forma de Pagamento */}
            <Select value={formaFilter} onValueChange={setFormaFilter}>
              <SelectTrigger
                aria-label="Forma de pagamento"
                className="h-8 w-auto min-w-[115px] text-xs bg-card border-border rounded-lg text-foreground/80"
              >
                <SelectValue placeholder="Todas formas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas formas</SelectItem>
                <SelectItem value="dinheiro">Dinheiro</SelectItem>
                <SelectItem value="debito">Débito</SelectItem>
                <SelectItem value="credito">Crédito</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="transferencia">Transferência</SelectItem>
              </SelectContent>
            </Select>

            {/* Filtro por Origem / Conta */}
            <Select value={origemFilter} onValueChange={setOrigemFilter}>
              <SelectTrigger
                aria-label="Conta de origem"
                className="h-8 w-auto min-w-[125px] text-xs bg-card border-border rounded-lg text-foreground/80"
              >
                <SelectValue placeholder="Todas as contas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as contas</SelectItem>
                {availableAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.name}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro por Categoria / Área Médica */}
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger
                aria-label="Categoria / Procedimento"
                className="h-8 w-auto min-w-[120px] text-xs bg-card border-border rounded-lg text-foreground/80"
              >
                <SelectValue placeholder="Todas as áreas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as áreas</SelectItem>
                <SelectItem value="atendiment">Atendimentos / Consultas</SelectItem>
                <SelectItem value="procediment">Procedimentos</SelectItem>
                <SelectItem value="plano">Planos de Tratamento</SelectItem>
                <SelectItem value="insumo">Insumos & Medicamentos</SelectItem>
                <SelectItem value="administrativ">Despesas Administrativas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Período aplicado: {periodLabel}. Exportação desta lista respeita os filtros.
          </p>
        </div>

        {/* Banner Informativo da Regra de Ouro */}
        <div className="rounded-xl border border-info/20 bg-info/4 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-info shrink-0" />
            <p className="text-xs text-foreground/80 leading-relaxed">
              <strong className="text-foreground font-semibold">Fluxo de Caixa Realizado:</strong>{" "}
              Esta tela apresenta{" "}
              <strong className="font-semibold text-foreground">exclusivamente</strong> entradas e
              saídas que realmente se efetivaram no caixa e nas contas bancárias da clínica. Contas
              a receber e a pagar previstas/pendentes são geridas em suas respectivas abas.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-info/25 bg-card px-3 py-1 text-xs font-medium text-info shrink-0 shadow-2xs whitespace-nowrap">
            Movimentações realizadas
          </span>
        </div>

        {/* Tabela de Movimentações Financeiras */}
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-card hover:bg-card border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <TableHead className="w-[100px] text-muted-foreground">DATA</TableHead>
                  <TableHead className="text-muted-foreground">DESCRIÇÃO</TableHead>
                  <TableHead className="w-[110px] text-muted-foreground">FORMA</TableHead>
                  <TableHead className="w-[150px] text-muted-foreground">CONTA/CARTÃO</TableHead>
                  <TableHead className="w-[110px] text-center text-muted-foreground">
                    STATUS
                  </TableHead>
                  <TableHead className="w-[130px] text-right text-muted-foreground">
                    VALOR
                  </TableHead>
                  <TableHead className="w-[80px] text-right text-muted-foreground">AÇÕES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-sm text-muted-foreground"
                    >
                      Nenhuma movimentação encontrada para os filtros selecionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEntries.map((e) => {
                    const isDespesa = e.is_expense;
                    const dateStr = e.date || "";
                    let displayDate = "—";
                    let isCurrentDay = false;
                    if (dateStr) {
                      try {
                        const parsed = parseISO(dateStr);
                        if (!isNaN(parsed.getTime())) {
                          displayDate = format(parsed, "dd/MM/yy");
                          isCurrentDay = isToday(parsed);
                        } else {
                          displayDate = dateStr;
                        }
                      } catch {
                        displayDate = dateStr;
                      }
                    }

                    const contaCartao = (e.payment_account || "—").toUpperCase();
                    const forma = e.payment_method || "—";
                    const typeBadge = isDespesa ? "◆ DESPESA" : "◆ HONORÁRIO";
                    const categorySubtitle = (
                      e.category || (isDespesa ? "Despesas Gerais" : "Honorários Iniciais / Sinal")
                    ).toUpperCase();

                    return (
                      <TableRow
                        key={e.id}
                        className="hover:bg-muted/42 border-b border-border-soft text-xs"
                      >
                        {/* DATA */}
                        <TableCell className="align-middle py-3">
                          <span className="font-semibold text-foreground block text-xs">
                            {displayDate}
                          </span>
                          <span className="text-xs text-success font-medium block">
                            {isCurrentDay ? "Hoje" : "Realizado"}
                          </span>
                        </TableCell>

                        {/* DESCRIÇÃO */}
                        <TableCell className="align-middle py-3">
                          <div className="flex items-start gap-2">
                            <div
                              className={cn(
                                "h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                                isDespesa
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-success/10 text-success",
                              )}
                            >
                              {isDespesa ? (
                                <ArrowDownLeft className="h-3 w-3" strokeWidth={2.5} />
                              ) : (
                                <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
                              )}
                            </div>

                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                                  {typeBadge}
                                </span>

                                <span className="font-semibold text-foreground text-xs truncate">
                                  {e.description}
                                </span>
                              </div>

                              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
                                {categorySubtitle}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        {/* FORMA DE PAGAMENTO */}
                        <TableCell className="align-middle py-3 text-xs text-muted-foreground">
                          {forma}
                        </TableCell>

                        {/* CONTA / CAIXA */}
                        <TableCell className="align-middle py-3 font-semibold text-foreground/80 text-xs tracking-wider uppercase">
                          {contaCartao}
                        </TableCell>

                        {/* STATUS */}
                        <TableCell className="align-middle py-3 text-center">
                          <span
                            className={cn(
                              "inline-block px-2 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider",
                              e.status === "cancelado"
                                ? "bg-muted text-muted-foreground border border-border"
                                : isDespesa
                                  ? "bg-destructive/10 text-destructive border border-destructive/25"
                                  : "bg-success/10 text-success border border-success/25",
                            )}
                          >
                            {e.status === "cancelado"
                              ? "CANCELADO"
                              : isDespesa
                                ? "PAGO"
                                : "RECEBIDO"}
                          </span>
                        </TableCell>

                        {/* VALOR */}
                        <TableCell
                          className={cn(
                            "align-middle py-3 text-right font-semibold tabular-nums text-xs",
                            isDespesa ? "text-destructive" : "text-success",
                          )}
                        >
                          {isDespesa ? "- " : "+ "}
                          {currency(e.amount)}
                        </TableCell>

                        {/* AÇÕES */}
                        <TableCell className="align-middle py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {activeSubTab === "lancamentos" ? (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground/80 hover:bg-muted cursor-pointer"
                                  title="Ver histórico / Baixa"
                                  onClick={() => handleOpenEditOrHistory(e)}
                                  aria-label="Ver histórico"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>

                                {!isDespesa && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-info hover:text-info hover:bg-info/10 cursor-pointer"
                                    title="Recibo / Histórico"
                                    onClick={() => handleOpenEditOrHistory(e)}
                                    aria-label="Recibo"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                  </Button>
                                )}

                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                                  title="Excluir movimentação"
                                  onClick={() => handleOpenDelete(e)}
                                  aria-label="Excluir movimentação"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
              {filteredEntries.length > 0 &&
                (() => {
                  const totals = filteredEntries.reduce(
                    (acc, entry) => {
                      if (entry.status === "cancelado") return acc;
                      const amount = Number(entry.amount) || 0;
                      if (entry.is_expense) acc.saidas += amount;
                      else acc.entradas += amount;
                      return acc;
                    },
                    { entradas: 0, saidas: 0 },
                  );
                  const net = totals.entradas - totals.saidas;
                  return (
                    <TableFooter>
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="py-3 text-xs text-muted-foreground">
                          Total filtrado, sem cancelados · entradas{" "}
                          <span className="tabular-nums text-success">
                            {currency(totals.entradas)}
                          </span>{" "}
                          · saídas{" "}
                          <span className="tabular-nums text-destructive">
                            {currency(totals.saidas)}
                          </span>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "py-3 text-right text-xs tabular-nums",
                            net < 0 ? "text-destructive" : "text-success",
                          )}
                        >
                          {net < 0 ? "- " : "+ "}
                          {currency(Math.abs(net))}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  );
                })()}
            </Table>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PAINEL DE POSIÇÃO E CONFERÊNCIA POR CONTA BANCÁRIA (AUDITORIA CONTÁBIL)   */}
      {/* ========================================================================= */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Posição e Fechamento por Conta Bancária
            </h3>
            <p className="text-xs text-muted-foreground">
              Saldos de abertura, movimentações consolidadas e conciliação por conta.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-semibold cursor-pointer"
            onClick={() => setShowAccountAudit((v) => !v)}
          >
            {showAccountAudit ? "Ocultar Detalhamento" : "Exibir Detalhamento"}
          </Button>
        </div>

        {showAccountAudit && result && (
          <div className="space-y-4 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/30 p-4">
                <span className="text-xs text-muted-foreground block">
                  Saldo disponível em caixa/bancos
                </span>
                <strong className="text-lg font-semibold text-foreground">
                  {balance(result.available)}
                </strong>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <span className="text-xs text-muted-foreground block">
                  Recebíveis futuros de cartão (a liquidar)
                </span>
                <strong className="text-lg font-semibold text-foreground">
                  {balance(result.receivable)}
                </strong>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase font-semibold text-muted-foreground">
                  <tr>
                    {[
                      "Conta / Abertura",
                      "Saldo Anterior",
                      "Recebimentos",
                      "Pagamentos",
                      "Resultado",
                      "Transferências",
                      "Saldo Final",
                    ].map((h) => (
                      <th key={h} className="p-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.account.id} className="border-t text-xs">
                      <td className="p-3">
                        <strong className="text-foreground block">{r.account.name}</strong>
                        <span className="text-xs text-muted-foreground">
                          {r.account.kind === "available"
                            ? "Caixa / Banco"
                            : "Recebíveis de Cartão"}
                        </span>
                      </td>
                      {[r.opening, r.income, r.expense, r.result, r.transfers, r.closing].map(
                        (v, i) => (
                          <td key={i} className="p-3 tabular-nums font-medium">
                            {balance(v)}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedScope?.can_accounts && (
              <div className="pt-2">
                <OpeningForm accounts={query.data?.accounts || []} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL DE TRANSFERÊNCIA ENTRE CONTAS BANCÁRIAS                             */}
      {/* ========================================================================= */}
      <Dialog
        open={transferOpen}
        onOpenChange={(open) => {
          if (!transferring) setTransferOpen(open);
        }}
      >
        <DialogContent
          className="sm:max-w-[460px]"
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-info" />
              Transferência entre Contas
            </DialogTitle>
            <DialogDescription className="text-xs">
              Registre uma transferência já realizada entre suas contas ou caixas da clínica. Esta
              ação não movimenta dinheiro no banco real.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Conta de Origem (Saída)</Label>
                <Select value={transferFrom} onValueChange={setTransferFrom}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Conta de Destino (Entrada)</Label>
                <Select value={transferTo} onValueChange={setTransferTo}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Valor da Transferência (R$) *</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={transferAmount || ""}
                onChange={(e) => setTransferAmount(Number(e.target.value) || 0)}
                placeholder="0,00"
                className="h-9 text-sm font-semibold"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Observações / Motivo</Label>
              <Input
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                placeholder="Ex: Suprimento de caixa, resgate de honorários, aporte..."
                className="h-9 text-sm"
              />
            </div>

            {transferError && (
              <p className="text-xs text-destructive font-medium">{transferError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={transferring}
              onClick={() => setTransferOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary-hover text-white font-semibold gap-1.5 cursor-pointer"
              disabled={transferring || availableAccounts.length < 2 || !transferAmount}
              onClick={handleExecuteTransfer}
            >
              <CheckCircle2 className="h-4 w-4" />
              {transferring ? "Registrando..." : "Confirmar transferência"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE MOVIMENTAÇÃO                          */}
      {/* ========================================================================= */}
      <Dialog
        open={deleteModalOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setDeleteModalOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-destructive/15 text-destructive flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-foreground">
                  Excluir movimentação
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Esta ação estornará o lançamento do fluxo de caixa e moverá o registro para a aba
                  de excluídos.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {entryToDelete && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-border bg-muted/42 p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Descrição:</span>
                  <span className="font-semibold text-foreground text-right">
                    {entryToDelete.description}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Valor:</span>
                  <span
                    className={cn(
                      "font-semibold text-sm",
                      entryToDelete.is_expense ? "text-destructive" : "text-success",
                    )}
                  >
                    {entryToDelete.is_expense ? "- " : "+ "}
                    {currency(entryToDelete.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Conta:</span>
                  <span className="font-medium text-foreground/80">
                    {entryToDelete.payment_account}
                  </span>
                </div>
                {entryToDelete.client_name && entryToDelete.client_name !== "Avulso" && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Paciente / Pagador:</span>
                    <span className="font-medium text-foreground/80">
                      {entryToDelete.client_name}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="delete-reason" className="text-xs font-semibold text-foreground/80">
                  Motivo do estorno (obrigatório, mínimo 5 caracteres)
                </Label>
                <Input
                  id="delete-reason"
                  placeholder="Ex: Lançamento duplicado, cancelamento, etc."
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs h-9"
              onClick={() => setDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="text-xs h-9 bg-destructive hover:bg-destructive/90 text-white gap-1.5 font-semibold cursor-pointer"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>Excluindo...</>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir Movimentação
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Interno de Histórico e Baixa (quando aberto diretamente da tabela) */}
      {currentSelectedTitle && (
        <PaymentHistory
          key={currentSelectedTitle.id}
          title={currentSelectedTitle}
          data={finance}
          onClose={() => setInternalSelectedTitleId(null)}
        />
      )}
    </div>
  );
}

function OpeningForm({ accounts }: { accounts: CashAccount[] }) {
  const qc = useQueryClient();
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDate());
  const [kind, setKind] = useState("available");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const negative = amount.trim().startsWith("-");
      const value =
        (moneyCents(negative ? amount.trim().slice(1) : amount) / 100) * (negative ? -1 : 1);
      setSubmitted(true);
      const { error } = await supabase.rpc("confirm_financial_opening", {
        p_account_id: account,
        p_amount: value,
        p_date: date,
        p_kind: kind,
        p_reference: reference,
      });
      if (error) {
        if (error.code === "P0001") setSubmitted(false);
        throw error;
      }
      setAccount("");
      setAmount("");
      setReference("");
      setSubmitted(false);
      await refreshFinance(qc);
      toast.success("Abertura de saldo confirmada com sucesso!");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const unconfirmedAccounts = accounts.filter((a) => !a.opening_date);
  if (unconfirmedAccounts.length === 0) return null;

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border bg-muted/36 p-4">
      <h4 className="font-semibold text-sm text-foreground">Confirmar saldo de abertura</h4>
      <p className="text-xs text-muted-foreground">
        Informe o saldo inicial conferido no início da data escolhida para a conta.
      </p>
      <fieldset disabled={busy || submitted} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Conta</Label>
          <select
            required
            className="w-full rounded-lg border border-border p-2 text-xs bg-card"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Selecione</option>
            {unconfirmedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Saldo Inicial (R$)</Label>
          <input
            required
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-border p-2 text-xs bg-card"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Data de Abertura</Label>
          <input
            required
            type="date"
            max={localDate()}
            className="w-full rounded-lg border border-border p-2 text-xs bg-card"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            size="sm"
            type="submit"
            disabled={busy || submitted || !account || !amount}
            className="w-full bg-primary hover:bg-primary-hover text-white font-semibold text-xs"
          >
            {busy ? "Salvando..." : "Confirmar Saldo"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export { CashFlow as FluxoDeCaixaTab };
export default CashFlow;
