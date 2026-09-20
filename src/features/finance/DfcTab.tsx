import React, { useState, useMemo } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Download,
  Eye,
  TrendingUp,
  TrendingDown,
  Wallet,
  Building2,
  Database,
  Sparkles,
  Percent,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FinanceSnapshot, FinancialTitle, FinancialPayment } from "./finance-schema";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { exportFinanceCsv } from "./export-csv";

interface DfcTabProps {
  finance: FinanceSnapshot;
  onRefresh?: () => void;
  refreshing?: boolean;
  onSelectTitle?: (id: string) => void;
}

interface DfcRowItem {
  id: string;
  label: string;
  amount: number;
  avPercentage: number;
  payments: {
    id: string;
    titleId: string;
    description: string;
    payerOrPatient: string;
    date: string;
    amount: number;
    category: string;
  }[];
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function DfcTab({ finance, onRefresh, refreshing, onSelectTitle }: DfcTabProps) {
  // Navigation & filter state
  const today = new Date();
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const hasCurrentMonth = (finance.payments || []).some((p) =>
      (p.paid_on || "").startsWith(currentYM),
    );
    if (hasCurrentMonth) return today.getFullYear();
    return 2026;
  });
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(() => {
    const hasCurrentMonth = (finance.payments || []).some((p) =>
      (p.paid_on || "").startsWith(currentYM),
    );
    if (hasCurrentMonth) return today.getMonth();
    return 8; // Setembro (0-indexed)
  });
  const [dataSource, setDataSource] = useState<"sistema" | "simulacao">("sistema");
  const [activeSubTab, setActiveSubTab] = useState<"mes" | "12m" | "liquidez" | "simulacao">("mes");
  const [showAv, setShowAv] = useState(true);

  // Collapsible sections
  const [openSection1, setOpenSection1] = useState(true);
  const [openSection2, setOpenSection2] = useState(true);
  const [openSection3, setOpenSection3] = useState(true);

  // Inspection dialog for a row
  const [inspectedRow, setInspectedRow] = useState<DfcRowItem | null>(null);

  // Month navigation helpers
  const handlePrevMonth = () => {
    if (selectedMonthIndex === 0) {
      setSelectedMonthIndex(11);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonthIndex((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonthIndex === 11) {
      setSelectedMonthIndex(0);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonthIndex((m) => m + 1);
    }
  };

  const currentMonthStr = `${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, "0")}`;
  const monthName = MONTH_NAMES[selectedMonthIndex];

  // Cash flow calculation (Regime de Caixa)
  const dfcData = useMemo(() => {
    const titlesMap = new Map<string, FinancialTitle>();
    finance.titles.forEach((t) => titlesMap.set(t.id, t));

    // Get all valid payments
    const validPayments: {
      id: string;
      titleId: string;
      type: "receita" | "despesa";
      amount: number;
      date: string;
      description: string;
      payerOrPatient: string;
      category: string;
    }[] = [];

    // Track payment IDs already processed
    const processedTitleIds = new Set<string>();

    // 1. From finance.payments
    finance.payments
      .filter((p) => !p.reversed_at)
      .forEach((p) => {
        const title = titlesMap.get(p.transaction_id);
        if (title) {
          processedTitleIds.add(title.id);
          validPayments.push({
            id: p.id,
            titleId: title.id,
            type: title.type,
            amount: p.amount,
            date: p.paid_on || title.due_date || title.date,
            description: title.description || "Lançamento",
            payerOrPatient: title.patient_name || title.payer_name || "Não informado",
            category: title.category || "Outros",
          });
        }
      });

    // 2. Add titles that are marked 'pago' but have no payment record
    finance.titles
      .filter((t) => t.status === "pago" && !processedTitleIds.has(t.id))
      .forEach((t) => {
        validPayments.push({
          id: `title-${t.id}`,
          titleId: t.id,
          type: t.type,
          amount: t.paid_amount > 0 ? t.paid_amount : t.amount,
          date: t.date || t.due_date,
          description: t.description || "Lançamento",
          payerOrPatient: t.patient_name || t.payer_name || "Não informado",
          category: t.category || "Outros",
        });
      });

    // Calculate Initial Balance (sum of cash flow before this month)
    const priorPayments = validPayments.filter((p) => p.date < `${currentMonthStr}-01`);
    const initialBalance = priorPayments.reduce((acc, p) => {
      return p.type === "receita" ? acc + p.amount : acc - p.amount;
    }, 0);

    // Payments in current month
    const currentMonthPayments = validPayments.filter(
      (p) => p.date >= `${currentMonthStr}-01` && p.date <= `${currentMonthStr}-31`
    );

    const incomePayments = currentMonthPayments.filter((p) => p.type === "receita");
    const expensePayments = currentMonthPayments.filter((p) => p.type === "despesa");

    const totalIncomes = incomePayments.reduce((acc, p) => acc + p.amount, 0);
    const totalExpenses = expensePayments.reduce((acc, p) => acc + p.amount, 0);

    // Categories definition for Incomes matching media_1789940253416.png
    const incomeCategories = [
      {
        id: "honorarios_iniciais",
        label: "(+) Honorários iniciais / sinal",
        matcher: (cat: string, desc: string) =>
          cat.includes("inicial") ||
          cat.includes("sinal") ||
          desc.includes("sinal") ||
          desc.includes("honor") ||
          cat.includes("consulta") ||
          cat.includes("procedimento") ||
          cat === "Outros" ||
          cat === "",
      },
      {
        id: "honorarios_parcelados",
        label: "(+) Honorários contratuais parcelados/recorrentes",
        matcher: (cat: string, desc: string) =>
          cat.includes("parcelad") ||
          cat.includes("recorren") ||
          cat.includes("mensal") ||
          desc.includes("parcela"),
      },
      {
        id: "honorarios_avulsos",
        label: "(+) Honorários contratuais avulsos",
        matcher: (cat: string, desc: string) => cat.includes("avulso") || desc.includes("avulso"),
      },
      {
        id: "honorarios_exito",
        label: "(+) Honorários de êxito",
        matcher: (cat: string, desc: string) => cat.includes("exito") || cat.includes("êxito"),
      },
      {
        id: "honorarios_sucumbenciais",
        label: "(+) Honorários sucumbenciais",
        matcher: (cat: string, desc: string) => cat.includes("sucumb"),
      },
      {
        id: "consultorias",
        label: "(+) Consultorias e pareceres",
        matcher: (cat: string, desc: string) => cat.includes("consultoria") || cat.includes("parecer"),
      },
      {
        id: "audiencias",
        label: "(+) Audiências e diligências",
        matcher: (cat: string, desc: string) => cat.includes("audiencia") || cat.includes("audiência") || cat.includes("dilig"),
      },
      {
        id: "outras_receitas",
        label: "(+) Outras receitas jurídicas",
        matcher: () => false, // fallback
      },
    ];

    // Distribute income payments
    const incomeRows: DfcRowItem[] = incomeCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      payments: [],
    }));

    incomePayments.forEach((p) => {
      const lowerCat = p.category.toLowerCase();
      const lowerDesc = p.description.toLowerCase();
      let matched = false;

      for (let i = 0; i < incomeCategories.length - 1; i++) {
        if (incomeCategories[i].matcher(lowerCat, lowerDesc)) {
          incomeRows[i].amount += p.amount;
          incomeRows[i].payments.push(p);
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Fallback to last category (Outras receitas)
        incomeRows[incomeRows.length - 1].amount += p.amount;
        incomeRows[incomeRows.length - 1].payments.push(p);
      }
    });

    // Calculate AV% for income
    incomeRows.forEach((r) => {
      r.avPercentage = totalIncomes > 0 ? (r.amount / totalIncomes) * 100 : 0;
    });

    // Categories definition for Expenses matching media_1789940253416.png
    const expenseCategories = [
      {
        id: "saidas_fixas",
        label: "(-) SAÍDAS FIXAS",
        matcher: (cat: string) =>
          cat.includes("fixa") ||
          cat.includes("aluguel") ||
          cat.includes("energia") ||
          cat.includes("agua") ||
          cat.includes("água") ||
          cat.includes("internet") ||
          cat.includes("condominio") ||
          cat.includes("condomínio"),
      },
      {
        id: "saidas_variaveis",
        label: "(-) SAÍDAS VARIÁVEIS",
        matcher: (cat: string) =>
          cat.includes("variavel") ||
          cat.includes("variável") ||
          cat.includes("material") ||
          cat.includes("insumo") ||
          cat.includes("custo"),
      },
      {
        id: "folha_pagamento",
        label: "(-) SAÍDA COM FOLHA DE PAGAMENTO",
        matcher: (cat: string) =>
          cat.includes("folha") ||
          cat.includes("salario") ||
          cat.includes("salário") ||
          cat.includes("pro-labore") ||
          cat.includes("pró-labore") ||
          cat.includes("encargos"),
      },
      {
        id: "outras_saidas",
        label: "(-) OUTRAS SAÍDAS",
        matcher: () => true, // fallback
      },
    ];

    const expenseRows: DfcRowItem[] = expenseCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      payments: [],
    }));

    expensePayments.forEach((p) => {
      const lowerCat = p.category.toLowerCase();
      let matched = false;

      for (let i = 0; i < expenseCategories.length - 1; i++) {
        if (expenseCategories[i].matcher(lowerCat)) {
          expenseRows[i].amount += p.amount;
          expenseRows[i].payments.push(p);
          matched = true;
          break;
        }
      }

      if (!matched) {
        expenseRows[expenseRows.length - 1].amount += p.amount;
        expenseRows[expenseRows.length - 1].payments.push(p);
      }
    });

    // Calculate AV% for expenses (relative to total incomes or total expenses)
    expenseRows.forEach((r) => {
      r.avPercentage = totalIncomes > 0 ? (r.amount / totalIncomes) * 100 : 0;
    });

    const netCashGeneration = totalIncomes - totalExpenses;
    const finalBalance = initialBalance + netCashGeneration;
    const netMargin = totalIncomes > 0 ? (netCashGeneration / totalIncomes) * 100 : 0;
    const expenseToIncomePct = totalIncomes > 0 ? (totalExpenses / totalIncomes) * 100 : 0;

    return {
      initialBalance,
      totalIncomes,
      totalExpenses,
      netCashGeneration,
      finalBalance,
      netMargin,
      expenseToIncomePct,
      incomeRows,
      expenseRows,
    };
  }, [finance, currentMonthStr]);

  // Export CSV
  const handleExportCsv = () => {
    const header = [
      ["DEMONSTRATIVO DE FLUXO DE CAIXA (DFC) - REGIME DE CAIXA"],
      ["Período:", `${monthName} / ${selectedYear}`],
      ["Data da exportação:", new Date().toLocaleDateString("pt-BR")],
      [],
      ["Descrição", "Valor (R$)", "% AV"],
      ["1. Disponibilidades & Saldo Inicial", dfcData.initialBalance / 100, ""],
      [],
      ["2. Entradas Operacionais de Caixa", dfcData.totalIncomes / 100, "100.0%"],
      ...dfcData.incomeRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["3. Saídas Operacionais de Caixa", dfcData.totalExpenses / 100, `${dfcData.expenseToIncomePct.toFixed(1)}%`],
      ...dfcData.expenseRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["4. GERAÇÃO LÍQUIDA NO MÊS", dfcData.netCashGeneration / 100, `${dfcData.netMargin.toFixed(1)}%`],
      ["5. POSIÇÃO FINAL EM CAIXA", dfcData.finalBalance / 100, ""],
    ];

    exportFinanceCsv(`DFC-${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, "0")}.csv`, header);
    toast.success("Demonstrativo DFC exportado em CSV!");
  };

  return (
    <div className="space-y-4">
      {/* Top Banner exactly matching media_1789940253416.png */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium pt-0.5">
        <Database className="h-3.5 w-3.5 text-slate-400" />
        <span>
          <strong>DADOS DO SISTEMA - {selectedYear}.</strong> Valores calculados a partir dos lançamentos
          cadastrados, conforme o regime deste demonstrativo.
        </span>
      </div>

      {/* Main Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700 shadow-2xs">
              <TrendingUp className="h-4.5 w-4.5 stroke-[2.5]" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Demonstrativo de Fluxo de Caixa
            </h1>
            <Badge
              variant="outline"
              className="border-teal-300 bg-teal-50 text-teal-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"
            >
              DFC - Regime de Caixa
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Pill toggle for data source */}
            <div className="inline-flex items-center rounded-lg bg-slate-100/90 p-0.5 border border-slate-200/60 shadow-2xs">
              <button
                type="button"
                onClick={() => setDataSource("sistema")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                  dataSource === "sistema"
                    ? "bg-[#0f766e] text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Dados do sistema
              </button>
              <button
                type="button"
                onClick={() => setDataSource("simulacao")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  dataSource === "simulacao"
                    ? "bg-[#0f766e] text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Simulação / Manual
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Acompanhamento rigoroso de entradas, saídas liquidadas e liquidez imediata do escritório.
          </p>
        </div>

        {/* Right side controls */}
        <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Month stepper */}
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-0.5 shadow-xs">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                title="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1.5 px-3 text-xs font-semibold text-slate-800 min-w-[130px] justify-center">
                <Calendar className="h-3.5 w-3.5 text-teal-600" />
                <span>
                  {monthName} / {selectedYear}
                </span>
              </div>
              <button
                type="button"
                onClick={handleNextMonth}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                title="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Year selector */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  Ano {y}
                </option>
              ))}
            </select>

            {/* Sincronizar button */}
            <Button
              type="button"
              onClick={() => {
                onRefresh?.();
                toast.success("Dados sincronizados com o caixa.");
              }}
              className="h-9 rounded-xl bg-[#0f766e] hover:bg-[#115e59] text-white text-xs font-semibold px-3.5 shadow-xs flex items-center gap-1.5"
            >
              <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              <span>Sincronizar</span>
            </Button>
          </div>

          {/* Secondary row */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="h-8 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-2xs gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar CSV</span>
            </Button>
            <button
              type="button"
              title="Atualizar dados"
              onClick={() => onRefresh?.()}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-2xs transition-colors"
            >
              <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-tabs row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveSubTab("mes")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "mes"
                ? "bg-teal-50 text-teal-800 font-semibold border border-teal-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <Eye className="h-3.5 w-3.5 text-teal-600" />
            <span>Foco no Mês</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("12m")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "12m"
                ? "bg-teal-50 text-teal-800 font-semibold border border-teal-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>Matriz Anual (12M)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("liquidez")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "liquidez"
                ? "bg-teal-50 text-teal-800 font-semibold border border-teal-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
            <span>Evolução de Liquidez</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("simulacao")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "simulacao"
                ? "bg-teal-50 text-teal-800 font-semibold border border-teal-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
            <span>Simulação</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowAv(!showAv)}
          className={cn(
            "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all",
            showAv
              ? "border-teal-300 bg-teal-50 text-teal-700"
              : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"
          )}
        >
          <Percent className="h-3 w-3" />
          <span>AV (%) {showAv ? "Ativa" : "Oculta"}</span>
        </button>
      </div>

      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Saldo Inicial */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            SALDO INICIAL DO MÊS
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
            {currency(dfcData.initialBalance)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Disponibilidade no 1º dia de {monthName}
          </p>
        </div>

        {/* Card 2: Entradas */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-teal-600">
            ENTRADAS EM {monthName.toUpperCase()}
          </p>
          <p className="mt-1 text-2xl font-black text-teal-600 tracking-tight">
            {currency(dfcData.totalIncomes)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            dinheiro efetivamente liquidado no caixa
          </p>
        </div>

        {/* Card 3: Saídas */}
        <div className="relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <span className="absolute right-4 top-4 text-[11px] font-medium text-slate-500">
            {dfcData.expenseToIncomePct.toFixed(0)}% das entradas
          </span>
          <p className="text-[11px] font-bold uppercase tracking-wider text-rose-600">
            SAÍDAS EM {monthName.toUpperCase()}
          </p>
          <p className="mt-1 text-2xl font-black text-rose-600 tracking-tight">
            {currency(dfcData.totalExpenses)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            despesas, folha e custos operacionais
          </p>
        </div>

        {/* Card 4: Saldo Final */}
        <div className="relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <Badge
            variant="secondary"
            className={cn(
              "absolute right-4 top-4 rounded-full text-[10px] font-semibold",
              dfcData.finalBalance >= 0
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200"
            )}
          >
            {dfcData.finalBalance >= 0 ? "Caixa Positivo" : "Caixa Negativo"}
          </Badge>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            SALDO FINAL DO MÊS
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
            {currency(dfcData.finalBalance)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {dfcData.netMargin.toFixed(1)}% margem líquida
          </p>
        </div>
      </div>

      {/* SECTION 1: Disponibilidades & Saldo Inicial */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection1(!openSection1)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600 shadow-2xs">
              <Wallet className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                1. Disponibilidades & Saldo Inicial
              </h3>
              <p className="text-xs text-slate-500">
                Recursos em contas bancárias e tesouraria no início de {monthName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-900">
              {currency(dfcData.initialBalance)}
            </span>
            {openSection1 ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {openSection1 && (
          <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/30">
            <div className="flex items-center justify-between py-2 text-xs">
              <span className="text-slate-700 font-medium">
                Saldo em Contas (BB, Caixa, Tesouraria)
              </span>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900 tabular-nums">
                  {currency(dfcData.initialBalance)}
                </span>
                <button
                  type="button"
                  title="Ver detalhes"
                  onClick={() =>
                    setInspectedRow({
                      id: "saldo_inicial",
                      label: "Disponibilidades & Saldo Inicial",
                      amount: dfcData.initialBalance,
                      avPercentage: 0,
                      payments: [],
                    })
                  }
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Entradas Operacionais de Caixa */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection2(!openSection2)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-teal-100 bg-teal-50 text-teal-600 shadow-2xs">
              <TrendingUp className="h-4 w-4 stroke-[2.25]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. Entradas Operacionais de Caixa
              </h3>
              <p className="text-xs text-slate-500">
                Honorários e contratos efetivamente liquidados e creditados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-teal-600">
              {currency(dfcData.totalIncomes)}
            </span>
            {openSection2 ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {openSection2 && (
          <div className="border-t border-slate-100 divide-y divide-slate-100/70">
            {dfcData.incomeRows.map((row) => {
              const hasValue = row.amount > 0;
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors text-xs"
                >
                  <div className="space-y-1 flex-1 pr-4">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    {hasValue && (
                      <div className="h-1 w-48 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-teal-600 rounded-full"
                          style={{ width: `${Math.min(row.avPercentage, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {showAv && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "rounded-md text-[11px] font-semibold px-2 py-0.5",
                          hasValue
                            ? "bg-teal-50 text-teal-700 border-teal-200"
                            : "bg-slate-50 text-slate-400"
                        )}
                      >
                        {row.avPercentage.toFixed(1)}% AV
                      </Badge>
                    )}

                    <span
                      className={cn(
                        "font-semibold tabular-nums min-w-[80px] text-right",
                        hasValue ? "text-slate-900" : "text-slate-400"
                      )}
                    >
                      {currency(row.amount)}
                    </span>

                    <button
                      type="button"
                      title="Ver lançamentos"
                      onClick={() => setInspectedRow(row)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 3: Saídas Operacionais de Caixa */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection3(!openSection3)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-600 shadow-2xs">
              <TrendingDown className="h-4 w-4 stroke-[2.25]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                3. Saídas Operacionais de Caixa
              </h3>
              <p className="text-xs text-slate-500">
                Despesas, custos e folha efetivamente debitados das contas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-rose-600">
              {currency(dfcData.totalExpenses)}
            </span>
            {openSection3 ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {openSection3 && (
          <div className="border-t border-slate-100 divide-y divide-slate-100/70">
            {dfcData.expenseRows.map((row) => {
              const hasValue = row.amount > 0;
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors text-xs"
                >
                  <span className="font-medium text-slate-700 flex-1 pr-4">{row.label}</span>

                  <div className="flex items-center gap-4 shrink-0">
                    {showAv && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "rounded-md text-[11px] font-semibold px-2 py-0.5",
                          hasValue
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-slate-50 text-slate-400"
                        )}
                      >
                        {row.avPercentage.toFixed(1)}% AV
                      </Badge>
                    )}

                    <span
                      className={cn(
                        "font-semibold tabular-nums min-w-[80px] text-right",
                        hasValue ? "text-slate-900" : "text-slate-400"
                      )}
                    >
                      {currency(row.amount)}
                    </span>

                    <button
                      type="button"
                      title="Ver despesas"
                      onClick={() => setInspectedRow(row)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BOTTOM SUMMARY: Geração Líquida & Posição Final */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 p-6">
          {/* Left: Geração Líquida */}
          <div className="space-y-1 pb-4 md:pb-0 md:pr-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
              4. GERAÇÃO LÍQUIDA NO MÊS (ENTRADAS - SAÍDAS)
            </p>
            <p className="text-2xl sm:text-3xl font-black text-teal-600 tracking-tight">
              {currency(dfcData.netCashGeneration)}
            </p>
            <p className="text-xs text-slate-500">
              Margem operacional de caixa:{" "}
              <strong className="text-slate-700">{dfcData.netMargin.toFixed(1)}%</strong>
            </p>
          </div>

          {/* Right: Posição Final em Caixa */}
          <div className="space-y-1 pt-4 md:pt-0 md:pl-6 text-left md:text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
              5. POSIÇÃO FINAL EM CAIXA ({monthName.toUpperCase()})
            </p>
            <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {currency(dfcData.finalBalance)}
            </p>
            <p className="text-xs text-slate-500">
              Saldo Inicial ({currency(dfcData.initialBalance)}) + Geração Líquida (
              {currency(dfcData.netCashGeneration)})
            </p>
          </div>
        </div>
      </div>

      {/* Inspection Dialog */}
      {inspectedRow && (
        <Dialog open={!!inspectedRow} onOpenChange={(open) => !open && setInspectedRow(null)}>
          <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">
                {inspectedRow.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {inspectedRow.payments.length} lançamento(s) liquidado(s) em {monthName} de{" "}
                {selectedYear}. Total: <strong>{currency(inspectedRow.amount)}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-3">
              {inspectedRow.payments.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">
                  Nenhum lançamento liquidado nesta categoria para o período.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden">
                  {inspectedRow.payments.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => onSelectTitle?.(p.titleId)}
                      className="flex items-center justify-between p-3 text-xs hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="space-y-0.5 min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 truncate">
                            {p.description}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatClinicalDate(p.date)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {p.payerOrPatient} · {p.category}
                        </p>
                      </div>
                      <span className="font-bold tabular-nums text-slate-900 shrink-0">
                        {currency(p.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
