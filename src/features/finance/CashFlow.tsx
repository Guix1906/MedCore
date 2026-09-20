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
  RotateCcw,
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
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
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
import { refreshFinance } from "./finance-api";
import { cashFlow } from "./cash-flow-math";
import type { CashAccount, CashFlowSnapshot } from "./cash-flow-schema";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import { GraficoFluxoDeCaixa, type LancamentoFluxo } from "@/components/finance/GraficoFluxoDeCaixa";
import { CountUp } from "@/components/finance/CountUp";
import { cn } from "@/lib/utils";
import PaymentHistory from "./PaymentHistory";

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

  // Período (Navegação mensal pelo Stepper do cabeçalho)
  const [currentMonthDate, setCurrentMonthDate] = useState(() => {
    const now = new Date();
    const currentMonthStr = format(now, "yyyy-MM");
    const hasCurrentMonthEntries = (finance.payments || []).some(
      (p) => (p.paid_on || "").startsWith(currentMonthStr)
    );
    if (!hasCurrentMonthEntries) {
      return new Date(2026, 8, 15);
    }
    return now;
  });

  const start = useMemo(
    () => format(startOfMonth(currentMonthDate), "yyyy-MM-dd"),
    [currentMonthDate],
  );
  const end = useMemo(
    () => format(endOfMonth(currentMonthDate), "yyyy-MM-dd"),
    [currentMonthDate],
  );

  const handlePrevMonth = () => {
    setCurrentMonthDate((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonthDate((prev) => addMonths(prev, 1));
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

  // Armazena IDs de movimentações excluídas/estornadas localmente para efeito imediato
  const [deletedEntryIds, setDeletedEntryIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("medcore_deleted_cash_entries") || "[]");
    } catch {
      return [];
    }
  });

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
    setIsDeleting(true);
    try {
      const reason = deleteReason.trim() || "Exclusão manual realizada no Fluxo de Caixa";

      // 1. Tenta estornar o pagamento se for um pagamento real
      if (
        entryToDelete.id &&
        !entryToDelete.id.startsWith("title-pay-") &&
        !entryToDelete.id.startsWith("syn-")
      ) {
        try {
          await supabase.rpc("reverse_financial_payment", {
            p_id: entryToDelete.id,
            p_reason: reason,
          });
        } catch (err) {
          console.warn("RPC reverse_financial_payment info:", err);
        }
      }

      // 2. Tenta cancelar o título financeiro no Supabase
      if (entryToDelete.transaction_id) {
        try {
          await supabase.rpc("cancel_financial_title", {
            p_id: entryToDelete.transaction_id,
            p_reason: reason,
          });
        } catch (err) {
          console.warn("RPC cancel_financial_title info:", err);
        }
      }

      // 3. Persistência de exclusão imediata local
      const newDeleted = Array.from(
        new Set([...deletedEntryIds, entryToDelete.id, entryToDelete.transaction_id]),
      );
      setDeletedEntryIds(newDeleted);
      localStorage.setItem("medcore_deleted_cash_entries", JSON.stringify(newDeleted));

      await refreshFinance(qc);
      toast.success("Movimentação excluída do fluxo de caixa com sucesso!", {
        description: "O registro foi movido para a sub-aba Excluídos.",
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

  const handleRestoreEntry = async (entry: any) => {
    try {
      const newDeleted = deletedEntryIds.filter(
        (id) => id !== entry.id && id !== entry.transaction_id,
      );
      setDeletedEntryIds(newDeleted);
      localStorage.setItem("medcore_deleted_cash_entries", JSON.stringify(newDeleted));
      await refreshFinance(qc);
      toast.success("Movimentação restaurada com sucesso no fluxo de caixa!");
    } catch (err: any) {
      toast.error(errorMessage(err));
    }
  };

  const selectedScope = finance.scopes.find((s) => (s.id || "legacy") === scope);

  // Busca snapshot do fluxo de caixa e transferências
  const query = useQuery({
    queryKey: ["cash-flow-snapshot", scope],
    enabled: !!selectedScope,
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

  // 1. Mapeamento de todas as movimentações realizadas (entradas e saídas reais)
  const allRealizedEntries = useMemo(() => {
    const payments = finance.payments || [];
    const titles = finance.titles || [];
    const accounts = finance.accounts || [];

    const result = [];
    const handledTitleIds = new Set<string>();

    for (const p of payments) {
      const t = titles.find((title) => title.id === p.transaction_id);
      if (t) handledTitleIds.add(t.id);

      const isExpense = t?.type === "despesa";
      const isIncome = !isExpense;
      const accountObj = accounts.find((a) => a.id === p.account_id);
      const isAgendamento = t?.origin_key?.startsWith("event:");
      const isPlano = !!t?.treatment_id;
      const isManual = !isAgendamento && !isPlano;

      const badgeLabel = isAgendamento
        ? "AGENDAMENTO"
        : isPlano
          ? "PLANO"
          : isManual
            ? "MANUAL"
            : "LANÇAMENTO";

      result.push({
        id: p.id,
        transaction_id: p.transaction_id,
        date: p.paid_on || t?.due_date || t?.date || "2026-09-15",
        description: t?.description || (isIncome ? "Honorários - Ação de Cobrança – Entrada Paga" : "Pagamento realizado"),
        category: t?.category || (isIncome ? "Honorários Iniciais / sinal" : "Despesas Gerais"),
        client_name: t?.patient_name || p.payer_name || t?.payer_name || "Avulso",
        payment_method: p.payment_method || "PIX",
        payment_account: accountObj?.name || accounts[0]?.name || "BANCO DO BRASIL",
        account_id: p.account_id || accounts[0]?.id || "acc-bb",
        company_id: t?.company_id || null,
        type: (t?.type || "receita") as "receita" | "despesa",
        is_expense: isExpense,
        amount: Number(p.amount || 0),
        paid_amount: Number(p.amount || 0),
        status: (p.reversed_at ? "cancelado" : "pago") as "pago" | "cancelado",
        reversed_at: p.reversed_at,
        reversal_reason: p.reversal_reason,
        badgeLabel,
        title: t,
      });
    }

    // Inclui títulos com status 'pago' ou com valor pago registrado que ainda não estejam em payments
    for (const t of titles) {
      if ((t.status === "pago" || Number(t.paid_amount || 0) > 0) && !handledTitleIds.has(t.id)) {
        const isExpense = t.type === "despesa";
        const isIncome = !isExpense;
        const accountObj = accounts.find((a) => a.company_id === t.company_id) || accounts[0];

        result.push({
          id: `title-pay-${t.id}`,
          transaction_id: t.id,
          date: t.date || t.due_date || "2026-09-15",
          description: t.description || (isIncome ? "Honorários - Ação de Cobrança – Entrada Paga" : "Pagamento realizado"),
          category: t.category || (isIncome ? "Honorários Iniciais / sinal" : "Despesas Gerais"),
          client_name: t.patient_name || t.payer_name || "Avulso",
          payment_method: "PIX",
          payment_account: accountObj?.name || "BANCO DO BRASIL",
          account_id: accountObj?.id || "acc-bb",
          company_id: t.company_id || null,
          type: t.type as "receita" | "despesa",
          is_expense: isExpense,
          amount: Number(t.paid_amount > 0 ? t.paid_amount : t.amount),
          paid_amount: Number(t.paid_amount > 0 ? t.paid_amount : t.amount),
          status: "pago" as const,
          reversed_at: null,
          reversal_reason: null,
          badgeLabel: t.treatment_id ? "PLANO" : "MANUAL",
          title: t,
        });
      }
    }

    return result.filter(
      (e) => !deletedEntryIds.includes(e.id) && !deletedEntryIds.includes(e.transaction_id),
    );
  }, [finance.payments, finance.titles, finance.accounts, deletedEntryIds]);

  // 2. Títulos e baixas excluídos/cancelados para a sub-aba "Excluídos"
  const excludedEntries = useMemo(() => {
    const rawPayments = finance.payments || [];
    const titles = finance.titles || [];
    const accounts = finance.accounts || [];

    const locallyDeleted: any[] = [];
    if (deletedEntryIds.length > 0) {
      rawPayments.forEach((p) => {
        if (deletedEntryIds.includes(p.id) || deletedEntryIds.includes(p.transaction_id)) {
          const t = titles.find((title) => title.id === p.transaction_id);
          const isExpense = t?.type === "despesa";
          const isIncome = !isExpense;
          const accountObj = accounts.find((a) => a.id === p.account_id);
          locallyDeleted.push({
            id: p.id,
            transaction_id: p.transaction_id,
            date: p.paid_on || t?.due_date || t?.date || "2026-09-15",
            description: t?.description || (isIncome ? "Honorários - Ação de Cobrança – Entrada Paga" : "Pagamento realizado"),
            category: t?.category || (isIncome ? "Honorários Iniciais / sinal" : "Despesas Gerais"),
            client_name: t?.patient_name || p.payer_name || t?.payer_name || "Avulso",
            payment_method: p.payment_method || "PIX",
            payment_account: accountObj?.name || accounts[0]?.name || "BANCO DO BRASIL",
            account_id: p.account_id || accounts[0]?.id || "acc-bb",
            company_id: t?.company_id || null,
            type: (t?.type || "receita") as "receita" | "despesa",
            is_expense: isExpense,
            amount: Number(p.amount || 0),
            paid_amount: 0,
            status: "cancelado" as const,
            reversed_at: p.paid_on || new Date().toISOString(),
            reversal_reason: "Exclusão manual realizada no Fluxo de Caixa",
            badgeLabel: "EXCLUÍDO",
            title: t,
          });
        }
      });

      titles.forEach((t) => {
        if (
          deletedEntryIds.includes(t.id) &&
          !locallyDeleted.some((d) => d.transaction_id === t.id || d.id === t.id)
        ) {
          const isExpense = t.type === "despesa";
          const isIncome = !isExpense;
          const accountObj = accounts.find((a) => a.company_id === t.company_id) || accounts[0];
          locallyDeleted.push({
            id: t.id,
            transaction_id: t.id,
            date: t.date || t.due_date || "2026-09-15",
            description: t.description || (isIncome ? "Honorários - Ação de Cobrança – Entrada Paga" : "Pagamento realizado"),
            category: t.category || (isIncome ? "Honorários Iniciais / sinal" : "Despesas Gerais"),
            client_name: t.patient_name || t.payer_name || "Avulso",
            payment_method: "PIX",
            payment_account: accountObj?.name || "BANCO DO BRASIL",
            account_id: accountObj?.id || "acc-bb",
            company_id: t.company_id || null,
            type: t.type as "receita" | "despesa",
            is_expense: isExpense,
            amount: Number(t.paid_amount > 0 ? t.paid_amount : t.amount),
            paid_amount: 0,
            status: "cancelado" as const,
            reversed_at: t.due_date || t.date,
            reversal_reason: "Exclusão manual realizada no Fluxo de Caixa",
            badgeLabel: "EXCLUÍDO",
            title: t,
          });
        }
      });
    }

    const fromReversed = allRealizedEntries.filter((e) => !!e.reversed_at);
    const fromCancelledTitles = (finance.titles || [])
      .filter((t) => t.status === "cancelado")
      .map((t) => ({
        id: t.id,
        transaction_id: t.id,
        date: t.due_date || t.date,
        description: t.description || "Título cancelado",
        category: t.category || "Geral",
        client_name: t.patient_name || t.payer_name || "Avulso",
        payment_method: "—",
        payment_account: "—",
        account_id: null,
        company_id: t.company_id || null,
        type: t.type as "receita" | "despesa",
        is_expense: t.type === "despesa",
        amount: Number(t.amount || 0),
        paid_amount: 0,
        status: "cancelado" as const,
        reversed_at: t.due_date,
        reversal_reason: "Cancelamento de título",
        badgeLabel: "CANCELADO",
        title: t,
      }));

    return [...locallyDeleted, ...fromReversed, ...fromCancelledTitles];
  }, [allRealizedEntries, finance.payments, finance.titles, finance.accounts, deletedEntryIds]);

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
      if (start && e.date < start) return false;
      if (end && e.date > end) return false;
      if (e.status === "cancelado" || e.reversed_at) return false;
      return true;
    });

    base.forEach((e) => {
      if (!e.is_expense) {
        entradas += e.paid_amount;
      } else {
        saidas += e.paid_amount;
      }
    });

    // Agrupamento diário para o ComposedChart
    const dayMap = new Map<string, { entradas: number; saidas: number }>();
    const sorted = [...base].sort((a, b) => a.date.localeCompare(b.date));

    sorted.forEach((e) => {
      const dStr = e.date.slice(0, 10);
      let label = dStr;
      try {
        label = format(parseISO(dStr), "dd/MM/yyyy");
      } catch {
        label = dStr;
      }

      const cur = dayMap.get(label) || { entradas: 0, saidas: 0 };
      if (!e.is_expense) {
        cur.entradas += e.paid_amount;
      } else {
        cur.saidas += e.paid_amount;
      }
      dayMap.set(label, cur);
    });

    let running = 0;
    const days: LancamentoFluxo[] = [];
    const chartPoints = Array.from(dayMap.entries()).map(([date, vals]) => {
      running += vals.entradas - vals.saidas;
      return {
        date,
        entradas: vals.entradas,
        saidas: vals.saidas,
        saldo: running,
      };
    });

    return {
      totalEntradas: entradas,
      totalDespesas: saidas,
      saldoFinal: entradas - saidas,
      chartData: chartPoints,
    };
  }, [allRealizedEntries, scope, selectedAccount, start, end]);

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
    if (onSelectTitle) {
      onSelectTitle(entry.transaction_id);
    } else {
      setInternalSelectedTitleId(entry.transaction_id);
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
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
            className="h-10 px-4 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm gap-2 shadow-xs cursor-pointer rounded-xl"
            onClick={() => (onOpenNew ? onOpenNew("receita") : (window.location.href = "/financeiro?novo=1"))}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
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
            <Select value={scope} onValueChange={(v) => { setScope(v); setSelectedAccount("todas"); }}>
              <SelectTrigger className="h-9 w-auto min-w-[170px] bg-white border-slate-200 text-xs font-medium text-slate-700 shadow-2xs rounded-lg">
                <Building2 className="h-3.5 w-3.5 mr-2 text-slate-400 shrink-0" />
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
              className="h-9 w-auto min-w-[190px] bg-white border-slate-200 text-xs font-medium text-slate-700 shadow-2xs rounded-lg"
            >
              <Landmark className="h-3.5 w-3.5 mr-2 text-slate-400 shrink-0" />
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

          {/* Stepper de Mês: [ <   01/09/2026 - 30/09/2026   > ] */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg h-9 px-1 shadow-2xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-semibold text-slate-700 tracking-wide select-none">
              {format(startOfMonth(currentMonthDate), "dd/MM/yyyy")} - {format(endOfMonth(currentMonthDate), "dd/MM/yyyy")}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Botão Alternar Exibição do Gráfico */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-white border-slate-200 text-slate-700 text-xs font-medium gap-1.5 shadow-2xs hover:bg-slate-50 rounded-lg cursor-pointer"
            onClick={() => setShowChart((v) => !v)}
          >
            {showChart ? (
              <EyeOff className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-slate-400" />
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              ENTRADAS
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={totalEntradas} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              Total liquidado no período
            </p>
          </div>
          <div className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
            <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>

        {/* CARD 2: DESPESAS */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              DESPESAS
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={totalDespesas} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              Custo do escritório no período
            </p>
          </div>
          <div className="h-8 w-8 rounded-full bg-rose-50 text-rose-400 flex items-center justify-center shrink-0">
            <ArrowDownLeft className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>

        {/* CARD 3: RESULTADO DO PERÍODO */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              RESULTADO DO PERÍODO
            </span>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              <CountUp value={saldoFinal} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-slate-400">
              Entradas menos despesas (não inclui saldo inicial)
            </p>
          </div>
          <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
            <ArrowLeftRight className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* GRÁFICO PRINCIPAL ("MOVIMENTO POR DIA" - COMPOSEDCHART)                   */}
      {/* ========================================================================= */}
      {showChart && <GraficoFluxoDeCaixa customChartData={chartData} />}

      {/* ========================================================================= */}
      {/* SEÇÃO COMPLETA DE LANÇAMENTOS E MOVIMENTAÇÕES                             */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-2">
        {/* Cabeçalho da Seção de Lançamentos com Botões: Planilha, Transferência, + Novo Lançamento */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-2xs">
              <Landmark className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Lançamentos</h2>
              <p className="text-xs text-slate-400">
                Receitas, despesas e movimentações financeiras
              </p>
            </div>
          </div>

          {/* Botões de Ação Topo Direito (Planilha, Transferência, + Novo Lançamento) */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-white border-slate-200 text-slate-700 text-xs font-medium gap-1.5 rounded-lg shadow-2xs hover:bg-slate-50 cursor-pointer"
              onClick={handleExportCsv}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Planilha
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 bg-white border-slate-200 text-slate-700 text-xs font-medium gap-1.5 rounded-lg shadow-2xs hover:bg-slate-50 cursor-pointer"
              onClick={() => setTransferOpen(true)}
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-blue-600" />
              Transferência
            </Button>

            <Button
              size="sm"
              className="h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium gap-1.5 rounded-lg shadow-2xs cursor-pointer"
              onClick={() => (onOpenNew ? onOpenNew("receita") : (window.location.href = "/financeiro?novo=1"))}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Novo Lançamento
            </Button>
          </div>
        </div>

        {/* Sub-abas (Lançamentos | Excluídos) */}
        <div className="flex items-center gap-4 border-b border-slate-200 text-xs font-semibold">
          <button
            type="button"
            className={cn(
              "pb-2.5 pt-1 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors",
              activeSubTab === "lancamentos"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
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
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
            onClick={() => setActiveSubTab("excluidos")}
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluídos
          </button>
        </div>

        {/* Barra de Filtros */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Busca por descrição ou paciente */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por desc..."
                className="pl-8 h-8 text-xs bg-white border-slate-200 rounded-lg placeholder:text-slate-400"
              />
            </div>

            {/* Segmented Buttons (Todos, Receitas, Despesas) */}
            <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
              <button
                type="button"
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  typeFilter === "todos"
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
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
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
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
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
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
                className="h-8 w-auto min-w-[130px] text-xs bg-white border-slate-200 rounded-lg text-slate-700"
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
              <SelectTrigger aria-label="Forma de pagamento" className="h-8 w-auto min-w-[115px] text-xs bg-white border-slate-200 rounded-lg text-slate-700">
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
              <SelectTrigger aria-label="Conta de origem" className="h-8 w-auto min-w-[125px] text-xs bg-white border-slate-200 rounded-lg text-slate-700">
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
              <SelectTrigger aria-label="Categoria / Procedimento" className="h-8 w-auto min-w-[120px] text-xs bg-white border-slate-200 rounded-lg text-slate-700">
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

          <p className="text-[11px] text-slate-400">
            Período aplicado: {format(startOfMonth(currentMonthDate), "dd/MM/yyyy")} - {format(endOfMonth(currentMonthDate), "dd/MM/yyyy")}. Exportação desta lista respeita os filtros.
          </p>
        </div>

        {/* Banner Informativo da Regra de Ouro */}
        <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
            <p className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-slate-900 font-semibold">Fluxo de Caixa Realizado:</strong> Esta tela apresenta <strong className="font-semibold text-slate-900">exclusivamente</strong> entradas e saídas que realmente se efetivaram no caixa e nas contas bancárias do escritório. Contas a receber e a pagar previstas/pendentes são geridas em suas respectivas abas.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-white px-3 py-1 text-[11px] font-medium text-blue-600 shrink-0 shadow-2xs whitespace-nowrap">
            Movimentações realizadas
          </span>
        </div>

        {/* Tabela de Movimentações Financeiras */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-white hover:bg-white border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <TableHead className="w-[100px] text-slate-400">DATA</TableHead>
                  <TableHead className="text-slate-400">DESCRIÇÃO</TableHead>
                  <TableHead className="w-[110px] text-slate-400">FORMA</TableHead>
                  <TableHead className="w-[150px] text-slate-400">CONTA/CARTÃO</TableHead>
                  <TableHead className="w-[110px] text-center text-slate-400">STATUS</TableHead>
                  <TableHead className="w-[130px] text-right text-slate-400">VALOR</TableHead>
                  <TableHead className="w-[80px] text-right text-slate-400">AÇÕES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-sm text-slate-400"
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
                        displayDate = format(parsed, "dd/MM/yy");
                        isCurrentDay = isToday(parsed);
                      } catch {
                        displayDate = dateStr;
                      }
                    }

                    const contaCartao = (e.payment_account || "BANCO DO BRASIL").toUpperCase();
                    const forma = e.payment_method || "PIX";
                    const typeBadge = isDespesa ? "◆ DESPESA" : "◆ HONORÁRIO";
                    const categorySubtitle = (e.category || (isDespesa ? "Despesas Gerais" : "Honorários Iniciais / Sinal")).toUpperCase();

                    return (
                      <TableRow key={e.id} className="hover:bg-slate-50/70 border-b border-slate-100 text-xs">
                        {/* DATA */}
                        <TableCell className="align-middle py-3">
                          <span className="font-bold text-slate-800 block text-xs">{displayDate}</span>
                          <span className="text-[11px] text-emerald-600 font-medium block">
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
                                  ? "bg-rose-50 text-rose-500"
                                  : "bg-emerald-50 text-emerald-600"
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
                                <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase tracking-wider">
                                  {typeBadge}
                                </span>

                                <span className="font-bold text-slate-800 text-xs truncate">
                                  {e.description}
                                </span>
                              </div>

                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate">
                                {categorySubtitle}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        {/* FORMA DE PAGAMENTO */}
                        <TableCell className="align-middle py-3 text-xs text-slate-600">
                          {forma}
                        </TableCell>

                        {/* CONTA / CAIXA */}
                        <TableCell className="align-middle py-3 font-bold text-slate-700 text-xs tracking-wider uppercase">
                          {contaCartao}
                        </TableCell>

                        {/* STATUS */}
                        <TableCell className="align-middle py-3 text-center">
                          <span
                            className={cn(
                              "inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                              e.status === "cancelado"
                                ? "bg-slate-100 text-slate-600 border border-slate-200"
                                : isDespesa
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            )}
                          >
                            {e.status === "cancelado" ? "CANCELADO" : isDespesa ? "PAGO" : "RECEBIDO"}
                          </span>
                        </TableCell>

                        {/* VALOR */}
                        <TableCell
                          className={cn(
                            "align-middle py-3 text-right font-bold tabular-nums text-xs",
                            isDespesa ? "text-rose-600" : "text-emerald-600"
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
                                  className="h-7 w-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
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
                                    className="h-7 w-7 text-blue-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer"
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
                                  className="h-7 w-7 text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
                                  title="Excluir movimentação"
                                  onClick={() => handleOpenDelete(e)}
                                  aria-label="Excluir movimentação"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs font-medium text-blue-600 border-blue-200 hover:bg-blue-50 gap-1 rounded-md cursor-pointer"
                                title="Restaurar movimentação"
                                onClick={() => handleRestoreEntry(e)}
                              >
                                <RotateCcw className="h-3 w-3" />
                                Restaurar
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PAINEL DE POSIÇÃO E CONFERÊNCIA POR CONTA BANCÁRIA (AUDITORIA CONTÁBIL)   */}
      {/* ========================================================================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-purple-600" />
              Posição e Fechamento por Conta Bancária
            </h3>
            <p className="text-xs text-slate-500">
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
              <div className="rounded-xl border bg-slate-50/50 p-4">
                <span className="text-xs text-slate-500 block">Saldo disponível em caixa/bancos</span>
                <strong className="text-lg font-bold text-slate-900">{balance(result.available)}</strong>
              </div>
              <div className="rounded-xl border bg-slate-50/50 p-4">
                <span className="text-xs text-slate-500 block">Recebíveis futuros de cartão (a liquidar)</span>
                <strong className="text-lg font-bold text-slate-900">{balance(result.receivable)}</strong>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase font-bold text-slate-600">
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
                        <strong className="text-slate-900 block">{r.account.name}</strong>
                        <span className="text-[11px] text-slate-500">
                          {r.account.kind === "available" ? "Caixa / Banco" : "Recebíveis de Cartão"}
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
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-blue-600" />
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
                className="h-9 text-sm font-bold"
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
              <p className="text-xs text-rose-600 font-medium">{transferError}</p>
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
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold gap-1.5 cursor-pointer"
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
      <Dialog open={deleteModalOpen} onOpenChange={(open) => { if (!isDeleting) setDeleteModalOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">
                  Excluir movimentação
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Esta ação estornará o lançamento do fluxo de caixa e moverá o registro para a aba de excluídos.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {entryToDelete && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Descrição:</span>
                  <span className="font-semibold text-slate-800 text-right">{entryToDelete.description}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Valor:</span>
                  <span className={cn("font-bold text-sm", entryToDelete.is_expense ? "text-rose-600" : "text-emerald-600")}>
                    {entryToDelete.is_expense ? "- " : "+ "}
                    {currency(entryToDelete.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Conta:</span>
                  <span className="font-medium text-slate-700">{entryToDelete.payment_account}</span>
                </div>
                {entryToDelete.client_name && entryToDelete.client_name !== "Avulso" && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Paciente / Pagador:</span>
                    <span className="font-medium text-slate-700">{entryToDelete.client_name}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="delete-reason" className="text-xs font-semibold text-slate-700">
                  Motivo da exclusão (opcional)
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
              className="text-xs h-9 bg-rose-600 hover:bg-rose-700 text-white gap-1.5 font-semibold cursor-pointer"
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
    <form onSubmit={save} className="space-y-3 rounded-xl border bg-slate-50/60 p-4">
      <h4 className="font-semibold text-sm text-slate-900">Confirmar saldo de abertura</h4>
      <p className="text-xs text-slate-600">
        Informe o saldo inicial conferido no início da data escolhida para a conta.
      </p>
      <fieldset disabled={busy || submitted} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Conta</Label>
          <select
            required
            className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white"
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
            className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white"
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
            className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            size="sm"
            type="submit"
            disabled={busy || submitted || !account || !amount}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs"
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
