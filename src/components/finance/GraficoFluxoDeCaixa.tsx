import { useState, useMemo } from "react";
import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Filter, Check } from "lucide-react";
import { Chart, CHART_COLORS } from "@/components/ds/Chart";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui-app/SegmentedControl";

// ============================================================================
// Tipagens
// ============================================================================
export interface LancamentoFluxo {
  id: string;
  amount: number;
  paid_amount?: number | null;
  entry_type?: "receita" | "despesa";
  type?: "receita" | "despesa";
  status?: "pago" | "pendente" | "cancelado";
  paid_at?: string | null;
  due_date?: string | null;
  date?: string;
  transaction_id?: string;
  created_at?: string;
  description?: string;
  category?: string;
  client_name?: string;
  payment_method?: string;
  payment_account?: string;
  account_id?: string;
  company_id?: string | null;
  is_expense?: boolean;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  badgeLabel?: string;
  title?: any;
}

export interface DayChartPoint {
  date: string; // "dd/MM/yyyy"
  iso?: string; // "yyyy-MM-dd"
  entradas: number; // Total recebido no dia
  saidas: number; // Total pago no dia
  aReceber?: number; // Total previsto a receber
  aPagar?: number; // Total previsto a pagar
  saldo: number; // Saldo acumulado até o dia
}

export type ChartGranularity = "dia" | "semana" | "mes" | "anual";

export interface GraficoFluxoDeCaixaProps {
  entries?: LancamentoFluxo[];
  // Caso já queira passar os dados agrupados diretamente:
  customChartData?: DayChartPoint[];
  // Granularidade do gráfico (Dia, Semana, Anual):
  granularity?: ChartGranularity;
  onGranularityChange?: (g: ChartGranularity) => void;
  // Período e filtros opcionais passados pelo container:
  periodLabel?: string;
  startDate?: string;
  endDate?: string;
  onDateRangeChange?: (start: string, end: string) => void;
  onSelectPeriodPreset?: (preset: "dia" | "semana" | "mes" | "ano") => void;
}

// ============================================================================
// Formatadores e Helpers de Data
// ============================================================================
const fmtBRL = (val: number): string =>
  val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const compactValue = (val: number) =>
  Math.abs(val) >= 1000 ? `${Math.round(val / 1000)}k` : String(Math.round(val));

function parsePointDate(point: DayChartPoint): Date {
  if (point.iso) {
    const p = parseISO(point.iso);
    if (!isNaN(p.getTime())) return p;
  }
  if (point.date && point.date.includes("/")) {
    const parts = point.date.split("/");
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const p = parseISO(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
      if (!isNaN(p.getTime())) return p;
    }
  }
  return new Date();
}

