import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";

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

// ============================================================================
// Componente Principal do Gráfico
// ============================================================================
export function GraficoFluxoDeCaixa({
  entries = [],
  customChartData,
}: GraficoFluxoDeCaixaProps) {
  // Processamento e agrupamento dos lançamentos por dia (quando não passado direto)
  const { chartData, maxVolume } = useMemo(() => {
    if (customChartData && customChartData.length > 0) {
      const maxVol = Math.max(
        ...customChartData.map((d) =>
          Math.max(d.entradas, d.saidas, Math.abs(d.saldo))
        ),
        1000
      );
      return { chartData: customChartData, maxVolume: maxVol };
    }

    // REGRA DO FLUXO DE CAIXA: Apenas lançamentos realizados (pagos)
    const realizadados = entries.filter(
      (e) => e.status === "pago" && (e.paid_at || e.due_date)
    );

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
    const days: DayChartPoint[] = Array.from(dayMap.entries()).map(
      ([date, vals]) => {
        runningSaldo += vals.entradas - vals.saidas;
        return {
          date,
          entradas: vals.entradas,
          saidas: vals.saidas,
          saldo: runningSaldo,
        };
      }
    );

    const maxVol =
      days.length > 0
        ? Math.max(
            ...days.map((d) =>
              Math.max(d.entradas, d.saidas, Math.abs(d.saldo))
            ),
            1000
          )
        : 1000;

    return { chartData: days, maxVolume: maxVol };
  }, [entries, customChartData]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
      {/* Cabeçalho do Card e Legendas */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Movimento por dia
          </h2>
          <p className="text-xs text-slate-500">
            Entradas, saídas e resultado acumulado dentro do período selecionado.
          </p>
        </div>

        {/* Legenda com Pills */}
        <div className="flex items-center gap-3 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-slate-600">Entradas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            <span className="text-slate-600">Saídas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-4 rounded-full bg-blue-600" />
            <span className="text-slate-600">Saldo</span>
          </div>
        </div>
      </div>

      {/* Área do Gráfico */}
      <div className="h-[280px] w-full pt-2">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            Nenhum lançamento no período para exibição no gráfico.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280} minWidth={0} debounce={50}>
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#E2E8F0"
                opacity={0.6}
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#64748B" }}
              />
              {/* Eixo Y da Esquerda: Volume de Entradas e Saídas */}
              <YAxis
                yAxisId="volume"
                orientation="left"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(val) =>
                  val >= 1000 ? `${Math.round(val / 1000)}k` : String(val)
                }
              />
              {/* Eixo Y da Direita: Saldo Acumulado */}
              <YAxis
                yAxisId="saldo"
                orientation="right"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(val) =>
                  val >= 1000 ? `${Math.round(val / 1000)}k` : String(val)
                }
              />

              {/* Tooltip Personalizado */}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const entradas =
                      (payload.find((p) => p.dataKey === "entradas")
                        ?.value as number) || 0;
                    const saidas =
                      (payload.find((p) => p.dataKey === "saidas")
                        ?.value as number) || 0;
                    const saldo =
                      (payload.find((p) => p.dataKey === "saldo")
                        ?.value as number) || 0;

                    return (
                      <div className="rounded-xl border border-slate-200 bg-white/95 backdrop-blur px-3.5 py-2.5 shadow-lg text-xs space-y-1.5 min-w-[190px]">
                        <p className="font-semibold text-slate-800 border-b pb-1">
                          Dia {label}
                        </p>
                        <div className="flex items-center justify-between gap-4 text-emerald-600 font-medium">
                          <span>Entradas:</span>
                          <span>{fmtBRL(entradas)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-rose-600 font-medium">
                          <span>Saídas:</span>
                          <span>{fmtBRL(saidas)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-blue-600 font-bold pt-1 border-t border-slate-100">
                          <span>Resultado acumulado:</span>
                          <span>{fmtBRL(saldo)}</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />

              {/* Barras Verdes: Entradas */}
              <Bar
                yAxisId="volume"
                dataKey="entradas"
                fill="#10B981"
                radius={[3, 3, 0, 0]}
                maxBarSize={10}
                isAnimationActive={true}
                animationDuration={500}
              />

              {/* Barras Vermelhas: Saídas */}
              <Bar
                yAxisId="volume"
                dataKey="saidas"
                fill="#EF4444"
                radius={[3, 3, 0, 0]}
                maxBarSize={10}
                isAnimationActive={true}
                animationDuration={500}
              />

              {/* Linha Azul: Saldo Acumulado */}
              <Line
                yAxisId="saldo"
                type="monotone"
                dataKey="saldo"
                stroke="#2563EB"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#2563EB" }}
                activeDot={{ r: 5 }}
                isAnimationActive={true}
                animationDuration={700}
              />

              {/* Linha de Referência do Teto */}
              <ReferenceLine
                yAxisId="volume"
                y={maxVolume}
                stroke="#CBD5E1"
                strokeDasharray="3 3"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default GraficoFluxoDeCaixa;
