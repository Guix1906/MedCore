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
  component: () => (
    <AppShell>
      <ProntuarioPage />
    </AppShell>
  ),
});
