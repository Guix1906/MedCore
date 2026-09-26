import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Chart, CHART_COLORS } from "@/components/ds/Chart";

// ============================================================================
// Tipagens
// ============================================================================
export interface LancamentoFluxo {
  id: string;
  amount: number;
  paid_amount?: number | null;
  entry_type: "receita" | "despesa";
  status: "pago" | "pendente" | "cancelado";
  paid_at?: string | null;
  due_date?: string | null;
}

export interface DayChartPoint {
  date: string; // "dd/MM/yyyy"
  entradas: number; // Total recebido no dia
  saidas: number; // Total pago no dia
  saldo: number; // Saldo acumulado até o dia
}

export interface GraficoFluxoDeCaixaProps {
  entries?: LancamentoFluxo[];
  // Caso já queira passar os dados agrupados diretamente:
  customChartData?: DayChartPoint[];
}

// ============================================================================
// Formatadores
// ============================================================================
const fmtBRL = (val: number): string =>
  val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const compactValue = (val: number) =>
  Math.abs(val) >= 1000 ? `${Math.round(val / 1000)}k` : String(Math.round(val));

// ============================================================================
// Componente Principal do Gráfico
// ============================================================================
export function GraficoFluxoDeCaixa({ entries = [], customChartData }: GraficoFluxoDeCaixaProps) {
  // Processamento e agrupamento dos lançamentos por dia (quando não passado direto)
  const { chartData, maxVolume } = useMemo(() => {
    if (customChartData && customChartData.length > 0) {
      const maxVol = Math.max(
        ...customChartData.map((d) => Math.max(d.entradas, d.saidas, Math.abs(d.saldo))),
        1000,
      );
      return { chartData: customChartData, maxVolume: maxVol };
    }

    // REGRA DO FLUXO DE CAIXA: Apenas lançamentos realizados (pagos)
    const realizadados = entries.filter((e) => e.status === "pago" && (e.paid_at || e.due_date));

    // Ordenação cronológica
    const ordenados = [...realizadados].sort((a, b) => {
      const da = a.paid_at || a.due_date || "";
      const db = b.paid_at || b.due_date || "";
      return da.localeCompare(db);
    });

    const dayMap = new Map<string, { entradas: number; saidas: number }>();

    ordenados.forEach((e) => {
      const dStr = (e.paid_at || e.due_date || "").slice(0, 10);
      if (!dStr) return;

      let label = dStr;
      try {
        label = format(parseISO(dStr), "dd/MM/yyyy");
      } catch {
        label = dStr;
      }

      const current = dayMap.get(label) || { entradas: 0, saidas: 0 };
      const valor = Number(e.paid_amount ?? e.amount ?? 0);

      if (e.entry_type === "receita") {
        current.entradas += valor;
      } else if (e.entry_type === "despesa") {
        current.saidas += valor;
      }

      dayMap.set(label, current);
    });

    let runningSaldo = 0;
    const days: DayChartPoint[] = Array.from(dayMap.entries()).map(([date, vals]) => {
      runningSaldo += vals.entradas - vals.saidas;
      return {
        date,
        entradas: vals.entradas,
        saidas: vals.saidas,
        saldo: runningSaldo,
      };
    });

    const maxVol =
      days.length > 0
        ? Math.max(...days.map((d) => Math.max(d.entradas, d.saidas, Math.abs(d.saldo))), 1000)
        : 1000;

    return { chartData: days, maxVolume: maxVol };
  }, [entries, customChartData]);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
      {/* Cabeçalho do Card e Legendas */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">Movimento por dia</h2>
          <p className="text-xs text-muted-foreground">
            Entradas, saídas e resultado acumulado dentro do período selecionado.
          </p>
        </div>

        {/* Legenda com Pills */}
        <div className="flex items-center gap-3 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            <span className="text-muted-foreground">Entradas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
            <span className="text-muted-foreground">Saídas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-4 rounded-full bg-info" />
            <span className="text-muted-foreground">Saldo</span>
          </div>
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
            summary="Entradas e saídas por dia, com o resultado acumulado no período."
            series={[
              { name: "Entradas", type: "column", data: chartData.map((d) => d.entradas) },
              { name: "Saídas", type: "column", data: chartData.map((d) => d.saidas) },
              { name: "Resultado acumulado", type: "line", data: chartData.map((d) => d.saldo) },
            ]}
            options={{
              colors: [CHART_COLORS.success, CHART_COLORS.danger, CHART_COLORS.secondary],
              stroke: { width: [0, 0, 2.5], curve: "smooth" },
              markers: { size: [0, 0, 3], strokeWidth: 0, hover: { size: 5 } },
              plotOptions: {
                bar: { columnWidth: "40%", borderRadius: 3, borderRadiusApplication: "end" },
              },
              xaxis: { categories: chartData.map((d) => d.date) },
              yaxis: [
                { seriesName: "Entradas", labels: { formatter: compactValue } },
                { seriesName: "Entradas", show: false },
                {
                  seriesName: "Resultado acumulado",
                  opposite: true,
                  labels: { formatter: compactValue },
                },
              ],
              annotations: {
                yaxis: [
                  {
                    y: maxVolume,
                    yAxisIndex: 0,
                    borderColor: CHART_COLORS.neutral,
                    strokeDashArray: 3,
                    opacity: 0.6,
                  },
                ],
              },
              legend: { show: false },
              tooltip: {
                shared: true,
                intersect: false,
                y: { formatter: (value) => fmtBRL(Number(value) || 0) },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}

export default GraficoFluxoDeCaixa;