// ============================================================================
// Componente Principal do Gráfico (ApexCharts)
// ============================================================================
export function GraficoFluxoDeCaixa({
  entries = [],
  customChartData,
  granularity: controlledGranularity,
  onGranularityChange,
  periodLabel,
  startDate,
  endDate,
  onDateRangeChange,
  onSelectPeriodPreset,
}: GraficoFluxoDeCaixaProps) {
  // Controle local ou controlado da granularidade (Dia, Semana, Anual)
  const [internalGranularity, setInternalGranularity] = useState<ChartGranularity>("dia");
  const activeGranularity = controlledGranularity ?? internalGranularity;

  const handleSelectGranularity = (g: ChartGranularity) => {
    setInternalGranularity(g);
    onGranularityChange?.(g);
  };

  // Estado local para o popover de filtro de datas
  const [tempStart, setTempStart] = useState(startDate || "");
  const [tempEnd, setTempEnd] = useState(endDate || "");
  const [popoverOpen, setPopoverOpen] = useState(false);

  // 1. Processamento base dia a dia dos lançamentos
  const baseDailyData = useMemo<DayChartPoint[]>(() => {
    if (customChartData && customChartData.length > 0) {
      return customChartData;
    }

    // REGRA DO FLUXO DE CAIXA: Apenas lançamentos realizados (pagos)
    const safeEntries = Array.isArray(entries) ? entries : [];
    const realizadados = safeEntries.filter(
      (e) => e && (e.status === "pago" || !e.status) && (e.paid_at || e.date || e.due_date),
    );

    // Ordenação cronológica
    const ordenados = [...realizadados].sort((a, b) => {
      const da = String(a.paid_at || a.date || a.due_date || "");
      const db = String(b.paid_at || b.date || b.due_date || "");
      return da.localeCompare(db);
    });

    const dayMap = new Map<
      string,
      { label: string; entradas: number; saidas: number; aReceber: number; aPagar: number; iso: string }
    >();

    ordenados.forEach((e) => {
      const dStr = String(e.paid_at || e.date || e.due_date || "").slice(0, 10);
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

      const current = dayMap.get(label) || {
        label,
        entradas: 0,
        saidas: 0,
        aReceber: 0,
        aPagar: 0,
        iso: dStr,
      };
      const valor = Number(e.paid_amount ?? e.amount ?? 0);
      const isEntrada =
        e.entry_type === "receita" ||
        e.type === "receita" ||
        (e.is_expense === false) ||
        (!e.entry_type && !e.type && !e.is_expense);

      if (isEntrada) {
        current.entradas += valor;
      } else {
        current.saidas += valor;
      }

      dayMap.set(label, current);
    });

    let runningSaldo = 0;
    return Array.from(dayMap.values()).map((vals) => {
      runningSaldo += vals.entradas - vals.saidas;
      return {
        date: vals.label,
        iso: vals.iso,
        entradas: vals.entradas,
        saidas: vals.saidas,
        aReceber: vals.aReceber,
        aPagar: vals.aPagar,
        saldo: runningSaldo,
      };
    });
  }, [entries, customChartData]);

  // 2. Agrupamento conforme a granularidade selecionada (Dia, Semana, Anual)
  const { chartData, maxVolume } = useMemo(() => {
    if (baseDailyData.length === 0) {
      return { chartData: [], maxVolume: 1000 };
    }

    let aggregated: DayChartPoint[] = [];

    if (activeGranularity === "semana") {
      // Agrupamento por Semana
      const weekMap = new Map<
        string,
        { label: string; entradas: number; saidas: number; aReceber: number; aPagar: number; iso: string }
      >();

      baseDailyData.forEach((d) => {
        const dt = parsePointDate(d);
        const wStart = startOfWeek(dt, { weekStartsOn: 1 });
        const wEnd = endOfWeek(dt, { weekStartsOn: 1 });
        const key = format(wStart, "yyyy-MM-dd");
        const label = `${format(wStart, "dd/MM")} - ${format(wEnd, "dd/MM")}`;

        const cur = weekMap.get(key) || {
          label,
          entradas: 0,
          saidas: 0,
          aReceber: 0,
          aPagar: 0,
          iso: key,
        };
        cur.entradas += d.entradas;
        cur.saidas += d.saidas;
        cur.aReceber += d.aReceber || 0;
        cur.aPagar += d.aPagar || 0;
        weekMap.set(key, cur);
      });

      let running = 0;
      aggregated = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, item]) => {
          running += item.entradas - item.saidas;
          return {
            date: item.label,
            iso: item.iso,
            entradas: item.entradas,
            saidas: item.saidas,
            aReceber: item.aReceber,
            aPagar: item.aPagar,
            saldo: running,
          };
        });
    } else if (activeGranularity === "mes") {
      // Agrupamento por Mês
      const monthMap = new Map<
        string,
        { label: string; entradas: number; saidas: number; aReceber: number; aPagar: number; iso: string }
      >();

      baseDailyData.forEach((d) => {
        const dt = parsePointDate(d);
        const key = format(dt, "yyyy-MM");
        const rawMonth = format(dt, "MMM/yy", { locale: ptBR });
        const label = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);

        const cur = monthMap.get(key) || {
          label,
          entradas: 0,
          saidas: 0,
          aReceber: 0,
          aPagar: 0,
          iso: key,
        };
        cur.entradas += d.entradas;
        cur.saidas += d.saidas;
        cur.aReceber += d.aReceber || 0;
        cur.aPagar += d.aPagar || 0;
        monthMap.set(key, cur);
      });

      let running = 0;
      aggregated = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, item]) => {
          running += item.entradas - item.saidas;
          return {
            date: item.label,
            iso: item.iso,
            entradas: item.entradas,
            saidas: item.saidas,
            aReceber: item.aReceber,
            aPagar: item.aPagar,
            saldo: running,
          };
        });
    } else if (activeGranularity === "anual") {
      // Agrupamento por Ano
      const yearMap = new Map<
        string,
        { label: string; entradas: number; saidas: number; aReceber: number; aPagar: number; iso: string }
      >();

      baseDailyData.forEach((d) => {
        const dt = parsePointDate(d);
        const key = format(dt, "yyyy");
        const label = key;

        const cur = yearMap.get(key) || {
          label,
          entradas: 0,
          saidas: 0,
          aReceber: 0,
          aPagar: 0,
          iso: key,
        };
        cur.entradas += d.entradas;
        cur.saidas += d.saidas;
        cur.aReceber += d.aReceber || 0;
        cur.aPagar += d.aPagar || 0;
        yearMap.set(key, cur);
      });

      let running = 0;
      aggregated = Array.from(yearMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, item]) => {
          running += item.entradas - item.saidas;
          return {
            date: item.label,
            iso: item.iso,
            entradas: item.entradas,
            saidas: item.saidas,
            aReceber: item.aReceber,
            aPagar: item.aPagar,
            saldo: running,
          };
        });
    } else {
      // Visão por Dia (Diária)
      aggregated = baseDailyData;
    }

    const volumes = aggregated.map((d) =>
      Math.max(Number(d.entradas) || 0, Number(d.saidas) || 0, Math.abs(Number(d.saldo) || 0)),
    );
    const computedMax = volumes.length > 0 ? Math.max(...volumes, 1000) : 1000;
    const maxVol = Number.isFinite(computedMax) && computedMax > 0 ? computedMax : 1000;

    return { chartData: aggregated, maxVolume: maxVol };
  }, [baseDailyData, activeGranularity]);

  const hasAReceber = Array.isArray(chartData) && chartData.some((d) => (d.aReceber || 0) > 0);

  // Título e subtítulo dinâmicos conforme a granularidade
  const titleText =
    activeGranularity === "anual"
      ? "Movimento anual"
      : activeGranularity === "mes"
        ? "Movimento mensal"
        : activeGranularity === "semana"
          ? "Movimento semanal"
          : "Movimento diário";

  const subtitleText =
    activeGranularity === "anual"
      ? "Entradas, saídas e resultado consolidado ano a ano."
      : activeGranularity === "mes"
        ? "Entradas, saídas e resultado consolidado mês a mês."
        : activeGranularity === "semana"
          ? "Entradas, saídas e resultado consolidado por semana."
          : "Entradas, saídas e resultado dia a dia no período.";

  const handleApplyCustomDates = () => {
    if (tempStart && tempEnd && onDateRangeChange) {
      onDateRangeChange(tempStart, tempEnd);
      setPopoverOpen(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
      {/* Cabeçalho do Card, Seletor de Granularidade e Legendas */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Título e Subtítulo */}
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-base font-semibold text-foreground">{titleText}</h2>
            {periodLabel && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                {periodLabel}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitleText}</p>
        </div>

        {/* Controles: Opções (Diária | Semanal | Mensal | Anual) + Filtro de Datas + Legenda */}
        <div className="flex items-center gap-3 flex-wrap self-start lg:self-auto">
          {/* SELETOR DE AGRUPAMENTO (DIÁRIA | SEMANAL | MENSAL | ANUAL) IDÊNTICO AO DO DASHBOARD */}
          <SegmentedControl
            size="sm"
            aria-label="Agrupamento do fluxo de caixa"
            value={activeGranularity}
            onChange={(g) => handleSelectGranularity(g as ChartGranularity)}
            options={[
              { value: "dia", label: "Diária" },
              { value: "semana", label: "Semanal" },
              { value: "mes", label: "Mensal" },
              { value: "anual", label: "Anual" },
            ]}
          />

          {/* FILTRO DE DATAS (POPOVER) */}
          {(onDateRangeChange || onSelectPeriodPreset) && (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-medium px-2.5 bg-card border-border shadow-2xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1.5"
                  title="Filtrar datas do período"
                >
                  <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                  <span>Filtrar Datas</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 space-y-3 bg-card border-border shadow-lg" align="end">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Período do Gráfico e Fluxo
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Escolha um atalho rápido ou defina o intervalo de datas.
                  </p>
                </div>

                {/* Atalhos Rápidos */}
                {onSelectPeriodPreset && (
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start cursor-pointer hover:bg-muted"
                      onClick={() => {
                        onSelectPeriodPreset("dia");
                        setPopoverOpen(false);
                      }}
                    >
                      Hoje (Dia)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start cursor-pointer hover:bg-muted"
                      onClick={() => {
                        onSelectPeriodPreset("semana");
                        setPopoverOpen(false);
                      }}
                    >
                      Esta Semana
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start cursor-pointer hover:bg-muted"
                      onClick={() => {
                        onSelectPeriodPreset("mes");
                        setPopoverOpen(false);
                      }}
                    >
                      Este Mês
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs justify-start cursor-pointer hover:bg-muted"
                      onClick={() => {
                        onSelectPeriodPreset("ano");
                        setPopoverOpen(false);
                      }}
                    >
                      Este Ano (Anual)
                    </Button>
                  </div>
                )}

                {/* Intervalo Personalizado */}
                {onDateRangeChange && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <span className="text-[11px] font-semibold text-foreground block">
                      Intervalo Personalizado
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">Data Início</label>
                        <input
                          type="date"
                          value={tempStart}
                          onChange={(e) => setTempStart(e.target.value)}
                          className="w-full text-xs p-1.5 rounded-md border border-border bg-background"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">Data Fim</label>
                        <input
                          type="date"
                          value={tempEnd}
                          onChange={(e) => setTempEnd(e.target.value)}
                          className="w-full text-xs p-1.5 rounded-md border border-border bg-background"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full h-7 text-xs bg-primary text-white hover:bg-primary-hover font-semibold mt-1 cursor-pointer"
                      onClick={handleApplyCustomDates}
                    >
                      Aplicar Filtro de Datas
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Área do Gráfico */}
      <div className="h-[280px] w-full pt-2">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Nenhum lançamento no período para exibição no gráfico.
          </div>
        ) : (
          <Chart
            type="line"
            height={280}
            summary="Entradas e saídas realizadas e previstas, com o saldo de cada período."
            series={[
              { name: "Entradas", type: "column", data: chartData.map((d) => d.entradas) },
              { name: "Entradas previstas", type: "column", data: chartData.map((d) => d.aReceber || 0) },
              { name: "Saídas", type: "column", data: chartData.map((d) => -Math.abs(d.saidas)) },
              { name: "Saídas previstas", type: "column", data: chartData.map((d) => -Math.abs(d.aPagar || 0)) },
              { name: "Saldo", type: "line", data: chartData.map((d) => d.entradas - d.saidas) },
              {
                name: "Saldo previsto",
                type: "line",
                data: chartData.map((d) => d.entradas + (d.aReceber || 0) - d.saidas - (d.aPagar || 0)),
              },
            ]}
            options={{
              chart: { stacked: true },
              colors: FLOW_COLORS,
              stroke: { width: [0, 0, 0, 0, 2, 2], curve: "straight", dashArray: [0, 0, 0, 0, 0, 5] },
              markers: {
                size: [0, 0, 0, 0, 5, 5],
                colors: [FLOW_COLORS[4], FLOW_COLORS[5]],
                strokeWidth: 0,
                hover: { size: 7 },
              },
              plotOptions: { bar: { columnWidth: "40%", borderRadius: 0 } },
              xaxis: { categories: chartData.map((d) => d.date) },
              yaxis: { labels: { formatter: compactValue } },
              annotations: { yaxis: [{ y: 0, borderColor: "var(--border)", strokeDashArray: 0 }] },
              legend: { show: false },
              tooltip: {
                shared: true,
                intersect: false,
                y: { formatter: (value) => fmtBRL(Math.abs(Number(value) || 0)) },
              },
            }}
          />
        )}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
        {[
          ["Entradas", FLOW_COLORS[0]],
          ["Entradas previstas", FLOW_COLORS[1]],
          ["Saídas", FLOW_COLORS[2]],
          ["Saídas previstas", FLOW_COLORS[3]],
        ].map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-5" style={{ background: FLOW_COLORS[4] }} />
          Saldo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: FLOW_COLORS[5] }} />
          Saldo previsto
        </span>
      </div>
    </div>
  );
}

export default GraficoFluxoDeCaixa;

const FLOW_COLORS = ["#22d061", "#aef0c4", "#ff3358", "#ffa3b3", "#3b82f6", "#9cc3fb"];
