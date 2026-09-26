import { createFileRoute } from "@tanstack/react-router";
import AppShell from "@/components/AppShell";
import { DashboardPage } from "@/features/visao-geral/components/DashboardPage";

export const Route = createFileRoute("/_authenticated/visao-geral")({
  head: () => ({
    meta: [
      { title: "Indicadores da agenda • MedCore" },
      {
        name: "description",
        content: "Agendamentos por período, profissional e status, sem dados de demonstração.",
      },
    ],
  }),
  component: VisaoGeralRoute,
});

function VisaoGeralRoute() {
  return (
    <AppShell title="Indicadores da agenda">
      <DashboardPage />
    </AppShell>
  );
}
