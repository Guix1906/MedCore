import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import AppShell from "@/components/AppShell";
import AgendaSidebar, {
  EMPTY_AGENDA_FILTERS,
  type AgendaFilterValues,
} from "@/components/agenda/AgendaSidebar";
import { DashboardPage } from "@/features/visao-geral/components/DashboardPage";

export const Route = createFileRoute("/_authenticated/visao-geral")({
  head: () => ({
    meta: [
      { title: "Visão Geral • MedCore" },
      {
        name: "description",
        content:
          "Painel de visão geral dos agendamentos da clínica: KPIs, conversão, status e horários mais movimentados.",
      },
      { property: "og:title", content: "Visão Geral • MedCore" },
      {
        property: "og:description",
        content: "KPIs, conversão, status e horários mais movimentados da clínica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VisaoGeralRoute,
});

function VisaoGeralRoute() {
  const [date, setDate] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<AgendaFilterValues>(EMPTY_AGENDA_FILTERS);

  return (
    <AppShell title="Visão Geral">
      <div className="flex w-full items-stretch bg-[#F7F8FC]">
        <div className="sticky top-0 hidden max-h-screen self-start lg:block">
          <AgendaSidebar
            selectedDate={date}
            onSelectDate={setDate}
            filters={filters}
            onFiltersChange={setFilters}
          />
        </div>
        <div className="min-w-0 flex-1">
          <DashboardPage />
        </div>
      </div>
    </AppShell>
  );
}
