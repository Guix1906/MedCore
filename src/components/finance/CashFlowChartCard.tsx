import type { ApexOptions } from "apexcharts";
import { CircleHelp } from "lucide-react";
import { Chart } from "@/components/ds/Chart";
import { useMemo, useState } from "react";
import { calcCashFlow, projectOverdueToToday } from "@/lib/finance";
import { CashFlowDetailsDialog } from "./CashFlowDetailsDialog";

/**
 * Gráfico "Fluxo de caixa" usado no Dashboard e no Financeiro → Fluxo de caixa.
 * Colunas empilhadas: Entradas + Entradas previstas (para cima), Saídas + Saídas previstas
 * (para baixo); linhas: Saldo (realizado) e Saldo previsto do período.
 *
 * `rows` vem de reportingRows(): pagamentos (status "pago", na data do pagamento) e o saldo
 * em aberto de cada título (status "pendente", no vencimento).
 */

export type CashFlowPeriod = "day" | "week" | "month" | "year";

export interface CashFlowRow {
  id: string;
  type: string;
  amount: number;
  date: string;
  status: string;
  due_date?: string | null;
  description?: string | null;
  category?: string | null;
  person?: string | null;
  method?: string | null;
}

export const FLOW_COLORS = ["#22d061", "#aef0c4", "#ff3358", "#ffa3b3", "#3b82f6", "#9cc3fb"];

const PERIODS: [CashFlowPeriod, string][] = [
  ["day", "Diária"],
  ["week", "Semanal"],
  ["month", "Mensal"],
  ["year", "Anual"],
];

// Janela fixa por agrupamento: 5 últimos dias, semana vigente, 2 últimos meses, ano vigente.
const RECENT_LIMIT: Record<CashFlowPeriod, number> = { day: 5, week: 1, month: 2, year: 1 };

