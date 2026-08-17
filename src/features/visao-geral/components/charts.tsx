import { Chart } from "@/components/ds";
import { DashCard, CardTitle, EmptyHint } from "./cards";

const AXIS = { colors: "#9CA3AF", fontSize: "11.5px", fontWeight: 600 };

export function GaugeCard({
  title,
  value,
  label = "Agendamentos",
  color = "#6EE7B7",
  delay = 0,
}: {
  title: string;
  value: number;
  label?: string;
  color?: string;
  delay?: number;
}) {
  return (
    <DashCard delay={delay}>
      <CardTitle>{title}</CardTitle>
      <div className="flex items-center justify-center">
        <Chart
          type="radialBar"
          height={190}
          series={[Math.min(100, value * 20)]}
          options={{
            colors: [color],
            plotOptions: {
              radialBar: {
                hollow: { size: "70%" },
                track: { background: "#F1F3F9", strokeWidth: "100%" },
                dataLabels: {
                  name: {
                    offsetY: 18,
                    color: "#9CA3AF",
                    fontSize: "11.5px",
                    fontWeight: 500,
                  },
                  value: {
                    offsetY: -12,
                    color: "#111827",
                    fontSize: "24px",
                    fontWeight: 600,
                    formatter: () => String(value),
                  },
                },
              },
            },
            stroke: { lineCap: "round" },
            labels: [label],
          }}
        />
      </div>
    </DashCard>
  );
}

export function AppointmentsChart({
  categories,
  data,
  average,
  delay = 0,
}: {
  categories: string[];
  data: number[];
  average: number;
  delay?: number;
}) {
  return (
    <Chart
      type="line"
      height={240}
      series={[
        { name: "Agendamentos", type: "column", data },
        { name: "Média", type: "line", data: categories.map(() => average) },
      ]}
      options={{
        colors: ["#86EFAC", "#4F8EF7"],
        plotOptions: { bar: { columnWidth: "28%", borderRadius: 3 } },
        stroke: { width: [0, 2], curve: "straight", dashArray: [0, 0] },
        markers: { size: 0 },
        legend: { position: "bottom", horizontalAlign: "center", fontSize: "12.5px" },
        grid: { borderColor: "#F1F3F9", strokeDashArray: 0 },
        xaxis: { categories, labels: { style: AXIS } },
        yaxis: [
          { labels: { style: AXIS }, tickAmount: 4 },
          { opposite: true, labels: { style: AXIS }, tickAmount: 4, show: true },
        ],
        tooltip: { shared: true, intersect: false },
      }}
      key={categories.join("-")}
    />
  );
}

export function MiniBarsCard({
  title,
  items,
  delay = 0,
}: {
  title: string;
  items: { label: string; value: number; pct: number }[];
  delay?: number;
}) {
  return (
    <DashCard delay={delay}>
      <CardTitle>{title}</CardTitle>
      <button className="-mt-2 mb-2 block text-[14px] font-semibold text-[#7C5CFA] hover:underline">
        ver mais
      </button>
      {items.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="space-y-2.5">
          {items.map((it) => (
            <li key={it.label} className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#F5F3FF] text-[11.5px] font-bold text-[#7C5CFA]">
                {it.label.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold leading-[1.35] tracking-[-0.01em] text-[#1B2A4A]">
                  {it.label}
                </p>
                <p className="text-[13.5px] font-semibold text-[#6B7280]">{it.value}</p>
              </div>
              <span className="shrink-0 text-[13.5px] font-bold text-[#6B7280]">{it.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}

export function BusiestDaysChart({ data }: { data: number[] }) {
  return (
    <Chart
      type="bar"
      height={200}
      series={[{ name: "Agendamentos", data }]}
      options={{
        colors: ["#8B5CF6"],
        plotOptions: { bar: { columnWidth: "40%", borderRadius: 3 } },
        dataLabels: {
          enabled: true,
          style: { fontSize: "11.5px", colors: ["#6B7280"] },
          offsetY: -16,
        },
        grid: { borderColor: "#F1F3F9" },
        xaxis: { categories: ["D", "S", "T", "Q", "Q", "S", "S"], labels: { style: AXIS } },
        yaxis: { labels: { style: AXIS } },
      }}
    />
  );
}

export function DiscreteBarsChart({ data }: { data: number[] }) {
  return (
    <Chart
      type="bar"
      height={200}
      series={[{ name: "Volume", data }]}
      options={{
        colors: ["#C7CBD9"],
        plotOptions: { bar: { columnWidth: "45%", borderRadius: 2 } },
        grid: { borderColor: "#F1F3F9" },
        xaxis: { categories: data.map((_, i) => String(i + 1)), labels: { show: false } },
        yaxis: { labels: { style: AXIS } },
      }}
    />
  );
}

export function HeatmapChart({
  series,
}: {
  series: { name: string; data: { x: string; y: number }[] }[];
}) {
  return (
    <Chart
      type="heatmap"
      height={220}
      series={series}
      options={{
        colors: ["#8B5CF6"],
        plotOptions: {
          heatmap: {
            radius: 3,
            enableShades: true,
            shadeIntensity: 0.6,
            useFillColorAsStroke: false,
          },
        },
        stroke: { width: 3, colors: ["#FFFFFF"] },
        legend: { show: false },
        grid: { borderColor: "transparent" },
        xaxis: { type: "category", labels: { style: AXIS }, tooltip: { enabled: false } },
        yaxis: { labels: { style: AXIS } },
      }}
    />
  );
}
