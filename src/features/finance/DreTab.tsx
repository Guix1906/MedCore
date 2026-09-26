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
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileText,
  Percent,
  RotateCw,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { exportFinanceCsv } from "./export-csv";
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";

interface DreTabProps {
  finance: FinanceSnapshot;
  onRefresh?: () => void;
  refreshing?: boolean;
  onSelectTitle?: (id: string) => void;
}

interface DreRowItem {
  id: string;
  label: string;
  amount: number;
  avPercentage: number;
  titles: FinancialTitle[];
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

export function DreTab({ finance, onRefresh, refreshing, onSelectTitle }: DreTabProps) {
  const today = new Date();
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const hasCurrentMonth = (finance.titles || []).some((t) =>
      (t.competence_date || t.date || "").startsWith(currentYM),
    );
    if (hasCurrentMonth) return today.getFullYear();
    return 2026;
  });
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(() => {
    const hasCurrentMonth = (finance.titles || []).some((t) =>
      (t.competence_date || t.date || "").startsWith(currentYM),
    );
    if (hasCurrentMonth) return today.getMonth();
    return 8; // Setembro (0-indexed)
  });
  const [showAv, setShowAv] = useState(true);

  // Collapsible sections
  const [openSection1, setOpenSection1] = useState(true);
  const [openSection2, setOpenSection2] = useState(true);
  const [openSection3, setOpenSection3] = useState(true);
  const [openSection4, setOpenSection4] = useState(true);
  const [openSection5, setOpenSection5] = useState(true);

  // Inspection modal
  const [inspectedRow, setInspectedRow] = useState<DreRowItem | null>(null);

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

  // DRE Calculation (Regime de Competência)
  const dreData = useMemo(() => {
    // Filter titles belonging to the competence of currentMonthStr
    const titlesInMonth = finance.titles.filter((t) => {
      const compDate = t.competence_date || t.date || t.due_date;
      return compDate && compDate.startsWith(currentMonthStr);
    });

    const incomeTitles = titlesInMonth.filter((t) => t.type === "receita");
    const expenseTitles = titlesInMonth.filter((t) => t.type === "despesa");

    const grossRevenue = incomeTitles.reduce((acc, t) => acc + t.amount, 0);

    // Section 1: Receita Operacional Bruta Categories
    const revenueCategories = [
      {
        id: "previdenciario",
        label: "(+) Receita Previdenciário",
        matcher: (cat: string, desc: string) =>
          cat.includes("previd") || desc.includes("previd") || cat.includes("inss"),
      },
      {
        id: "agronegocio",
        label: "(+) Receita Agronegócio",
        matcher: (cat: string, desc: string) =>
          cat.includes("agro") ||
          desc.includes("agro") ||
          cat.includes("rural") ||
          cat.includes("consulta") ||
          cat.includes("procedimento") ||
          cat === "Outros" ||
          cat === "",
      },
      {
        id: "civil",
        label: "(+) Receita Civil",
        matcher: (cat: string, desc: string) => cat.includes("civil") || desc.includes("civil"),
      },
      {
        id: "criminal",
        label: "(+) Receita Criminal",
        matcher: (cat: string, desc: string) =>
          cat.includes("crim") || desc.includes("crim") || cat.includes("penal"),
      },
      {
        id: "trabalhista",
        label: "(+) Receita Trabalhista",
        matcher: (cat: string, desc: string) => cat.includes("trab") || desc.includes("trab"),
      },
      {
        id: "consumidor",
        label: "(+) Receita Consumidor",
        matcher: (cat: string, desc: string) => cat.includes("consum") || desc.includes("consum"),
      },
      {
        id: "outras_receitas",
        label: "(+) Outras receitas",
        matcher: () => false,
      },
    ];

    const revenueRows: DreRowItem[] = revenueCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      titles: [],
    }));

    incomeTitles.forEach((t) => {
      const lowerCat = (t.category || "").toLowerCase();
      const lowerDesc = (t.description || "").toLowerCase();
      let matched = false;

      for (let i = 0; i < revenueCategories.length - 1; i++) {
        if (revenueCategories[i].matcher(lowerCat, lowerDesc)) {
          revenueRows[i].amount += t.amount;
          revenueRows[i].titles.push(t);
          matched = true;
          break;
        }
      }

      if (!matched) {
        revenueRows[revenueRows.length - 1].amount += t.amount;
        revenueRows[revenueRows.length - 1].titles.push(t);
      }
    });

    revenueRows.forEach((r) => {
      r.avPercentage = grossRevenue > 0 ? (r.amount / grossRevenue) * 100 : 0;
    });

    // Section 2: Deduções da Receita Bruta
    const deductionCategories = [
      {
        id: "rescisoes",
        label: "(-) Rescisões contratuais",
        matcher: (cat: string) => cat.includes("rescis") || cat.includes("cancel"),
      },
      {
        id: "taxas_cartao",
        label: "(-) Taxas de cartão e despesas bancárias variáveis",
        matcher: (cat: string) =>
          cat.includes("taxa") || cat.includes("cartao") || cat.includes("banc"),
      },
      {
        id: "imposto_simples",
        label: "(-) Imposto Simples",
        matcher: (cat: string) =>
          cat.includes("imposto") || cat.includes("simples") || cat.includes("tribut"),
      },
    ];

    const deductionRows: DreRowItem[] = deductionCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      titles: [],
    }));

    // Find deductions in expenseTitles
    const deductionsTotal = deductionRows.reduce((acc, r) => acc + r.amount, 0);
    deductionRows.forEach((r) => {
      r.avPercentage = grossRevenue > 0 ? (r.amount / grossRevenue) * 100 : 0;
    });

    const netRevenue = grossRevenue - deductionsTotal;

    // Section 3: Custos dos Serviços Prestados (CSP / CAC)
    const costCategories = [
      {
        id: "custo_servico",
        label: "(-) Custo do Serviço Prestado (CSP)",
        matcher: (cat: string) =>
          cat.includes("csp") ||
          cat.includes("parceir") ||
          cat.includes("perito") ||
          cat.includes("custo"),
      },
      {
        id: "investimento_cac",
        label: "(-) Investimento em Custo de Aquisição de Cliente (CAC)",
        matcher: (cat: string) =>
          cat.includes("cac") || cat.includes("aquisic") || cat.includes("anuncio"),
      },
    ];

    const costRows: DreRowItem[] = costCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      titles: [],
    }));

    const totalCosts = costRows.reduce((acc, r) => acc + r.amount, 0);
    costRows.forEach((r) => {
      r.avPercentage = grossRevenue > 0 ? (r.amount / grossRevenue) * 100 : 0;
    });

    const grossOperationalResult = netRevenue - totalCosts;
    const grossMargin = grossRevenue > 0 ? (grossOperationalResult / grossRevenue) * 100 : 0;

    // Section 4: Despesas Operacionais
    const operatingCategories = [
      {
        id: "fornecedores",
        label: "(-) Fornecedores",
        matcher: (cat: string) => cat.includes("fornec") || cat.includes("material"),
      },
      {
        id: "despesas_admin",
        label: "(-) Despesas Administrativas / Estrutura",
        matcher: (cat: string) =>
          cat.includes("admin") ||
          cat.includes("aluguel") ||
          cat.includes("energia") ||
          cat.includes("agua") ||
          cat.includes("internet") ||
          cat.includes("condominio") ||
          cat.includes("software"),
      },
      {
        id: "departamento_pessoal",
        label: "(-) Departamento pessoal",
        matcher: (cat: string) =>
          cat.includes("pessoal") ||
          cat.includes("folha") ||
          cat.includes("salario") ||
          cat.includes("benef"),
      },
      {
        id: "comercial_marketing",
        label: "(-) Comercial / Marketing",
        matcher: (cat: string) =>
          cat.includes("comercial") || cat.includes("market") || cat.includes("propaganda"),
      },
      {
        id: "outras_despesas",
        label: "(-) Outras despesas",
        matcher: () => true, // fallback
      },
    ];

    const operatingRows: DreRowItem[] = operatingCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      titles: [],
    }));

    expenseTitles.forEach((t) => {
      const lowerCat = (t.category || "").toLowerCase();
      let matched = false;

      for (let i = 0; i < operatingCategories.length - 1; i++) {
        if (operatingCategories[i].matcher(lowerCat)) {
          operatingRows[i].amount += t.amount;
          operatingRows[i].titles.push(t);
          matched = true;
          break;
        }
      }

      if (!matched) {
        operatingRows[operatingRows.length - 1].amount += t.amount;
        operatingRows[operatingRows.length - 1].titles.push(t);
      }
    });

    const totalOperating = operatingRows.reduce((acc, r) => acc + r.amount, 0);
    operatingRows.forEach((r) => {
      r.avPercentage = grossRevenue > 0 ? (r.amount / grossRevenue) * 100 : 0;
    });

    const netOperatingResult = grossOperationalResult - totalOperating;
    const operatingMargin = grossRevenue > 0 ? (netOperatingResult / grossRevenue) * 100 : 0;

    // Section 5: Pró-Labore & Retiradas
    const proLaboreCategories = [
      {
        id: "pro_labore",
        label: "Pró-Labore dos Sócios",
        matcher: (cat: string) =>
          cat.includes("pro-labore") || cat.includes("pró-labore") || cat.includes("retirada"),
      },
    ];

    const proLaboreRows: DreRowItem[] = proLaboreCategories.map((c) => ({
      id: c.id,
      label: c.label,
      amount: 0,
      avPercentage: 0,
      titles: [],
    }));

    const totalProLabore = proLaboreRows.reduce((acc, r) => acc + r.amount, 0);
    const finalNetProfit = netOperatingResult - totalProLabore;
    const finalProfitability = grossRevenue > 0 ? (finalNetProfit / grossRevenue) * 100 : 0;

    return {
      grossRevenue,
      deductionsTotal,
      netRevenue,
      totalCosts,
      grossOperationalResult,
      grossMargin,
      totalOperating,
      netOperatingResult,
      operatingMargin,
      totalProLabore,
      finalNetProfit,
      finalProfitability,
      revenueRows,
      deductionRows,
      costRows,
      operatingRows,
      proLaboreRows,
    };
  }, [finance, currentMonthStr]);

  // Export CSV
  const handleExportCsv = () => {
    const data = [
      ["DEMONSTRATIVO DO RESULTADO DO EXERCÍCIO (DRE) - REGIME DE COMPETÊNCIA"],
      ["Período:", `${monthName} / ${selectedYear}`],
      ["Data da exportação:", new Date().toLocaleDateString("pt-BR")],
      [],
      ["Descrição", "Valor (R$)", "% AV"],
      ["1. Receita Operacional Bruta", dreData.grossRevenue / 100, "100.0%"],
      ...dreData.revenueRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["2. Deduções da Receita Bruta", dreData.deductionsTotal / 100, ""],
      ...dreData.deductionRows.map((r) => [
        r.label,
        r.amount / 100,
        `${r.avPercentage.toFixed(1)}%`,
      ]),
      [],
      ["(=) RECEITA OPERACIONAL LÍQUIDA", dreData.netRevenue / 100, ""],
      [],
      ["3. Custos dos Serviços Prestados (CSP / CAC)", dreData.totalCosts / 100, ""],
      ...dreData.costRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      [
        "(=) RESULTADO OPERACIONAL BRUTO",
        dreData.grossOperationalResult / 100,
        `${dreData.grossMargin.toFixed(1)}%`,
      ],
      [],
      ["4. Despesas Operacionais", dreData.totalOperating / 100, ""],
      ...dreData.operatingRows.map((r) => [
        r.label,
        r.amount / 100,
        `${r.avPercentage.toFixed(1)}%`,
      ]),
      [],
      [
        "(=) RESULTADO OPERACIONAL LÍQUIDO (EBITDA)",
        dreData.netOperatingResult / 100,
        `${dreData.operatingMargin.toFixed(1)}%`,
      ],
      [],
      ["5. Pró-Labore & Retiradas dos Sócios", dreData.totalProLabore / 100, ""],
      ...dreData.proLaboreRows.map((r) => [
        r.label,
        r.amount / 100,
        `${r.avPercentage.toFixed(1)}%`,
      ]),
      [],
      [
        "6. LUCRO LÍQUIDO FINAL DO EXERCÍCIO",
        dreData.finalNetProfit / 100,
        `${dreData.finalProfitability.toFixed(1)}%`,
      ],
    ];

    exportFinanceCsv(
      `DRE-${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, "0")}.csv`,
      data,
    );
    toast.success("Demonstrativo DRE exportado em CSV!");
  };

  return (
    <div className="space-y-4">
      {/* Header matching media_1789940285633.png */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary shadow-2xs">
              <Sparkles className="h-4.5 w-4.5 stroke-[2.25]" />
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Demonstrativo do Resultado do Exercício
            </h2>
            <Badge
              variant="outline"
              className="border-primary/25 bg-primary-soft text-primary text-xs font-semibold px-2.5 py-0.5 rounded-full"
            >
              DRE - Regime de Competência
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Pill toggle for data source */}
            <div className="inline-flex items-center rounded-lg bg-muted/90 p-0.5 border border-border/60 shadow-2xs"></div>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
            Demonstrativo gerencial por competência informada. Não substitui a escrituração contábil
            nem a apuração fiscal conforme a política de reconhecimento como o responsável contábil.
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
                <Calendar className="h-3.5 w-3.5 text-primary" />
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
              className="h-9 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground/80 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  Ano {y}
                </option>
              ))}
            </select>

            {/* Copiar para simulação */}
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAv(!showAv)}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all",
              showAv
                ? "border-primary/35 bg-primary-soft text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Percent className="h-3 w-3" />
            <span>AV (%) {showAv ? "Ativa" : "Oculta"}</span>
          </button>
        </div>
      </div>

      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Receita Bruta */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            RECEITA BRUTA EM {monthName.toUpperCase()}
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">
            {currency(dreData.grossRevenue)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            receitas identificadas na competência informada
          </p>
        </div>

        {/* Card 2: Receita Líquida */}
        <div className="relative rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <span className="absolute right-4 top-4 text-xs font-medium text-muted-foreground">
            {dreData.grossRevenue > 0
              ? `${((dreData.netRevenue / dreData.grossRevenue) * 100).toFixed(0)}% da Bruta`
              : "0% da Bruta"}
          </span>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            RECEITA LÍQUIDA DO MÊS
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">
            {currency(dreData.netRevenue)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            após dedução de tributos e taxas bancárias
          </p>
        </div>

        {/* Card 3: Resultado Operacional (EBITDA) */}
        <div className="relative rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <Badge
            variant="secondary"
            className="absolute right-4 top-4 rounded-md bg-info/10 text-info border-info/25 text-xs font-semibold px-2 py-0.5"
          >
            EBITDA
          </Badge>
          <p className="text-xs font-semibold uppercase tracking-wider text-info">
            RESULTADO OPERACIONAL
          </p>
          <p className="mt-1 text-2xl font-semibold text-info tracking-tight">
            {currency(dreData.netOperatingResult)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Margem operacional: {dreData.operatingMargin.toFixed(1)}%
          </p>
        </div>

        {/* Card 4: Lucro Líquido Final */}
        <div className="relative rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
          <Badge
            variant="secondary"
            className={cn(
              "absolute right-4 top-4 rounded-md text-xs font-semibold px-2 py-0.5",
              dreData.finalNetProfit >= 0
                ? "bg-success/10 text-success border-success/25"
                : "bg-destructive/10 text-destructive border-destructive/25",
            )}
          >
            {dreData.finalNetProfit >= 0 ? "Lucrativo" : "Prejuízo"}
          </Badge>
          <p className="text-xs font-semibold uppercase tracking-wider text-success">
            LUCRO LÍQUIDO FINAL
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tracking-tight",
              dreData.finalNetProfit < 0 ? "text-destructive" : "text-success",
            )}
          >
            {currency(dreData.finalNetProfit)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sobra final: {dreData.finalProfitability.toFixed(1)}% da receita bruta
          </p>
        </div>
      </div>

      {/* SECTION 1: 1. (=) Receita Operacional Bruta */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection1(!openSection1)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-info/15 bg-info/10 text-info shadow-2xs">
              <FileText className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                1. (=) Receita Operacional Bruta
              </h3>
              <p className="text-xs text-muted-foreground">
                Receitas agrupadas conforme as categorias dos lançamentos do mês
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-info">
              {currency(dreData.grossRevenue)}
            </span>
            {openSection1 ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {openSection1 && (
          <div className="border-t border-border-soft divide-y divide-border-soft/70">
            {dreData.revenueRows.map((row) => {
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
                          className="h-full bg-primary rounded-full"
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
                            ? "bg-primary-soft text-primary border-primary/25"
                            : "bg-muted/60 text-muted-foreground",
                        )}
                      >
                        {row.avPercentage.toFixed(1)}% AV
                      </Badge>
                    )}

                    <span
                      className={cn(
                        "font-semibold tabular-nums min-w-[80px] text-right",
                        hasValue ? "text-foreground font-semibold" : "text-muted-foreground",
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

      {/* SECTION 2: 2. (-) Deduções da Receita Bruta */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection2(!openSection2)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-warning/15 bg-warning/10 text-warning shadow-2xs">
              <Percent className="h-4 w-4 stroke-[2.25]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                2. (-) Deduções da Receita Bruta
              </h3>
              <p className="text-xs text-muted-foreground">
                Impostos diretos (Simples Nacional / ISS), taxas bancárias e cancelamentos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-warning">
              {currency(dreData.deductionsTotal)}
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
            {dreData.deductionRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors text-xs"
              >
                <span className="font-medium text-foreground/80 flex-1 pr-4">{row.label}</span>

                <div className="flex items-center gap-4 shrink-0">
                  {showAv && (
                    <Badge
                      variant="secondary"
                      className="rounded-md text-xs font-semibold px-2 py-0.5 bg-warning/10 text-warning border-warning/25"
                    >
                      {row.avPercentage.toFixed(1)}% AV
                    </Badge>
                  )}

                  <span className="font-semibold tabular-nums min-w-[80px] text-right text-muted-foreground">
                    {currency(row.amount)}
                  </span>

                  <button
                    type="button"
                    title="Ver detalhes"
                    onClick={() => setInspectedRow(row)}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SUBTOTAL STRIP 1: (=) RECEITA OPERACIONAL LÍQUIDA */}
      <div className="rounded-2xl border border-border/80 bg-muted/48 px-6 py-3.5 shadow-2xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            (=) RECEITA OPERACIONAL LÍQUIDA
          </p>
          <p className="text-xs text-muted-foreground">
            Receita Bruta ({currency(dreData.grossRevenue)}) - Deduções (
            {currency(dreData.deductionsTotal)})
          </p>
        </div>
        <span className="text-base font-semibold text-foreground tracking-tight">
          {currency(dreData.netRevenue)}
        </span>
      </div>

      {/* SECTION 3: 3. (-) Custos dos Serviços Prestados (CSP / CAC) */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection3(!openSection3)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/15 bg-primary-soft text-primary shadow-2xs">
              <Briefcase className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                3. (-) Custos dos Serviços Prestados (CSP / CAC)
              </h3>
              <p className="text-xs text-muted-foreground">
                Repasses diretos a parceiros, peritos, custas e CAC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-primary">
              {currency(dreData.totalCosts)}
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
            {dreData.costRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors text-xs"
              >
                <span className="font-medium text-foreground/80 flex-1 pr-4">{row.label}</span>

                <div className="flex items-center gap-4 shrink-0">
                  {showAv && (
                    <Badge
                      variant="secondary"
                      className="rounded-md text-xs font-semibold px-2 py-0.5 bg-primary-soft text-primary border-primary/25"
                    >
                      {row.avPercentage.toFixed(1)}% AV
                    </Badge>
                  )}

                  <span className="font-semibold tabular-nums min-w-[80px] text-right text-muted-foreground">
                    {currency(row.amount)}
                  </span>

                  <button
                    type="button"
                    title="Ver detalhes"
                    onClick={() => setInspectedRow(row)}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SUBTOTAL STRIP 2: (=) RESULTADO OPERACIONAL BRUTO */}
      <div className="rounded-2xl border border-border/80 bg-muted/48 px-6 py-3.5 shadow-2xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            (=) RESULTADO OPERACIONAL BRUTO
          </p>
          <p className="text-xs text-muted-foreground">
            Margem Bruta da Operação: {dreData.grossMargin.toFixed(1)}%
          </p>
        </div>
        <span className="text-base font-semibold text-foreground tracking-tight">
          {currency(dreData.grossOperationalResult)}
        </span>
      </div>

      {/* SECTION 4: 4. (-) Despesas Operacionais */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection4(!openSection4)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-destructive/15 bg-destructive/10 text-destructive shadow-2xs">
              <Building2 className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                4. (-) Despesas Operacionais
              </h3>
              <p className="text-xs text-muted-foreground">
                Folha de pagamento, administrativo/sede, softwares, marketing e instalações
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-destructive">
              {currency(dreData.totalOperating)}
            </span>
            {openSection4 ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {openSection4 && (
          <div className="border-t border-border-soft divide-y divide-border-soft/70">
            {dreData.operatingRows.map((row) => {
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
                        hasValue ? "text-foreground font-semibold" : "text-muted-foreground",
                      )}
                    >
                      {currency(row.amount)}
                    </span>

                    <button
                      type="button"
                      title="Ver detalhes"
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

      {/* SUBTOTAL STRIP 3: (=) RESULTADO OPERACIONAL LÍQUIDO (EBITDA) */}
      <div className="rounded-2xl border border-border/80 bg-muted/48 px-6 py-3.5 shadow-2xs flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            (=) RESULTADO OPERACIONAL LÍQUIDO (EBITDA)
          </p>
          <p className="text-xs text-muted-foreground">
            Margem Operacional Líquida: {dreData.operatingMargin.toFixed(1)}%
          </p>
        </div>
        <span className="text-base font-semibold text-foreground tracking-tight">
          {currency(dreData.netOperatingResult)}
        </span>
      </div>

      {/* SECTION 5: 5. (-) Pró-Labore & Retiradas dos Sócios */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection5(!openSection5)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-muted text-foreground/80 shadow-2xs">
              <Users className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                5. (-) Pró-Labore & Retiradas dos Sócios
              </h3>
              <p className="text-xs text-muted-foreground">
                Remuneração mensal fixa dos sócios/advogados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">
              {currency(dreData.totalProLabore)}
            </span>
            {openSection5 ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {openSection5 && (
          <div className="border-t border-border-soft divide-y divide-border-soft/70">
            {dreData.proLaboreRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors text-xs"
              >
                <span className="font-medium text-foreground/80 flex-1 pr-4">{row.label}</span>

                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-semibold tabular-nums min-w-[80px] text-right text-muted-foreground">
                    {currency(row.amount)}
                  </span>

                  <button
                    type="button"
                    title="Ver detalhes"
                    onClick={() => setInspectedRow(row)}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FINAL SUMMARY CARD: 6. LUCRO LÍQUIDO FINAL DO EXERCÍCIO (SOBRA) */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            6. LUCRO LÍQUIDO FINAL DO EXERCÍCIO (SOBRA)
          </p>
          <p
            className={cn(
              "text-3xl font-semibold tracking-tight",
              dreData.finalNetProfit < 0 ? "text-destructive" : "text-success",
            )}
          >
            {currency(dreData.finalNetProfit)}
          </p>
          <p className="text-xs text-muted-foreground">
            Sobra real da operação após todas as deduções, despesas e pró-labore.
          </p>
        </div>

        <Badge
          variant="outline"
          className="border-success/25 bg-success/10 text-success text-xs font-semibold px-3 py-1.5 rounded-full self-start sm:self-center"
        >
          Rentabilidade: {dreData.finalProfitability.toFixed(1)}%
        </Badge>
      </div>

      {/* Inspection Modal for DRE Row */}
      {inspectedRow && (
        <Dialog open={!!inspectedRow} onOpenChange={(open) => !open && setInspectedRow(null)}>
          <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-foreground">
                {inspectedRow.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {inspectedRow.titles.length} lançamento(s) na competência de {monthName} de{" "}
                {selectedYear}. Total: <strong>{currency(inspectedRow.amount)}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-3">
              {inspectedRow.titles.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">
                  Nenhum lançamento encontrado nesta categoria para a competência informada.
                </p>
              ) : (
                <div className="divide-y divide-border-soft rounded-xl border border-border-soft overflow-hidden">
                  {inspectedRow.titles.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => onSelectTitle?.(t.id)}
                      className="flex items-center justify-between p-3 text-xs hover:bg-muted/60 transition-colors cursor-pointer"
                    >
                      <div className="space-y-0.5 min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">
                            {t.description || "Lançamento"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatClinicalDate(t.competence_date || t.date || t.due_date)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {t.patient_name || t.payer_name || "Cliente/Pagador não informado"} ·{" "}
                          {t.category || "Sem categoria"}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums text-foreground shrink-0">
                        {currency(t.amount)}
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
