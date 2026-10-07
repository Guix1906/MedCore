import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  Calendar as CalendarIcon,
  Landmark,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  FileSpreadsheet,
  Search,
  CheckCircle2,
  Pencil,
  Trash2,
  Tag,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  format,
  parseISO,
  isToday,
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
  differenceInCalendarDays,
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
  paymentMethodLabel,
} from "@/features/acompanhamentos/followup-utils";
import { refreshFinance, getTitleEventKey } from "./finance-api";
import { remaining, reportingRows } from "./finance-math";
import { dateSearchText } from "./PeriodFilter";
import { CashFlowChartCard, type CashFlowPeriod } from "@/components/finance/CashFlowChartCard";
import { cashFlow } from "./cash-flow-math";
import type { CashAccount, CashFlowSnapshot } from "./cash-flow-schema";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import type { OperationsSnapshot } from "./operations-schema";
import type { LancamentoFluxo } from "@/components/finance/GraficoFluxoDeCaixa";
import { CountUp } from "@/components/finance/CountUp";
import { cn } from "@/lib/utils";
import PaymentHistory from "./PaymentHistory";

// effectiveDate: data usada nos filtros de período. Para previstos vencidos e em aberto é hoje,
// a mesma regra dos cards de previsão.
type CashEntry = LancamentoFluxo & { date: string; effectiveDate?: string };

