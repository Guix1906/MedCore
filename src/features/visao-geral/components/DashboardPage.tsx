import { useMemo, useState } from "react";
import { CalendarCheck, Clock3, Users } from "lucide-react";

import { HeaderFilters } from "./HeaderFilters";
import { DashCard, CardTitle, KpiCard, EmptyHint } from "./cards";
import {
  AppointmentsChart,
  BusiestDaysChart,
  DiscreteBarsChart,
  GaugeCard,
  HeatmapChart,
  MiniBarsCard,
} from "./charts";
import { StatusCard, type StatusRow } from "./StatusCard";

const TABS = ["Diária", "Semanal", "Mensal", "Anual"] as const;
type Tab = (typeof TABS)[number];

const SERIES: Record<Tab, { categories: string[]; data: number[] }> = {
  Diária: {
    categories: ["26/Jul", "27/Jul", "28/Jul", "29/Jul", "30/Jul", "31/Jul", "1/Ago"],
    data: [1, 0, 4, 0, 0, 0, 0],
  },
  Semanal: {
    categories: ["S1", "S2", "S3", "S4", "S5"],
    data: [2, 5, 3, 4, 1],
  },
  Mensal: {
    categories: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul"],
    data: [3, 6, 4, 8, 5, 7, 5],
  },
  Anual: {
    categories: ["2023", "2024", "2025", "2026"],
    data: [24, 42, 38, 5],
  },
};

const STATUS_ROWS: StatusRow[] = [
  { key: "agendado", label: "Agendado", count: 1, pct: 20 },
  { key: "reservado", label: "Reservado", count: 0, pct: 0 },
  { key: "confirmado", label: "Confirmado", count: 0, pct: 0 },
  { key: "nao_compareceu", label: "Não compareceu", count: 1, pct: 20 },
  { key: "concluido", label: "Concluído", count: 2, pct: 40 },
  { key: "cancelado", label: "Cancelado", count: 1, pct: 20 },
];

const HOURS = ["09h", "10h", "11h", "12h", "13h", "14h", "15h", "16h", "17h"];

export function DashboardPage() {
  const [tab, setTab] = useState<Tab>("Diária");
  const current = SERIES[tab];
  const average = useMemo(
    () => Number((current.data.reduce((a, b) => a + b, 0) / current.data.length).toFixed(2)),
    [current],
  );

  const heatmap = useMemo(
    () =>
      HOURS.map((h, hi) => ({
        name: h,
        data: ["D", "S", "T", "Q", "Q", "S", "S"].map((d, di) => ({
          x: d,
          y: (hi * 3 + di * 5) % 7 === 0 ? 3 : (hi + di) % 4 === 0 ? 2 : 0,
        })),
      })).reverse(),
    [],
  );

  return (
    <div className="min-h-full bg-[#F7F8FC] p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <HeaderFilters period="26/07/2026 – 01/08/2026" />

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard title="Total de agendamentos" value={5} icon={CalendarCheck} delay={0.02} />
          <KpiCard title="Ociosidade" value={91} suffix="%" trend={9} icon={Clock3} delay={0.06} />
          <KpiCard title="Pacientes na lista de espera" value={0} icon={Users} delay={0.1} />
        </div>

        {/* Gauges */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GaugeCard title="Agendamentos por convênio" value={5} delay={0.12} />
          <GaugeCard title="Conversão por canal" value={5} delay={0.16} />
        </div>

        {/* Período + status */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DashCard className="lg:col-span-2" delay={0.18}>
            <div className="mb-2 flex items-center justify-between gap-4">
              <CardTitle>Agendamentos por período</CardTitle>
              <div className="-mt-3 flex items-center gap-3">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={
                      t === tab
                        ? "border-b-2 border-[#7C5CFA] pb-0.5 text-[14.5px] font-bold text-[#7C5CFA]"
                        : "pb-0.5 text-[14.5px] font-semibold text-[#6B7280] hover:text-[#111827]"
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <AppointmentsChart
              categories={current.categories}
              data={current.data}
              average={average}
            />
          </DashCard>
          <StatusCard rows={STATUS_ROWS} delay={0.2} />
        </div>

        {/* Mini métricas */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MiniBarsCard
            title="Pacientes mais frequentes"
            items={[{ label: "Clara Ribeiro (Paciente)", value: 5, pct: 100 }]}
            delay={0.22}
          />
          <DashCard delay={0.24}>
            <CardTitle>Ociosidade por sala</CardTitle>
            <button className="-mt-2 mb-1 block text-[14.5px] font-semibold text-[#7C5CFA] hover:underline">
              ver mais
            </button>
            <EmptyHint />
          </DashCard>
          <DashCard delay={0.26}>
            <CardTitle>Ociosidade por profissional</CardTitle>
            <button className="-mt-2 mb-1 block text-[14.5px] font-semibold text-[#7C5CFA] hover:underline">
              ver mais
            </button>
            <EmptyHint />
          </DashCard>
          <MiniBarsCard
            title="Procedimentos mais frequentes"
            items={[{ label: "Atendimento", value: 1, pct: 100 }]}
            delay={0.28}
          />
        </div>

        {/* Linha final */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DashCard delay={0.3}>
            <CardTitle>Distribuição geral</CardTitle>
            <DiscreteBarsChart data={[2, 1, 4, 1, 3, 1, 2]} />
          </DashCard>
          <DashCard delay={0.32}>
            <CardTitle>Dias mais movimentados</CardTitle>
            <BusiestDaysChart data={[1, 0, 5, 0, 1, 0, 1]} />
          </DashCard>
          <DashCard delay={0.34}>
            <CardTitle>Horários mais movimentados</CardTitle>
            <HeatmapChart series={heatmap} />
          </DashCard>
        </div>
      </div>
    </div>
  );
}
