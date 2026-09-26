import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { cn } from "@/lib/utils";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  Download,
  Eye,
  Percent,
  RotateCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { exportFinanceCsv } from "./export-csv";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";

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
      (p) => p.date >= `${currentMonthStr}-01` && p.date <= `${currentMonthStr}-31`,
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
        matcher: (cat: string, desc: string) =>
          cat.includes("consultoria") || cat.includes("parecer"),
      },
      {
        id: "audiencias",
        label: "(+) Audiências e diligências",
        matcher: (cat: string, desc: string) =>
          cat.includes("audiencia") || cat.includes("audiência") || cat.includes("dilig"),
      },
      {
        id: "outras_receitas",
        label: "(+) Outras receitas",
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
      [
        "3. Saídas Operacionais de Caixa",
        dfcData.totalExpenses / 100,
        `${dfcData.expenseToIncomePct.toFixed(1)}%`,
      ],
      ...dfcData.expenseRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      [
        "4. GERAÇÃO LÍQUIDA NO MÊS",
        dfcData.netCashGeneration / 100,
        `${dfcData.netMargin.toFixed(1)}%`,
      ],
      ["5. POSIÇÃO FINAL EM CAIXA", dfcData.finalBalance / 100, ""],
    ];

    exportFinanceCsv(
      `DFC-${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, "0")}.csv`,
      header,
    );
    toast.success("Demonstrativo DFC exportado em CSV!");
  };

  return (
    <div className="space-y-4">
      {/* Top Banner exactly matching media_1789940253416.png */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium pt-0.5">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <span>
          <strong>DADOS DO SISTEMA - {selectedYear}.</strong> Valores calculados a partir dos
          lançamentos cadastrados, conforme o regime deste demonstrativo.
        </span>
      </div>

      {/* Main Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300 shadow-2xs">
              <TrendingUp className="h-4.5 w-4.5 stroke-[2.5]" />
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Demonstrativo de Fluxo de Caixa
            </h2>
            <Badge
              variant="outline"
              className="border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2.5 py-0.5 rounded-full"
            >
              DFC - Regime de Caixa
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Pill toggle for data source */}
            <div className="inline-flex items-center rounded-lg bg-muted/90 p-0.5 border border-border/60 shadow-2xs"></div>
          </div>
          <p className="text-xs text-muted-foreground">
            Acompanhamento rigoroso de entradas, saídas liquidadas e liquidez imediata da clínica.
          </p>
        </div>

        {/* Right side controls */}
        <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Month stepper */}
            <div className="inline-flex items-center rounded-xl border border-border bg-card p-0.5 shadow-xs">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Mês anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1.5 px-3 text-xs font-semibold text-foreground min-w-[130px] justify-center">
                <Calendar className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>
                  {monthName} / {selectedYear}
                </span>
              </div>
              <button
                type="button"
                onClick={handleNextMonth}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Próximo mês"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Year selector */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-9 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground/80 shadow-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20"
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
              }}
              className="h-9 rounded-xl bg-[#0f766e] hover:bg-[#115e59] text-white text-xs font-semibold px-3.5 shadow-xs flex items-center gap-1.5"
            >
              <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              <span>Atualizar dados</span>
            </Button>
          </div>

          {/* Secondary row */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="h-8 border-border bg-card text-xs font-medium text-foreground/80 hover:bg-muted/60 shadow-2xs gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar CSV</span>
            </Button>
            <button
              type="button"
              title="Atualizar dados"
              onClick={() => onRefresh?.()}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground shadow-2xs transition-colors"
            >
              <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-tabs row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border-soft py-2">
        <div className="flex flex-wrap items-center gap-1"></div>

        <button
          type="button"
          onClick={() => setShowAv(!showAv)}
          className={cn(
            "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all",
            showAv
              ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <Percent className="h-3 w-3" />
          <span>AV (%) {showAv ? "Ativa" : "Oculta"}</span>
        </button>
      </div>

      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Saldo Inicial */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            SALDO INICIAL DO MÊS
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">
            {currency(dfcData.initialBalance)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Disponibilidade no 1º dia de {monthName}
          </p>
        </div>

        {/* Card 2: Entradas */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            ENTRADAS EM {monthName.toUpperCase()}
          </p>
          <p className="mt-1 text-2xl font-semibold text-teal-600 dark:text-teal-400 tracking-tight">
            {currency(dfcData.totalIncomes)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            dinheiro efetivamente liquidado no caixa
          </p>
        </div>

        {/* Card 3: Saídas */}
        <div className="relative rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <span className="absolute right-4 top-4 text-xs font-medium text-muted-foreground">
            {dfcData.expenseToIncomePct.toFixed(0)}% das entradas
          </span>
          <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
            SAÍDAS EM {monthName.toUpperCase()}
          </p>
          <p className="mt-1 text-2xl font-semibold text-destructive tracking-tight">
            {currency(dfcData.totalExpenses)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            despesas, folha e custos operacionais
          </p>
        </div>

        {/* Card 4: Saldo Final */}
        <div className="relative rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <Badge
            variant="secondary"
            className={cn(
              "absolute right-4 top-4 rounded-full text-xs font-semibold",
              dfcData.finalBalance >= 0
                ? "bg-success/10 text-success border-success/25"
                : "bg-destructive/10 text-destructive border-destructive/25",
            )}
          >
            {dfcData.finalBalance >= 0 ? "Caixa Positivo" : "Caixa Negativo"}
          </Badge>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            SALDO FINAL DO MÊS
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">
            {currency(dfcData.finalBalance)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {dfcData.netMargin.toFixed(1)}% margem líquida
          </p>
        </div>
      </div>

      {/* SECTION 1: Disponibilidades & Saldo Inicial */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection1(!openSection1)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-info/15 bg-info/10 text-info shadow-2xs">
              <Wallet className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                1. Disponibilidades & Saldo Inicial
              </h3>
              <p className="text-xs text-muted-foreground">
                Recursos em contas bancárias e tesouraria no início de {monthName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">
              {currency(dfcData.initialBalance)}
            </span>
            {openSection1 ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {openSection1 && (
          <div className="border-t border-border-soft px-4 py-3 bg-muted/18">
            <div className="flex items-center justify-between py-2 text-xs">
              <span className="text-foreground/80 font-medium">
                Saldo em Contas (BB, Caixa, Tesouraria)
              </span>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-foreground tabular-nums">
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
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Entradas Operacionais de Caixa */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection2(!openSection2)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-400 shadow-2xs">
              <TrendingUp className="h-4 w-4 stroke-[2.25]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                2. Entradas Operacionais de Caixa
              </h3>
              <p className="text-xs text-muted-foreground">
                Honorários e contratos efetivamente liquidados e creditados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-teal-600 dark:text-teal-400">
              {currency(dfcData.totalIncomes)}
            </span>
            {openSection2 ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {openSection2 && (
          <div className="border-t border-border-soft divide-y divide-border-soft/70">
            {dfcData.incomeRows.map((row) => {
              const hasValue = row.amount > 0;
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors text-xs"
                >
                  <div className="space-y-1 flex-1 pr-4">
                    <span className="font-medium text-foreground/80">{row.label}</span>
                    {hasValue && (
                      <div className="h-1 w-48 rounded-full bg-muted overflow-hidden">
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
                          "rounded-md text-xs font-semibold px-2 py-0.5",
                          hasValue
                            ? "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30"
                            : "bg-muted/60 text-muted-foreground",
                        )}
                      >
                        {row.avPercentage.toFixed(1)}% AV
                      </Badge>
                    )}

                    <span
                      className={cn(
                        "font-semibold tabular-nums min-w-[80px] text-right",
                        hasValue ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {currency(row.amount)}
                    </span>

                    <button
                      type="button"
                      title="Ver lançamentos"
                      onClick={() => setInspectedRow(row)}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
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
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection3(!openSection3)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-destructive/15 bg-destructive/10 text-destructive shadow-2xs">
              <TrendingDown className="h-4 w-4 stroke-[2.25]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                3. Saídas Operacionais de Caixa
              </h3>
              <p className="text-xs text-muted-foreground">
                Despesas, custos e folha efetivamente debitados das contas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-destructive">
              {currency(dfcData.totalExpenses)}
            </span>
            {openSection3 ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {openSection3 && (
          <div className="border-t border-border-soft divide-y divide-border-soft/70">
            {dfcData.expenseRows.map((row) => {
              const hasValue = row.amount > 0;
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors text-xs"
                >
                  <span className="font-medium text-foreground/80 flex-1 pr-4">{row.label}</span>

                  <div className="flex items-center gap-4 shrink-0">
                    {showAv && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "rounded-md text-xs font-semibold px-2 py-0.5",
                          hasValue
                            ? "bg-destructive/10 text-destructive border-destructive/25"
                            : "bg-muted/60 text-muted-foreground",
                        )}
                      >
                        {row.avPercentage.toFixed(1)}% AV
                      </Badge>
                    )}

                    <span
                      className={cn(
                        "font-semibold tabular-nums min-w-[80px] text-right",
                        hasValue ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {currency(row.amount)}
                    </span>

                    <button
                      type="button"
                      title="Ver despesas"
                      onClick={() => setInspectedRow(row)}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
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
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-soft p-6">
          {/* Left: Geração Líquida */}
          <div className="space-y-1 pb-4 md:pb-0 md:pr-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              4. GERAÇÃO LÍQUIDA NO MÊS (ENTRADAS - SAÍDAS)
            </p>
            <p className="text-2xl sm:text-3xl font-semibold text-teal-600 dark:text-teal-400 tracking-tight">
              {currency(dfcData.netCashGeneration)}
            </p>
            <p className="text-xs text-muted-foreground">
              Margem operacional de caixa:{" "}
              <strong className="text-foreground/80">{dfcData.netMargin.toFixed(1)}%</strong>
            </p>
          </div>

          {/* Right: Posição Final em Caixa */}
          <div className="space-y-1 pt-4 md:pt-0 md:pl-6 text-left md:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              5. POSIÇÃO FINAL EM CAIXA ({monthName.toUpperCase()})
            </p>
            <p className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
              {currency(dfcData.finalBalance)}
            </p>
            <p className="text-xs text-muted-foreground">
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
              <DialogTitle className="text-base font-semibold text-foreground">
                {inspectedRow.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {inspectedRow.payments.length} lançamento(s) liquidado(s) em {monthName} de{" "}
                {selectedYear}. Total: <strong>{currency(inspectedRow.amount)}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-3">
              {inspectedRow.payments.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">
                  Nenhum lançamento liquidado nesta categoria para o período.
                </p>
              ) : (
                <div className="divide-y divide-border-soft rounded-xl border border-border-soft overflow-hidden">
                  {inspectedRow.payments.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => onSelectTitle?.(p.titleId)}
                      className="flex items-center justify-between p-3 text-xs hover:bg-muted/60 transition-colors cursor-pointer"
                    >
                      <div className="space-y-0.5 min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">
                            {p.description}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatClinicalDate(p.date)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.payerOrPatient} · {p.category}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums text-foreground shrink-0">
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
