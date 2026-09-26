import { lazy, Suspense, useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import type { ApexOptions } from "apexcharts";
import { useResolvedTheme } from "@/hooks/use-theme";
import { FONT_STACK } from "@/lib/fonts";
import type { ResolvedTheme } from "@/lib/theme";

const ReactApexChart = lazy(() => import("react-apexcharts"));
export const CHART_COLORS = {
  primary: "#6d3ff5",
  primarySoft: "#b39aff",
  secondary: "#2166c4",
  success: "#157347",
  warning: "#a15a07",
  danger: "#c7304d",
  neutral: "#8e8e93",
  ink: "#1d1d1f",
};
export const CHART_PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.danger,
  CHART_COLORS.primarySoft,
  CHART_COLORS.neutral,
];
// Equivalentes do modo escuro (mesmos valores dos tokens em .dark).
const DARK_EQUIVALENT: Record<string, string> = {
  [CHART_COLORS.primary]: "#8b6dff",
  [CHART_COLORS.primarySoft]: "#b8a6ff",
  [CHART_COLORS.secondary]: "#3d8bfd",
  [CHART_COLORS.success]: "#28a45e",
  [CHART_COLORS.warning]: "#d27a24",
  [CHART_COLORS.danger]: "#f25c5c",
  [CHART_COLORS.ink]: "#f5f5f7",
};
// Espelham --muted-foreground e --border-soft (Apex não lê variáveis CSS).
const AXIS_COLOR: Record<ResolvedTheme, string> = { light: "#636368", dark: "#a1a1a6" };
const GRID_COLOR: Record<ResolvedTheme, string> = { light: "#ececf0", dark: "#2b2b2f" };

/** Converte uma cor da paleta clara para o equivalente do tema atual. */
export function chartColor(color: string, mode: ResolvedTheme = "light"): string {
  if (mode === "light") return color;
  return DARK_EQUIVALENT[color.toLowerCase()] ?? color;
}

export const baseChartOptions = (
  overrides: ApexOptions = {},
  mode: ResolvedTheme = "light",
): ApexOptions => ({
  ...overrides,
  chart: {
    fontFamily: FONT_STACK,
    foreColor: AXIS_COLOR[mode],
    background: "transparent",
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: false },
    ...overrides.chart,
  },
  theme: { mode, ...overrides.theme },
  colors: (overrides.colors ?? CHART_PALETTE).map((color) =>
    typeof color === "string" ? chartColor(color, mode) : color,
  ),
  grid: {
    borderColor: GRID_COLOR[mode],
    strokeDashArray: 4,
    padding: { top: 0, right: 8, bottom: 0, left: 8 },
    xaxis: { lines: { show: false } },
    ...overrides.grid,
  },
  dataLabels: { enabled: false, ...overrides.dataLabels },
  legend: {
    position: "top",
    horizontalAlign: "right",
    fontSize: "12px",
    fontWeight: 400,
    markers: { size: 5, strokeWidth: 0 },
    itemMargin: { horizontal: 10, vertical: 5 },
    labels: { colors: AXIS_COLOR[mode] },
    ...overrides.legend,
  },
  stroke: { curve: "straight", width: 2, ...overrides.stroke },
  tooltip: {
    theme: mode,
    style: { fontSize: "13px", fontFamily: FONT_STACK },
    ...overrides.tooltip,
  },
  xaxis: {
    axisBorder: { show: false },
    axisTicks: { show: false },
    ...overrides.xaxis,
    labels: {
      style: { colors: AXIS_COLOR[mode], fontSize: "12px", fontWeight: 400 },
      ...overrides.xaxis?.labels,
    },
  },
  yaxis: Array.isArray(overrides.yaxis)
    ? overrides.yaxis
    : {
        ...overrides.yaxis,
        labels: {
          style: { colors: AXIS_COLOR[mode], fontSize: "12px", fontWeight: 400 },
          ...overrides.yaxis?.labels,
        },
      },
});

interface ChartProps {
  type: "line" | "area" | "bar" | "donut" | "pie" | "radialBar" | "heatmap" | "scatter";
  series: ApexOptions["series"];
  options?: ApexOptions;
  height?: number | string;
  width?: number | string;
  className?: string;
  /** Resumo em uma frase para leitores de tela (gráficos não são lidos). */
  summary?: string;
}

export function Chart({
  type,
  series,
  options,
  height = 300,
  width = "100%",
  className,
  summary,
}: ChartProps) {
  const reduce = useReducedMotion();
  const mode = useResolvedTheme();
  const merged = useMemo(() => {
    const base = baseChartOptions(options, mode);
    return reduce ? { ...base, chart: { ...base.chart, animations: { enabled: false } } } : base;
  }, [options, reduce, mode]);
  return (
    <div className={className} role={summary ? "img" : undefined} aria-label={summary}>
      <Suspense
        fallback={
          <div
            role="status"
            aria-label="Carregando gráfico"
            style={{ height }}
            className="mc-skeleton rounded-xl"
          />
        }
      >
        <ReactApexChart
          key={mode}
          type={type}
          series={series}
          options={merged}
          height={height}
          width={width}
        />
      </Suspense>
    </div>
  );
}