const BRL =(v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function CashFlowChartCard({
  rows,
  range,
  period,
  onPeriodChange,
  loading,
  error,
  onRetry,
  hideValues,
  className = "",
}: {
  rows: CashFlowRow[];
  range: [Date, Date];
  period: CashFlowPeriod;
  onPeriodChange: (p: CashFlowPeriod) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  hideValues?: boolean;
  className?: string;
}) {
  const mapped = projectOverdueToToday(
    rows.map((t) => ({ ...t, status: t.status === "concluido" ? "pago" : t.status })),
  );
  const buckets = calcCashFlow(
    mapped as unknown as Parameters<typeof calcCashFlow>[0],
    period,
    RECENT_LIMIT[period],
  );
  const [detail, setDetail] = useState<{ series: number; index: number } | null>(null);
  const detailRows = useMemo(() => {
    if (!detail) return [];
    const key = buckets[detail.index]?.date;
    if (!key) return [];
    return mapped.filter((r) => {
      if (r.status === "cancelado" || bucketKey(r.date, period) !== key) return false;
      const income = r.type === "receita" || r.type === "income";
      const paid = r.status === "pago";
      const open = r.status === "pendente" || r.status === "vencido";
      switch (detail.series) {
        case 0: return income && paid;
        case 1: return income && open;
        case 2: return !income && paid;
        case 3: return !income && open;
        default: return paid || open;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, rows, period]);
  const detailTitle = detail
    ? `${SERIES_TITLE[detail.series] ?? "Lançamentos"} - ${bucketTitle(buckets[detail.index]?.date ?? "", period)}`
    : "";

  const flowRows = buckets.map((d) => ({
    label: d.label,
    entradas: d.entradas,
    entradasPrev: d.entradasPrev,
    saidas: d.saidas,
    saidasPrev: d.saidasPrev,
    saldo: d.entradas - d.saidas,
    saldoPrev: d.entradas + d.entradasPrev - (d.saidas + d.saidasPrev),
  }));
  const axis = niceAxis(
    Math.max(0, ...flowRows.map((r) => Math.max(r.entradas + r.entradasPrev, r.saldo, r.saldoPrev))),
    Math.min(0, ...flowRows.map((r) => Math.min(-(r.saidas + r.saidasPrev), r.saldo, r.saldoPrev))),
  );
  const series = [
    { name: "Entradas", type: "column", data: flowRows.map((r) => r.entradas) },
    { name: "Entradas previstas", type: "column", data: flowRows.map((r) => r.entradasPrev) },
    { name: "Saídas", type: "column", data: flowRows.map((r) => -r.saidas) },
    { name: "Saídas previstas", type: "column", data: flowRows.map((r) => -r.saidasPrev) },
    { name: "Saldo", type: "line", data: flowRows.map((r) => r.saldo) },
    { name: "Saldo previsto", type: "line", data: flowRows.map((r) => r.saldoPrev) },
  ];

  return (
    <div className={`rounded-2xl bg-card p-5 shadow-xs ${className}`}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
          Fluxo de caixa
          <span
            title="Entradas e saídas realizadas e previstas por período."
            aria-label="Entradas e saídas realizadas e previstas por período."
            role="img"
            className="inline-flex cursor-help text-muted-foreground"
          >
            <CircleHelp size={15} />
          </span>
        </h2>
        <div className="flex items-center gap-5" role="tablist" aria-label="Agrupamento do fluxo de caixa">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={period === key}
              onClick={() => onPeriodChange(key)}
              className={`-mt-1 cursor-pointer border-t-2 pt-1 text-sm font-semibold transition-colors ${
                period === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          Financeiro indisponível: {error}{" "}
          {onRetry && (
            <button onClick={onRetry} className="font-medium underline">
              Tentar novamente
            </button>
          )}
        </div>
      ) : (
        <div className="h-[300px]" key={period}>
          {loading ? (
            <div className="mc-skeleton h-full w-full rounded-xl" />
          ) : (
            <Chart
              key={`${period}-${flowRows.map((r) => r.label).join()}`}
              type="line"
              height={300}
              summary="Fluxo de caixa: entradas, saídas, previstos e saldo por período."
              series={series as NonNullable<ApexOptions["series"]>}
              options={{
                chart: {
                  type: "line",
                  stacked: true,
                  events: {
                    click: (_e, _ctx, cfg) => {
                      if (!cfg || cfg.dataPointIndex == null || cfg.dataPointIndex < 0) return;
                      setDetail({ series: cfg.seriesIndex, index: cfg.dataPointIndex });
                    },
                  },
                },
                states: { active: { filter: { type: "none" } } },
                colors: FLOW_COLORS,
                stroke: { width: [0, 0, 0, 0, 2, 2], curve: "straight", dashArray: [0, 0, 0, 0, 0, 5] },
                markers: {
                  size: [0, 0, 0, 0, 5, 5],
                  colors: [FLOW_COLORS[4], FLOW_COLORS[5]],
                  strokeWidth: 0,
                  hover: { size: 7 },
                },
                plotOptions: { bar: { columnWidth: "40%", borderRadius: 0 } },
                dataLabels: { enabled: false },
                grid: { strokeDashArray: 0, padding: { left: 10, right: 10 } },
                xaxis: { categories: flowRows.map((r) => r.label) },
                yaxis: {
                  min: axis.min,
                  max: axis.max,
                  tickAmount: axis.ticks,
                  forceNiceScale: false,
                  labels: { formatter: shortBRL },
                },
                annotations: { yaxis: [{ y: 0, borderColor: "var(--border)", strokeDashArray: 0 }] },
                legend: { show: false },
                tooltip: {
                  shared: true,
                  intersect: false,
                  y: { formatter: (v: number) => (hideValues ? "R$ ••••••" : BRL(Math.abs(v))) },
                },
              }}
            />
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {(
          [
            ["Entradas", FLOW_COLORS[0]],
            ["Entradas previstas", FLOW_COLORS[1]],
            ["Saídas", FLOW_COLORS[2]],
            ["Saídas previstas", FLOW_COLORS[3]],
          ] as const
        ).map(([label, color]) => (
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

      <CashFlowDetailsDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        title={detailTitle}
        rows={detailRows}
        hideValues={hideValues}
      />
    </div>
  );
}

const SERIES_TITLE: Record<number, string> = {
  0: "Entradas",
  1: "Entradas previstas",
  2: "Saídas",
  3: "Saídas previstas",
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Mesma chave de agrupamento usada por calcCashFlow. */
function bucketKey(raw: string, period: CashFlowPeriod) {
  const day = String(raw || "").slice(0, 10);
  if (period === "day") return day;
  if (period === "week") {
    const dt = new Date(day + "T12:00:00");
    dt.setDate(dt.getDate() - dt.getDay());
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  if (period === "month") return day.slice(0, 7);
  return day.slice(0, 4);
}

function bucketTitle(key: string, period: CashFlowPeriod) {
  const [y, m, d] = key.split("-").map(Number);
  if (period === "year") return String(y);
  if (period === "month") return `${MONTHS[m - 1]} de ${y}`;
  if (period === "day") return `${String(d).padStart(2, "0")} de ${MONTHS[m - 1].toLowerCase()} de ${y}`;
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const f = (x: Date) => `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
  return `Semana de ${f(start)} a ${f(end)}`;
}

function niceAxis(max: number, min: number) {
  const span = Math.max(max - min, 1);
  const rough = span / 6;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const top = max > 0 ? Math.ceil((max * 1.1) / step) * step : step;
  const bottom = min < 0 ? Math.floor((min * 1.1) / step) * step : 0;
  return { min: bottom, max: top, ticks: Math.round((top - bottom) / step) };
}

function shortBRL(v: number) {
  if (v === 0) return "R$ 0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000)
    return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (abs >= 1000)
    return `${sign}R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return `${sign}R$ ${Math.round(abs)}`;
}
