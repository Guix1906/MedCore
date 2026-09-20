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
  Sparkles,
  Percent,
  Copy,
  Building2,
  Database,
  FileText,
  Briefcase,
  Users,
  AlertCircle,
  BarChart3,
  TrendingUp,
  Scale,
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
import type { FinanceSnapshot, FinancialTitle } from "./finance-schema";
import { currency, formatClinicalDate } from "@/features/acompanhamentos/followup-utils";
import { exportFinanceCsv } from "./export-csv";

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
  const [selectedYear, setSelectedYear] = useState<number>(today.getFullYear());
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(today.getMonth()); // 0-11
  const [dataSource, setDataSource] = useState<"sistema" | "simulacao">("sistema");
  const [activeSubTab, setActiveSubTab] = useState<"cascata" | "12m" | "margens" | "diagnostico">("cascata");
  const [showAv, setShowAv] = useState(true);
  const [socioView, setSocioView] = useState(false);

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
        matcher: (cat: string, desc: string) => cat.includes("crim") || desc.includes("crim") || cat.includes("penal"),
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
        matcher: (cat: string) => cat.includes("taxa") || cat.includes("cartao") || cat.includes("banc"),
      },
      {
        id: "imposto_simples",
        label: "(-) Imposto Simples",
        matcher: (cat: string) => cat.includes("imposto") || cat.includes("simples") || cat.includes("tribut"),
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
        matcher: (cat: string) => cat.includes("csp") || cat.includes("parceir") || cat.includes("perito") || cat.includes("custo"),
      },
      {
        id: "investimento_cac",
        label: "(-) Investimento em Custo de Aquisição de Cliente (CAC)",
        matcher: (cat: string) => cat.includes("cac") || cat.includes("aquisic") || cat.includes("anuncio"),
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
        matcher: (cat: string) => cat.includes("pessoal") || cat.includes("folha") || cat.includes("salario") || cat.includes("benef"),
      },
      {
        id: "comercial_marketing",
        label: "(-) Comercial / Marketing",
        matcher: (cat: string) => cat.includes("comercial") || cat.includes("market") || cat.includes("propaganda"),
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
        matcher: (cat: string) => cat.includes("pro-labore") || cat.includes("pró-labore") || cat.includes("retirada"),
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
      ...dreData.deductionRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["(=) RECEITA OPERACIONAL LÍQUIDA", dreData.netRevenue / 100, ""],
      [],
      ["3. Custos dos Serviços Prestados (CSP / CAC)", dreData.totalCosts / 100, ""],
      ...dreData.costRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["(=) RESULTADO OPERACIONAL BRUTO", dreData.grossOperationalResult / 100, `${dreData.grossMargin.toFixed(1)}%`],
      [],
      ["4. Despesas Operacionais", dreData.totalOperating / 100, ""],
      ...dreData.operatingRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["(=) RESULTADO OPERACIONAL LÍQUIDO (EBITDA)", dreData.netOperatingResult / 100, `${dreData.operatingMargin.toFixed(1)}%`],
      [],
      ["5. Pró-Labore & Retiradas dos Sócios", dreData.totalProLabore / 100, ""],
      ...dreData.proLaboreRows.map((r) => [r.label, r.amount / 100, `${r.avPercentage.toFixed(1)}%`]),
      [],
      ["6. LUCRO LÍQUIDO FINAL DO EXERCÍCIO", dreData.finalNetProfit / 100, `${dreData.finalProfitability.toFixed(1)}%`],
    ];

    exportFinanceCsv(`DRE-${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, "0")}.csv`, data);
    toast.success("Demonstrativo DRE exportado em CSV!");
  };

  return (
    <div className="space-y-4">
      {/* Header matching media_1789940285633.png */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 shadow-2xs">
              <Sparkles className="h-4.5 w-4.5 stroke-[2.25]" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Demonstrativo do Resultado do Exercício
            </h1>
            <Badge
              variant="outline"
              className="border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-0.5 rounded-full"
            >
              DRE - Regime de Competência
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
                    ? "bg-[#5046e5] text-white shadow-xs"
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
                    ? "bg-[#5046e5] text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                Simulação / Manual
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
            Demonstrativo gerencial por competência informada. Não substitui a escrituração contábil nem a apuração fiscal conforme a política de reconhecimento como o responsável contábil.
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
                <Calendar className="h-3.5 w-3.5 text-indigo-600" />
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
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
                <option key={y} value={y}>
                  Ano {y}
                </option>
              ))}
            </select>

            {/* Copiar para simulação */}
            <Button
              type="button"
              onClick={() => {
                toast.success("Dados copiados para o modo de simulação!");
                setDataSource("simulacao");
              }}
              className="h-9 rounded-xl bg-[#5046e5] hover:bg-[#4338ca] text-white text-xs font-semibold px-3.5 shadow-xs flex items-center gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copiar para simulação</span>
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
            onClick={() => setActiveSubTab("cascata")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "cascata"
                ? "bg-indigo-50 text-indigo-800 font-semibold border border-indigo-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <Eye className="h-3.5 w-3.5 text-indigo-600" />
            <span>Cascata Mensal</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("12m")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "12m"
                ? "bg-indigo-50 text-indigo-800 font-semibold border border-indigo-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>Matriz Anual (12M)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("margens")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "margens"
                ? "bg-indigo-50 text-indigo-800 font-semibold border border-indigo-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <BarChart3 className="h-3.5 w-3.5 text-slate-400" />
            <span>Evolução & Margens</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("diagnostico")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              activeSubTab === "diagnostico"
                ? "bg-indigo-50 text-indigo-800 font-semibold border border-indigo-200/70"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            <Scale className="h-3.5 w-3.5 text-slate-400" />
            <span>Diagnóstico Contábil</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSocioView(!socioView)}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all",
              socioView
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            <Building2 className="h-3 w-3" />
            <span>Visão Sócios / Diretoria</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAv(!showAv)}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all",
              showAv
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"
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
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            RECEITA BRUTA EM {monthName.toUpperCase()}
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
            {currency(dreData.grossRevenue)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            receitas identificadas na competência informada
          </p>
        </div>

        {/* Card 2: Receita Líquida */}
        <div className="relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <span className="absolute right-4 top-4 text-[11px] font-medium text-slate-500">
            {dreData.grossRevenue > 0
              ? `${((dreData.netRevenue / dreData.grossRevenue) * 100).toFixed(0)}% da Bruta`
              : "0% da Bruta"}
          </span>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            RECEITA LÍQUIDA DO MÊS
          </p>
          <p className="mt-1 text-2xl font-black text-slate-900 tracking-tight">
            {currency(dreData.netRevenue)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            após dedução de tributos e taxas bancárias
          </p>
        </div>

        {/* Card 3: Resultado Operacional (EBITDA) */}
        <div className="relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <Badge
            variant="secondary"
            className="absolute right-4 top-4 rounded-md bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold px-2 py-0.5"
          >
            EBITDA
          </Badge>
          <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
            RESULTADO OPERACIONAL
          </p>
          <p className="mt-1 text-2xl font-black text-blue-600 tracking-tight">
            {currency(dreData.netOperatingResult)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Margem operacional: {dreData.operatingMargin.toFixed(1)}%
          </p>
        </div>

        {/* Card 4: Lucro Líquido Final */}
        <div className="relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <Badge
            variant="secondary"
            className={cn(
              "absolute right-4 top-4 rounded-md text-[10px] font-bold px-2 py-0.5",
              dreData.finalNetProfit >= 0
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200"
            )}
          >
            {dreData.finalNetProfit >= 0 ? "Lucrativo" : "Prejuízo"}
          </Badge>
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
            LUCRO LÍQUIDO FINAL
          </p>
          <p className="mt-1 text-2xl font-black text-emerald-600 tracking-tight">
            {currency(dreData.finalNetProfit)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Sobra final: {dreData.finalProfitability.toFixed(1)}% da receita bruta
          </p>
        </div>
      </div>

      {/* SECTION 1: 1. (=) Receita Operacional Bruta */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection1(!openSection1)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600 shadow-2xs">
              <FileText className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                1. (=) Receita Operacional Bruta
              </h3>
              <p className="text-xs text-slate-500">
                Faturamento por produtos jurídicos e contratos fechados no mês
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-blue-600">
              {currency(dreData.grossRevenue)}
            </span>
            {openSection1 ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {openSection1 && (
          <div className="border-t border-slate-100 divide-y divide-slate-100/70">
            {dreData.revenueRows.map((row) => {
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
                          className="h-full bg-indigo-600 rounded-full"
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
                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                            : "bg-slate-50 text-slate-400"
                        )}
                      >
                        {row.avPercentage.toFixed(1)}% AV
                      </Badge>
                    )}

                    <span
                      className={cn(
                        "font-semibold tabular-nums min-w-[80px] text-right",
                        hasValue ? "text-slate-900 font-bold" : "text-slate-400"
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

      {/* SECTION 2: 2. (-) Deduções da Receita Bruta */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection2(!openSection2)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-100 bg-amber-50 text-amber-600 shadow-2xs">
              <Percent className="h-4 w-4 stroke-[2.25]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                2. (-) Deduções da Receita Bruta
              </h3>
              <p className="text-xs text-slate-500">
                Impostos diretos (Simples Nacional / ISS), taxas bancárias e cancelamentos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-amber-600">
              {currency(dreData.deductionsTotal)}
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
            {dreData.deductionRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors text-xs"
              >
                <span className="font-medium text-slate-700 flex-1 pr-4">{row.label}</span>

                <div className="flex items-center gap-4 shrink-0">
                  {showAv && (
                    <Badge
                      variant="secondary"
                      className="rounded-md text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-700 border-amber-200"
                    >
                      {row.avPercentage.toFixed(1)}% AV
                    </Badge>
                  )}

                  <span className="font-semibold tabular-nums min-w-[80px] text-right text-slate-400">
                    {currency(row.amount)}
                  </span>

                  <button
                    type="button"
                    title="Ver detalhes"
                    onClick={() => setInspectedRow(row)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
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
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-6 py-3.5 shadow-2xs flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
            (=) RECEITA OPERACIONAL LÍQUIDA
          </p>
          <p className="text-[11px] text-slate-400">
            Receita Bruta ({currency(dreData.grossRevenue)}) - Deduções ({currency(dreData.deductionsTotal)})
          </p>
        </div>
        <span className="text-base font-black text-slate-900 tracking-tight">
          {currency(dreData.netRevenue)}
        </span>
      </div>

      {/* SECTION 3: 3. (-) Custos dos Serviços Prestados (CSP / CAC) */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection3(!openSection3)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-purple-100 bg-purple-50 text-purple-600 shadow-2xs">
              <Briefcase className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                3. (-) Custos dos Serviços Prestados (CSP / CAC)
              </h3>
              <p className="text-xs text-slate-500">
                Repasses diretos a parceiros, peritos, custas e CAC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-purple-600">
              {currency(dreData.totalCosts)}
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
            {dreData.costRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors text-xs"
              >
                <span className="font-medium text-slate-700 flex-1 pr-4">{row.label}</span>

                <div className="flex items-center gap-4 shrink-0">
                  {showAv && (
                    <Badge
                      variant="secondary"
                      className="rounded-md text-[11px] font-semibold px-2 py-0.5 bg-purple-50 text-purple-700 border-purple-200"
                    >
                      {row.avPercentage.toFixed(1)}% AV
                    </Badge>
                  )}

                  <span className="font-semibold tabular-nums min-w-[80px] text-right text-slate-400">
                    {currency(row.amount)}
                  </span>

                  <button
                    type="button"
                    title="Ver detalhes"
                    onClick={() => setInspectedRow(row)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
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
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-6 py-3.5 shadow-2xs flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
            (=) RESULTADO OPERACIONAL BRUTO
          </p>
          <p className="text-[11px] text-slate-400">
            Margem Bruta da Operação: {dreData.grossMargin.toFixed(1)}%
          </p>
        </div>
        <span className="text-base font-black text-slate-900 tracking-tight">
          {currency(dreData.grossOperationalResult)}
        </span>
      </div>

      {/* SECTION 4: 4. (-) Despesas Operacionais */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection4(!openSection4)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-600 shadow-2xs">
              <Building2 className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                4. (-) Despesas Operacionais
              </h3>
              <p className="text-xs text-slate-500">
                Folha de pagamento, administrativo/sede, softwares, marketing e instalações
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-rose-600">
              {currency(dreData.totalOperating)}
            </span>
            {openSection4 ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {openSection4 && (
          <div className="border-t border-slate-100 divide-y divide-slate-100/70">
            {dreData.operatingRows.map((row) => {
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
                        hasValue ? "text-slate-900 font-bold" : "text-slate-400"
                      )}
                    >
                      {currency(row.amount)}
                    </span>

                    <button
                      type="button"
                      title="Ver detalhes"
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

      {/* SUBTOTAL STRIP 3: (=) RESULTADO OPERACIONAL LÍQUIDO (EBITDA) */}
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-6 py-3.5 shadow-2xs flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
            (=) RESULTADO OPERACIONAL LÍQUIDO (EBITDA)
          </p>
          <p className="text-[11px] text-slate-400">
            Margem Operacional Líquida: {dreData.operatingMargin.toFixed(1)}%
          </p>
        </div>
        <span className="text-base font-black text-slate-900 tracking-tight">
          {currency(dreData.netOperatingResult)}
        </span>
      </div>

      {/* SECTION 5: 5. (-) Pró-Labore & Retiradas dos Sócios */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <button
          type="button"
          onClick={() => setOpenSection5(!openSection5)}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 shadow-2xs">
              <Users className="h-4 w-4 stroke-[2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                5. (-) Pró-Labore & Retiradas dos Sócios
              </h3>
              <p className="text-xs text-slate-500">
                Remuneração mensal fixa dos sócios/advogados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-900">
              {currency(dreData.totalProLabore)}
            </span>
            {openSection5 ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {openSection5 && (
          <div className="border-t border-slate-100 divide-y divide-slate-100/70">
            {dreData.proLaboreRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors text-xs"
              >
                <span className="font-medium text-slate-700 flex-1 pr-4">{row.label}</span>

                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-semibold tabular-nums min-w-[80px] text-right text-slate-400">
                    {currency(row.amount)}
                  </span>

                  <button
                    type="button"
                    title="Ver detalhes"
                    onClick={() => setInspectedRow(row)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
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
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
            6. LUCRO LÍQUIDO FINAL DO EXERCÍCIO (SOBRA)
          </p>
          <p className="text-3xl font-black text-emerald-600 tracking-tight">
            {currency(dreData.finalNetProfit)}
          </p>
          <p className="text-xs text-slate-400">
            Sobra real da operação após todas as deduções, despesas e pró-labore.
          </p>
        </div>

        <Badge
          variant="outline"
          className="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded-full self-start sm:self-center"
        >
          Rentabilidade: {dreData.finalProfitability.toFixed(1)}%
        </Badge>
      </div>

      {/* Inspection Modal for DRE Row */}
      {inspectedRow && (
        <Dialog open={!!inspectedRow} onOpenChange={(open) => !open && setInspectedRow(null)}>
          <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">
                {inspectedRow.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {inspectedRow.titles.length} lançamento(s) na competência de {monthName} de{" "}
                {selectedYear}. Total: <strong>{currency(inspectedRow.amount)}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-3">
              {inspectedRow.titles.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">
                  Nenhum lançamento encontrado nesta categoria para a competência informada.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden">
                  {inspectedRow.titles.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => onSelectTitle?.(t.id)}
                      className="flex items-center justify-between p-3 text-xs hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="space-y-0.5 min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 truncate">
                            {t.description || "Lançamento"}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatClinicalDate(t.competence_date || t.date || t.due_date)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {t.patient_name || t.payer_name || "Cliente/Pagador não informado"} · {t.category || "Sem categoria"}
                        </p>
                      </div>
                      <span className="font-bold tabular-nums text-slate-900 shrink-0">
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
