import { createFileRoute } from "@tanstack/react-router";
import ProntuarioPage from "@/components/prontuario/ProntuarioPage";
import AppShell from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/prontuario")({
  head: () => ({
    meta: [
      { title: "Prontuário • ClinicMed" },
      { name: "description", content: "Prontuário eletrônico ClinicMed." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    patientId: (search.patientId as string) || (search.id as string) || undefined,
    patientName: (search.patientName as string) || (search.name as string) || undefined,
  }),
  component: () => (
    <AppShell>
      <ProntuarioPage />
    </AppShell>
  ),
});
