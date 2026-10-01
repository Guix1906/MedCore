import { createFileRoute } from "@tanstack/react-router";
import ProntuarioPage from "@/components/prontuario/ProntuarioPage";
import AppShell from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/prontuario")({
  head: () => ({
    meta: [
      { title: "Prontuário • MedCore" },
      { name: "description", content: "Prontuário eletrônico MedCore." },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { patientId: string | undefined; patientName: string | undefined; tab?: string } => ({
    patientId: (search.patientId as string) || (search.id as string) || undefined,
    patientName: (search.patientName as string) || (search.name as string) || undefined,
    // Aba inicial (ex.: "anamnese" ao clicar em Iniciar atendimento); sem isso a URL perdia o parâmetro
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: () => (
    <AppShell>
      <ProntuarioPage />
    </AppShell>
  ),
});