// Comparação sem acento e sem caixa (ex.: "Débito" casa com "debito")
const normalize = (value: string | null | undefined) =>
  (value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// "Acompanhamento: Plano X - Parcela 2" -> "Parcela 2 · Plano X": o que muda entre as linhas vem primeiro
const entryDescription = (description: string | null | undefined) => {
  const text = (description || "").replace(/^Acompanhamento:\s*/i, "").trim();
  const m = text.match(/^(.*?)\s+-\s+((?:Parcela\s+\d+|Entrada|Saldo livre).*)$/i);
  return m ? `${m[2]} · ${m[1]}` : text;
};

const todayIso = () => format(new Date(), "yyyy-MM-dd");

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
  // Com uma única clínica já começa nela (o saldo por conta depende de uma clínica selecionada)
  const [scope, setScope] = useState<string>(() =>
    finance.scopes.length === 1 ? finance.scopes[0].id || "legacy" : "all",
  );
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
  const customRangeInvalid =
    periodMode === "custom" && !!customStartDate && !!customEndDate && customStartDate > customEndDate;

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
      // Datas invertidas: aplica o intervalo na ordem certa em vez de esvaziar a lista
      const inverted = !!customStartDate && !!customEndDate && customStartDate > customEndDate;
      return {
        start: inverted ? customEndDate : customStartDate,
        end: inverted ? customStartDate : customEndDate,
        periodLabel: `${sLabel} - ${eLabel}`,
      };
    }
    // Default: "mes"
    const s = startOfMonth(currentPeriodDate);
    const e = endOfMonth(currentPeriodDate);
    const monthLabel = format(s, "MMMM yyyy", { locale: ptBR });
    return {
      start: format(s, "yyyy-MM-dd"),
      end: format(e, "yyyy-MM-dd"),
      periodLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
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
  const [activeSubTab, setActiveSubTab] = useState<
    "lancamentos" | "previstos" | "excluidos" | "contas"
  >(
    "lancamentos",
  );

  // Barra de Filtros
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"todos" | "receitas" | "despesas">("todos");
  const [formaFilter, setFormaFilter] = useState<string>("todas");
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

  // Paginação da lista
  const [page, setPage] = useState(0);

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
    enabled: !!selectedScope || (scope === "all" && finance.scopes.length > 0),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const fetchScope = async (id: string | null) => {
        const { data, error } = await supabase.rpc("get_cash_flow_snapshot", { p_company_id: id });
        if (error) throw error;
        if (!data) throw new Error("Fluxo de caixa indisponível. Verifique a migração financeira.");
        return data as CashFlowSnapshot;
      };
      if (scope !== "all") return fetchScope(scope === "legacy" ? null : scope);
      // "Todas as clínicas": junta o caixa de cada clínica (sem repetir contas/baixas compartilhadas)
      const parts = await Promise.all(finance.scopes.map((s) => fetchScope(s.id)));
      const uniq = <T extends { id: string }>(items: T[]) => [
        ...new Map(items.map((i) => [i.id, i])).values(),
      ];
      return {
        accounts: uniq(parts.flatMap((p) => p.accounts)),
        payments: uniq(parts.flatMap((p) => p.payments)),
        transfers: uniq(parts.flatMap((p) => p.transfers)),
      } satisfies CashFlowSnapshot;
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

  // 2b. Previstos: saldo que falta de cada título em aberto (a receber / a pagar), no vencimento
  const forecastEntries = useMemo(() => {
    const today = todayIso();
    return (finance.titles || [])
      .filter((t) => t && t.status !== "cancelado" && remaining(t) > 0)
      .map((t): CashEntry => {
        const due = String(t.due_date || t.date || "").slice(0, 10);
        return {
          id: `prev:${t.id}`,
          transaction_id: t.id,
          date: due,
          effectiveDate: due && due < today ? today : due,
          description: t.description || (t.type === "despesa" ? "Conta a pagar" : "Conta a receber"),
          category: t.category || (t.type === "despesa" ? "Despesas Gerais" : "Receitas"),
          client_name: t.patient_name || t.payer_name || "Avulso",
          payment_method: "—",
          payment_account: "—",
          company_id: t.company_id || null,
          type: t.type,
          is_expense: t.type === "despesa",
          amount: remaining(t),
          paid_amount: Number(t.paid_amount || 0),
          status: "pendente",
          badgeLabel: getTitleEventKey(t) ? "AGENDAMENTO" : t.treatment_id ? "PLANO" : "MANUAL",
          title: t,
        };
      });
  }, [finance.titles]);

  // Categorias reais presentes nos lançamentos (alimenta o filtro de categoria)
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    [...allRealizedEntries, ...forecastEntries].forEach((e) => {
      if (e.category) set.add(e.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [allRealizedEntries, forecastEntries]);

  // Previstos no escopo e período (contador da sub-aba)
  const forecastInPeriodCount = useMemo(
    () =>
      forecastEntries.filter((e) => {
        if (scope !== "all" && e.company_id && e.company_id !== scope) return false;
        const d = e.effectiveDate || e.date;
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      }).length,
    [forecastEntries, scope, start, end],
  );

  // 3. Filtragem dos Lançamentos para exibição na tabela
  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source =
      activeSubTab === "excluidos"
        ? excludedEntries
        : activeSubTab === "previstos"
          ? forecastEntries
          : allRealizedEntries;

    const isForecast = activeSubTab === "previstos";

    const rows = source.filter((e) => {
      // Clínica / Scope
      if (scope !== "all" && e.company_id && e.company_id !== scope) return false;

      // Conta Bancária (previstos ainda não têm conta; seguem a mesma regra dos cards)
      if (!isForecast && selectedAccount !== "todas") {
        if (e.account_id !== selectedAccount && e.payment_account !== selectedAccount) {
          return false;
        }
      }

      // Período (previsto vencido conta como hoje, igual aos cards)
      const d = isForecast ? e.effectiveDate || e.date : e.date;
      if (start && (!d || d < start)) return false;
      if (end && (!d || d > end)) return false;

      // Sub-aba: Lançamentos (exclui cancelados) vs Excluídos (somente cancelados)
      if (activeSubTab === "lancamentos" && (e.status === "cancelado" || e.reversed_at))
        return false;

      // Filtro por tipo (Segmented: Todos / Receitas / Despesas)
      if (typeFilter === "receitas" && e.is_expense) return false;
      if (typeFilter === "despesas" && !e.is_expense) return false;

      // Filtro por forma de pagamento (sem acento: "Débito" casa com "debito")
      if (formaFilter !== "todas") {
        if (!normalize(e.payment_method).includes(formaFilter)) return false;
      }

      // Filtro por categoria (valor exato vindo dos próprios lançamentos)
      if (areaFilter !== "todas" && e.category !== areaFilter) return false;

      // Busca textual
      if (q) {
        const text =
          `${e.description} ${e.category} ${e.client_name} ${e.payment_method} ${e.payment_account} ${dateSearchText(e.date, e.title?.due_date)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });

    // Realizados/excluídos: mais recentes primeiro. Previstos: próximos vencimentos primeiro.
    return rows.sort((a, b) => {
      const da = (isForecast ? a.effectiveDate || a.date : a.date) || "";
      const db = (isForecast ? b.effectiveDate || b.date : b.date) || "";
      if (da !== db) return isForecast ? da.localeCompare(db) : db.localeCompare(da);
      return isForecast ? a.date.localeCompare(b.date) : (b.created_at || "").localeCompare(a.created_at || "");
    });
  }, [
    allRealizedEntries,
    excludedEntries,
    forecastEntries,
    activeSubTab,
    scope,
    selectedAccount,
    start,
    end,
    typeFilter,
    formaFilter,
    areaFilter,
    search,
  ]);

  // 4. Cálculos dos 3 Cards de Métricas e dados do Gráfico
  const { totalEntradas, totalDespesas, saldoFinal, totalEntradasPrev, totalSaidasPrev } = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let entradasPrev = 0;
    let saidasPrev = 0;

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

    base.forEach((e) => {
      const amt = Number(e.paid_amount || 0);
      if (!e.is_expense) {
        entradas += amt;
      } else {
        saidas += amt;
      }
    });

    // Previstos: mesma fonte e mesma regra de data da sub-aba Previstos (vencido em aberto = hoje)
    forecastEntries.forEach((e) => {
      if (scope !== "all" && e.company_id && e.company_id !== scope) return;
      const d = e.effectiveDate || e.date;
      if (!d) return;
      if (start && d < start) return;
      if (end && d > end) return;
      if (e.is_expense) saidasPrev += e.amount;
      else entradasPrev += e.amount;
    });

    return {
      totalEntradas: entradas,
      totalDespesas: saidas,
      saldoFinal: entradas - saidas,
      totalEntradasPrev: entradasPrev,
      totalSaidasPrev: saidasPrev,
    };
  }, [allRealizedEntries, forecastEntries, scope, selectedAccount, start, end]);

  // Dados do gráfico compartilhado: pagamentos (realizado) + saldo em aberto (previsto), por clínica
  // Agrupamento do gráfico: segue o período do topo até o usuário escolher Diária/Semanal/Mensal/Anual
  const [chartPeriodChoice, setChartPeriodChoice] = useState<CashFlowPeriod | null>(null);
  useEffect(() => setChartPeriodChoice(null), [periodMode]);
  const autoChartPeriod = useMemo<CashFlowPeriod>(() => {
    if (periodMode === "dia" || periodMode === "semana") return "day";
    if (periodMode === "mes") return "week";
    if (periodMode === "ano") return "month";
    const days =
      start && end ? (parseISO(end).getTime() - parseISO(start).getTime()) / 86_400_000 : 31;
    return days <= 31 ? "day" : days <= 120 ? "week" : "month";
  }, [periodMode, start, end]);
  const flowChartRows = useMemo(() => {
    const inScope = (companyId: string | null | undefined) =>
      scope === "all" || !companyId || companyId === scope;
    const titles = (finance.titles || []).filter((t) => inScope(t.company_id));
    const ids = new Set(titles.map((t) => t.id));
    try {
      return reportingRows({
        ...finance,
        titles,
        payments: (finance.payments || []).filter((p) => ids.has(p.transaction_id)),
      } as FinanceSnapshot);
    } catch {
      return [];
    }
  }, [finance, scope]);
  const flowChartPeriod = chartPeriodChoice ?? autoChartPeriod;
  const flowChartRange = useMemo<[Date, Date]>(() => {
    let s = start ? parseISO(start) : startOfMonth(new Date());
    let e = end ? parseISO(end) : endOfMonth(new Date());
    // Agrupamento maior que o período (ex.: Mensal vendo um mês) daria uma barra só:
    // amplia a janela do gráfico para o ano (Mensal) ou os últimos 5 anos (Anual).
    if (flowChartPeriod === "month" && differenceInCalendarDays(e, s) < 62) {
      s = startOfYear(e);
      e = endOfYear(e);
    } else if (flowChartPeriod === "year") {
      s = startOfYear(new Date(e.getFullYear() - 4, 0, 1));
      e = endOfYear(e);
    } else if (flowChartPeriod === "day" && differenceInCalendarDays(e, s) > 62) {
      // Diária num ano inteiro seriam 365 barras: mostra o último mês do período
      s = startOfMonth(e);
    } else if (flowChartPeriod === "week" && differenceInCalendarDays(e, s) < 14) {
      s = startOfMonth(e);
      e = endOfMonth(e);
    }
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return [s, e];
  }, [start, end, flowChartPeriod]);

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
      e.status === "cancelado"
        ? "Cancelado"
        : e.status === "pendente"
          ? e.is_expense
            ? "A pagar"
            : "A receber"
          : e.is_expense
            ? "Pago"
            : "Recebido",
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

  // Saldos (caixa e bancos). Conta sem saldo de abertura conferido entra com abertura R$ 0 desde o
  // primeiro movimento: o card mostra o saldo das movimentações e avisa que falta conferir a abertura.
  let estimated = false;
  if (query.data && result && result.available === null && !calculationError) {
    try {
      const pending = query.data.accounts.filter(
        (a) => a.opening_amount === null || a.opening_date === null || a.kind === null,
      );
      estimated = pending.length > 0;
      result = cashFlow(
        {
          ...query.data,
          accounts: query.data.accounts.map((a) =>
            pending.includes(a)
              ? {
                  ...a,
                  kind: a.kind ?? "available",
                  opening_amount: a.opening_amount ?? 0,
                  opening_date: a.opening_date ?? "0000-01-01",
                }
              : a,
          ),
        },
        start || `${localDate().slice(0, 7)}-01`,
        end || localDate(),
        selectedAccount === "todas" ? "" : selectedAccount,
      );
    } catch (error) {
      calculationError = errorMessage(error);
    }
  }
  const availableRows = result?.rows.filter((r) => r.account.kind === "available") ?? [];
  const saldoInicial =
    result && result.available !== null && availableRows.every((r) => r.opening !== null)
      ? availableRows.reduce((sum, r) => sum + (r.opening ?? 0), 0)
      : null;
  const saldoAtual = result?.available ?? null;
  const saldoProjetado =
    saldoAtual === null ? null : saldoAtual + totalEntradasPrev - totalSaidasPrev;
  const saldoHint = query.isLoading
    ? "Carregando saldos..."
    : calculationError || "Confirme o saldo de abertura na aba Contas";
  const estimatedNote = "Só movimentações · confirme a abertura em Contas";

  // Paginação
  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => {
    setPage(0);
  }, [activeSubTab, scope, selectedAccount, start, end, typeFilter, formaFilter, areaFilter, search]);

  const isForecastTab = activeSubTab === "previstos";
  const tableColSpan = isForecastTab ? 7 : 6;
  const today = todayIso();

  const periodOptions: [typeof periodMode, string][] = [
    ["dia", "Dia"],
    ["semana", "Semana"],
    ["mes", "Mês"],
    ["ano", "Ano"],
  ];

  const subTabs: { key: typeof activeSubTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "lancamentos", label: "Realizados", icon: <Tag className="h-3.5 w-3.5" /> },
    {
      key: "previstos",
      label: "Previstos",
      icon: <CalendarIcon className="h-3.5 w-3.5" />,
      count: forecastInPeriodCount,
    },
    { key: "excluidos", label: "Excluídos", icon: <Trash2 className="h-3.5 w-3.5" /> },
    { key: "contas", label: "Contas", icon: <Landmark className="h-3.5 w-3.5" /> },
  ];

  const tabHelp =
    activeSubTab === "previstos"
      ? "Saldo que falta receber ou pagar de cada título em aberto. Use Receber / Pagar para registrar a baixa."
      : activeSubTab === "excluidos"
        ? "Pagamentos estornados e títulos cancelados. Ficam só para histórico e não entram nos totais."
        : activeSubTab === "contas"
          ? "Saldo de abertura, movimentos e saldo final de cada conta no período, para conferir com o extrato."
          : "Entradas e saídas que efetivamente aconteceram no caixa e nas contas da clínica.";

  // Situação exibida abaixo da data
  const dateNote = (e: CashEntry) => {
    if (e.status === "pendente") {
      if (e.date && e.date < today) return { text: "Vencido", cls: "text-destructive" };
      if (e.date === today) return { text: "Vence hoje", cls: "text-warning" };
      return { text: "Previsto", cls: "text-info" };
    }
    if (e.status === "cancelado")
      return {
        text: e.badgeLabel === "CANCELADO" ? "Cancelado" : "Estornado",
        cls: "text-muted-foreground",
      };
    if (e.date === today) return { text: "Hoje", cls: "text-success" };
    return null;
  };

  const shortDate = (d: string) => {
    if (!d) return "—";
    const parsed = parseISO(d);
    return isNaN(parsed.getTime()) ? d : format(parsed, "dd/MM/yy");
  };

  const rowActions = (e: CashEntry) =>
    activeSubTab === "previstos" ? (
      <Button
        size="sm"
        className={cn(
          "h-7 cursor-pointer rounded-md px-2.5 text-xs font-semibold text-white",
          e.is_expense ? "bg-destructive hover:bg-destructive/90" : "bg-success hover:bg-success/90",
        )}
        title={e.is_expense ? "Registrar o pagamento" : "Registrar o recebimento"}
        onClick={() => handleOpenEditOrHistory(e)}
      >
        {e.is_expense ? "Pagar" : "Receber"}
      </Button>
    ) : activeSubTab === "lancamentos" ? (
      <>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground/80 hover:bg-muted cursor-pointer"
          title="Ver histórico / recibo"
          onClick={() => handleOpenEditOrHistory(e)}
          aria-label="Ver histórico"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
          title="Estornar movimentação"
          onClick={() => handleOpenDelete(e)}
          aria-label="Estornar movimentação"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </>
    ) : null;

  const listTotals = filteredEntries.reduce(
    (acc, entry) => {
      if (entry.status === "cancelado") return acc;
      const amount = Number(entry.amount) || 0;
      if (entry.is_expense) acc.saidas += amount;
      else acc.entradas += amount;
      return acc;
    },
    { entradas: 0, saidas: 0 },
  );
  const listNet = listTotals.entradas - listTotals.saidas;

  // Select discreto (sem borda) para clínica e conta
  const ghostSelect =
    "h-9 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm font-medium text-foreground/80 shadow-none hover:bg-muted/60 hover:text-foreground focus:ring-0 rounded-lg";

  return (
    <div className="space-y-5 pb-12">
      {/* ========================================================================= */}
      {/* BARRA SUPERIOR: CLÍNICA, CONTA, PERÍODO E AÇÕES                           */}
      {/* ========================================================================= */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Período: um controle só (navegação + agrupamento) */}
          <div className="flex h-9 items-center rounded-lg border border-border bg-card shadow-2xs">
            {periodMode !== "custom" ? (
              <>
                <button
                  type="button"
                  onClick={handlePrevPeriod}
                  className="inline-flex h-9 w-8 cursor-pointer items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Período anterior"
                  aria-label="Período anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[120px] select-none px-1 text-center text-sm font-semibold text-foreground">
                  {periodLabel}
                </span>
                <button
                  type="button"
                  onClick={handleNextPeriod}
                  className="inline-flex h-9 w-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Próximo período"
                  aria-label="Próximo período"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 px-3 text-xs">
                <input
                  type="date"
                  aria-label="Data inicial"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-transparent text-xs font-medium text-foreground outline-hidden cursor-pointer"
                />
                <span className="text-muted-foreground">até</span>
                <input
                  type="date"
                  aria-label="Data final"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-transparent text-xs font-medium text-foreground outline-hidden cursor-pointer"
                />
              </div>
            )}
            <div className="h-5 w-px bg-border" aria-hidden="true" />
            <Select value={periodMode} onValueChange={(v) => setPeriodMode(v as typeof periodMode)}>
              <SelectTrigger
                aria-label="Tipo de período"
                className="h-9 w-auto gap-1 rounded-l-none rounded-r-lg border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-none hover:text-foreground focus:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {periodOptions.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Datas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {customRangeInvalid && (
            <span className="text-[11px] font-medium text-warning" role="status">
              Datas invertidas, aplicadas na ordem certa
            </span>
          )}

          {finance.scopes.length > 1 && (
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v);
                setSelectedAccount("todas");
              }}
            >
              <SelectTrigger aria-label="Clínica" className={ghostSelect}>
                <SelectValue placeholder="Clínica" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as clínicas</SelectItem>
                {finance.scopes.map((s) => (
                  <SelectItem key={s.id || "legacy"} value={s.id || "legacy"}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger aria-label="Conta bancária do fluxo de caixa" className={ghostSelect}>
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
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-card border-border text-foreground/80 text-xs font-medium gap-1.5 shadow-2xs hover:bg-muted/60 cursor-pointer"
            onClick={handleExportCsv}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
            Planilha
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-card border-border text-foreground/80 text-xs font-medium gap-1.5 shadow-2xs hover:bg-muted/60 cursor-pointer"
            onClick={() => setTransferOpen(true)}
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-info" />
            Transferência
          </Button>
          <Button
            size="sm"
            className="h-9 px-4 bg-primary hover:bg-primary-hover text-white font-semibold text-xs shadow-xs cursor-pointer"
            onClick={() =>
              onOpenNew ? onOpenNew("receita") : (window.location.href = "/financeiro?novo=1")
            }
          >
            Novo lançamento
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CARDS: REALIZADO (SALDO INICIAL → ENTRADAS → SAÍDAS → SALDO ATUAL)        */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-2xs space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Saldo inicial</span>
            <p className="text-xl font-semibold tracking-tight text-foreground tabular-nums">
              {saldoInicial === null ? "—" : <CountUp value={saldoInicial} format={(v) => currency(v)} />}
            </p>
            <p className="text-xs text-muted-foreground">
              {saldoInicial === null
                ? saldoHint
                : estimated
                  ? estimatedNote
                  : "Caixa e bancos no início do período"}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-2xs space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowUpRight className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />
              Entradas
            </span>
            <p className="text-xl font-semibold tracking-tight text-success tabular-nums">
              <CountUp value={totalEntradas} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">Recebido no período</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-2xs space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowDownLeft className="h-3.5 w-3.5 text-destructive" strokeWidth={2.5} />
              Saídas
            </span>
            <p className="text-xl font-semibold tracking-tight text-destructive tabular-nums">
              <CountUp value={totalDespesas} format={(v) => currency(v)} />
            </p>
            <p className="text-xs text-muted-foreground">
              Pago no período · resultado{" "}
              <span className={cn("font-medium", saldoFinal < 0 ? "text-destructive" : "text-foreground")}>
                {currency(saldoFinal)}
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-2xs space-y-1">
            <span className="text-xs font-semibold text-primary">Saldo atual</span>
            <p
              className={cn(
                "text-xl font-semibold tracking-tight tabular-nums",
                saldoAtual !== null && saldoAtual < 0 ? "text-destructive" : "text-foreground",
              )}
            >
              {saldoAtual === null ? "—" : <CountUp value={saldoAtual} format={(v) => currency(v)} />}
            </p>
            <p className="text-xs text-muted-foreground">
              {saldoAtual === null
                ? saldoHint
                : estimated
                  ? estimatedNote
                  : "Caixa e bancos no fim do período"}
            </p>
          </div>
        </div>

        {/* Linha de previstos (menor) */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-2.5 text-xs">
          <span className="font-semibold text-muted-foreground">Previsto no período</span>
          <button
            type="button"
            onClick={() => {
              setActiveSubTab("previstos");
              setTypeFilter("receitas");
            }}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
          >
            A receber{" "}
            <strong className="font-semibold text-success tabular-nums">
              {currency(totalEntradasPrev)}
            </strong>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveSubTab("previstos");
              setTypeFilter("despesas");
            }}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
          >
            A pagar{" "}
            <strong className="font-semibold text-destructive tabular-nums">
              {currency(totalSaidasPrev)}
            </strong>
          </button>
          <span className="text-muted-foreground">
            Saldo projetado{" "}
            <strong
              className={cn(
                "font-semibold tabular-nums",
                saldoProjetado !== null && saldoProjetado < 0 ? "text-destructive" : "text-foreground",
              )}
              title="Saldo atual + a receber − a pagar"
            >
              {saldoProjetado === null ? "—" : currency(saldoProjetado)}
            </strong>
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* GRÁFICO COMPACTO E RECOLHÍVEL (SEGUE O PERÍODO DO TOPO)                   */}
      {/* ========================================================================= */}
      {showChart ? (
        <CashFlowChartCard
          rows={flowChartRows}
          range={flowChartRange}
          period={flowChartPeriod}
          onPeriodChange={setChartPeriodChoice}
          useRange
          height={220}
          className="border border-border"
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground cursor-pointer"
              onClick={() => setShowChart(false)}
            >
              <EyeOff className="h-3.5 w-3.5" />
              Ocultar
            </Button>
          }
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowChart(true)}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" />
          Exibir gráfico do período
        </button>
      )}

      {/* ========================================================================= */}
      {/* SUB-ABAS, FILTROS E LISTA                                                 */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-4 overflow-x-auto border-b border-border text-xs font-semibold">
            {subTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={cn(
                  "pb-2.5 pt-1 border-b-2 flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap",
                  activeSubTab === t.key
                    ? "border-info text-info"
                    : "border-transparent text-muted-foreground hover:text-foreground/80",
                )}
                onClick={() => setActiveSubTab(t.key)}
              >
                {t.icon} {t.label}
                {!!t.count && (
                  <span className="rounded bg-info/12 px-1.5 text-[11px] text-info">{t.count}</span>
                )}
              </button>
            ))}
          </div>
          <p className="pt-2 text-xs text-muted-foreground">{tabHelp}</p>
        </div>

        {activeSubTab === "contas" ? (
          <div className="space-y-4">
            {!result ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                {saldoHint}
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border bg-card p-4">
                    <span className="text-xs text-muted-foreground block">
                      Saldo disponível em caixa/bancos
                    </span>
                    <strong className="text-lg font-semibold text-foreground">
                      {balance(result.available)}
                    </strong>
                  </div>
                  <div className="rounded-xl border bg-card p-4">
                    <span className="text-xs text-muted-foreground block">
                      Recebíveis futuros de cartão (a liquidar)
                    </span>
                    <strong className="text-lg font-semibold text-foreground">
                      {balance(result.receivable)}
                    </strong>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border bg-card">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
                      <tr>
                        {[
                          "Conta",
                          "Saldo anterior",
                          "Recebimentos",
                          "Pagamentos",
                          "Resultado",
                          "Transferências",
                          "Saldo final",
                        ].map((h) => (
                          <th key={h} className="p-3 whitespace-nowrap">
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
                              {r.account.kind === "available" ? "Caixa / Banco" : "Recebíveis de cartão"}
                            </span>
                          </td>
                          {[r.opening, r.income, r.expense, r.result, r.transfers, r.closing].map(
                            (v, i) => (
                              <td key={i} className="p-3 tabular-nums font-medium whitespace-nowrap">
                                {balance(v)}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedScope?.can_accounts && <OpeningForm accounts={query.data?.accounts || []} />}
          </div>
        ) : (
          <>
            {/* Filtros da lista */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro direto por dia, mês ou ano: usa o mesmo período do topo (cards e lista batem) */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 shadow-2xs">
                <select
                  aria-label="Filtrar lançamentos por"
                  value={periodMode === "dia" || periodMode === "ano" ? periodMode : "mes"}
                  onChange={(e) => setPeriodMode(e.target.value as "dia" | "mes" | "ano")}
                  className="h-8 rounded-md bg-transparent px-1.5 text-xs font-medium text-foreground outline-none cursor-pointer"
                >
                  <option value="dia">Dia</option>
                  <option value="mes">Mês</option>
                  <option value="ano">Ano</option>
                </select>
                {periodMode === "dia" ? (
                  <input
                    type="date"
                    aria-label="Dia"
                    value={format(currentPeriodDate, "yyyy-MM-dd")}
                    onChange={(e) => e.target.value && setCurrentPeriodDate(parseISO(e.target.value))}
                    className="h-8 rounded-md bg-muted/60 px-2 text-xs text-foreground outline-none"
                  />
                ) : periodMode === "ano" ? (
                  <select
                    aria-label="Ano"
                    value={currentPeriodDate.getFullYear()}
                    onChange={(e) => setCurrentPeriodDate(new Date(Number(e.target.value), 0, 1))}
                    className="h-8 rounded-md bg-muted/60 px-2 text-xs text-foreground outline-none cursor-pointer"
                  >
                    {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="month"
                    aria-label="Mês"
                    value={format(currentPeriodDate, "yyyy-MM")}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setPeriodMode("mes"); // vindo de Semana/Personalizado, passa a filtrar o mês
                      setCurrentPeriodDate(parseISO(`${e.target.value}-01`));
                    }}
                    className="h-8 rounded-md bg-muted/60 px-2 text-xs text-foreground outline-none"
                  />
                )}
              </div>
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar descrição, paciente, data..."
                  className="pl-8 h-8 text-xs bg-card border-border rounded-lg placeholder:text-muted-foreground"
                />
              </div>

              <div className="inline-flex items-center bg-muted p-0.5 rounded-lg border border-border/50">
                {(
                  [
                    ["todos", "Todos"],
                    ["receitas", "Receitas"],
                    ["despesas", "Despesas"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                      typeFilter === key
                        ? "bg-info text-white shadow-2xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setTypeFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

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

              <Select value={areaFilter} onValueChange={setAreaFilter}>
                <SelectTrigger
                  aria-label="Categoria"
                  className="h-8 w-auto min-w-[140px] text-xs bg-card border-border rounded-lg text-foreground/80"
                >
                  <SelectValue placeholder="Todas as categorias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as categorias</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedAccount !== "todas" && isForecastTab && (
                <span className="text-xs text-muted-foreground">
                  Previstos ainda não têm conta; o filtro de conta não se aplica a eles.
                </span>
              )}
            </div>

            {/* Lista: tabela no desktop, cartões no celular */}
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-2xs">
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-card hover:bg-card border-b border-border text-xs font-medium text-muted-foreground">
                      <TableHead className="w-[90px] text-muted-foreground">Data</TableHead>
                      <TableHead className="text-muted-foreground">Descrição</TableHead>
                      <TableHead className="w-[110px] text-muted-foreground">Forma</TableHead>
                      <TableHead className="w-[150px] text-muted-foreground">Conta</TableHead>
                      {isForecastTab && (
                        <TableHead className="w-[100px] text-center text-muted-foreground">
                          Situação
                        </TableHead>
                      )}
                      <TableHead className="w-[130px] text-right text-muted-foreground">Valor</TableHead>
                      <TableHead className="w-[90px] text-right text-muted-foreground">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedEntries.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={tableColSpan}
                          className="text-center py-12 text-sm text-muted-foreground"
                        >
                          Nenhuma movimentação encontrada para os filtros selecionados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedEntries.map((e) => {
                        const note = dateNote(e);
                        const showClient = e.client_name && e.client_name !== "Avulso";
                        return (
                          <TableRow key={e.id} className="hover:bg-muted/42 border-b border-border-soft text-xs">
                            <TableCell className="align-middle py-2.5">
                              <span className="font-medium text-foreground block">{shortDate(e.date)}</span>
                              {note && <span className={cn("block text-[11px] font-medium", note.cls)}>{note.text}</span>}
                            </TableCell>
                            <TableCell className="align-middle py-2.5">
                              <div className="flex items-start gap-2 min-w-0">
                                <div
                                  className={cn(
                                    "h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                                    e.is_expense ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
                                  )}
                                  aria-label={e.is_expense ? "Despesa" : "Receita"}
                                >
                                  {e.is_expense ? (
                                    <ArrowDownLeft className="h-3 w-3" strokeWidth={2.5} />
                                  ) : (
                                    <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <span className="font-medium text-foreground block truncate">
                                    {showClient ? e.client_name : entryDescription(e.description)}
                                  </span>
                                  <span className="text-muted-foreground block truncate">
                                    {showClient ? `${entryDescription(e.description)} · ` : ""}
                                    {e.category}
                                    {e.status === "cancelado" && e.reversal_reason ? ` · ${e.reversal_reason}` : ""}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="align-middle py-2.5 text-muted-foreground">{paymentMethodLabel(e.payment_method) || "—"}</TableCell>
                            <TableCell className="align-middle py-2.5 text-foreground/80">{e.payment_account || "—"}</TableCell>
                            {isForecastTab && (
                              <TableCell className="align-middle py-2.5 text-center">
                                <span
                                  className={cn(
                                    "inline-block px-2 py-0.5 rounded-md text-[11px] font-medium",
                                    e.is_expense ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
                                  )}
                                >
                                  {e.is_expense ? "A pagar" : "A receber"}
                                </span>
                              </TableCell>
                            )}
                            <TableCell
                              className={cn(
                                "align-middle py-2.5 text-right font-semibold tabular-nums",
                                e.status === "cancelado"
                                  ? "text-muted-foreground line-through"
                                  : e.is_expense
                                    ? "text-destructive"
                                    : "text-success",
                              )}
                            >
                              {e.is_expense ? "- " : "+ "}
                              {currency(e.amount)}
                            </TableCell>
                            <TableCell className="align-middle py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">{rowActions(e)}</div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Celular */}
              <div className="md:hidden divide-y divide-border">
                {pagedEntries.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma movimentação encontrada para os filtros selecionados.
                  </p>
                ) : (
                  pagedEntries.map((e) => {
                    const note = dateNote(e);
                    const showClient = e.client_name && e.client_name !== "Avulso";
                    return (
                      <div key={e.id} className="flex items-start justify-between gap-3 p-3 text-xs">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium text-foreground truncate">
                            {showClient ? e.client_name : entryDescription(e.description)}
                          </p>
                          <p className="text-muted-foreground truncate">
                            {shortDate(e.date)}
                            {note ? ` · ${note.text}` : ""}
                            {showClient ? ` · ${entryDescription(e.description)}` : ""}
                          </p>
                          <p className="text-muted-foreground truncate">
                            {paymentMethodLabel(e.payment_method) ? `${paymentMethodLabel(e.payment_method)} · ` : ""}
                            {e.payment_account && e.payment_account !== "—" ? e.payment_account : e.category}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              e.status === "cancelado"
                                ? "text-muted-foreground line-through"
                                : e.is_expense
                                  ? "text-destructive"
                                  : "text-success",
                            )}
                          >
                            {e.is_expense ? "- " : "+ "}
                            {currency(e.amount)}
                          </span>
                          <div className="flex items-center gap-1">{rowActions(e)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totais e paginação */}
              {filteredEntries.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border bg-muted/30 px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">
                    {filteredEntries.length} {filteredEntries.length === 1 ? "item" : "itens"}
                    {activeSubTab !== "excluidos" && (
                      <>
                        {" "}· entradas <span className="tabular-nums text-success">{currency(listTotals.entradas)}</span>
                        {" "}· saídas <span className="tabular-nums text-destructive">{currency(listTotals.saidas)}</span>
                        {" "}· líquido{" "}
                        <span className={cn("font-semibold tabular-nums", listNet < 0 ? "text-destructive" : "text-success")}>
                          {listNet < 0 ? "- " : "+ "}
                          {currency(Math.abs(listNet))}
                        </span>
                      </>
                    )}
                  </span>
                  {pageCount > 1 && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 cursor-pointer"
                        disabled={page === 0}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        aria-label="Página anterior"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="tabular-nums text-muted-foreground">
                        {page + 1} / {pageCount}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 cursor-pointer"
                        disabled={page >= pageCount - 1}
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                        aria-label="Próxima página"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
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
                step="0.01"
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
                  Estornar movimentação
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  O pagamento sai dos totais do caixa e vai para a sub-aba Excluídos. O título volta
                  a ficar em aberto.
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
                <>Estornando...</>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Estornar movimentação
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
