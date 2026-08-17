import { lazy, Suspense, useMemo } from "react";
import type { ApexOptions } from "apexcharts";

// ApexCharts é pesado — carregado sob demanda
const ReactApexChart = lazy(() => import("react-apexcharts"));

/** Paleta do MedCore para gráficos — consistente em todo o sistema. */
export const CHART_COLORS = {
  primary: "#6d3ff5",
  primarySoft: "#b39aff",
  secondary: "#2986ff",
  success: "#16b364",
  warning: "#f59e0b",
  danger: "#ef3e5c",
  neutral: "#94a3b8",
  ink: "#0f1424",
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

/** Opções-base compartilhadas — visual limpo, tipografia Inter, sem grid pesado. */
export const baseChartOptions = (overrides: ApexOptions = {}): ApexOptions => ({
  chart: {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: {
      enabled: true,
      speed: 500,
      animateGradually: { enabled: true, delay: 60 },
      dynamicAnimation: { enabled: true, speed: 350 },
    },
    ...overrides.chart,
  },
  colors: overrides.colors ?? CHART_PALETTE,
  grid: {
    borderColor: "#eaecf0",
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
    fontWeight: 500,
    markers: { size: 6, strokeWidth: 0 },
    itemMargin: { horizontal: 12, vertical: 4 },
    ...overrides.legend,
  },
  stroke: { curve: "smooth", width: 2, ...overrides.stroke },
  tooltip: {
    theme: "light",
    style: { fontSize: "12px", fontFamily: "Inter" },
    ...overrides.tooltip,
  },
  xaxis: {
    labels: {
      style: { colors: "#5a6178", fontSize: "11px", fontWeight: 500 },
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
    ...overrides.xaxis,
  },
  yaxis: {
    labels: {
      style: { colors: "#5a6178", fontSize: "11px", fontWeight: 500 },
    },
    ...overrides.yaxis,
  },
  ...overrides,
});

interface ChartProps {
  type: "line" | "area" | "bar" | "donut" | "pie" | "radialBar" | "heatmap" | "scatter";
  series: ApexOptions["series"] | number[];
  options?: ApexOptions;
  height?: number | string;
  width?: number | string;
  className?: string;
}

/**
 * Chart — wrapper premium do ApexCharts com defaults MedCore aplicados.
 * Uso: <Chart type="area" series={[...]} height={280} />
 */
export function Chart({
  type,
  series,
  options,
  height = 300,
  width = "100%",
  className,
}: ChartProps) {
  const merged = useMemo(() => baseChartOptions(options), [options]);
  return (
    <div className={className}>
      <Suspense fallback={<div style={{ height }} className="mc-skeleton rounded-xl" />}>
        <ReactApexChart
          type={type}
          series={series as ApexOptions["series"]}
          options={merged}
          height={height}
          width={width}
        />
      </Suspense>
    </div>
  );
}
