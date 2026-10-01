import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Syringe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import MedicationUsePanel from "@/features/acompanhamentos/MedicationUsePanel";
import { formatClinicalDate } from "@/features/acompanhamentos/followup-utils";

/**
 * Injetáveis do paciente: escolhe o plano de tratamento e registra aplicações
 * (medicação, dose, via, lote/estoque) no mesmo painel usado nos acompanhamentos.
 */
export default function InjectablesTab({
  patientId,
  onCreatePlan,
}: {
  patientId?: string;
  onCreatePlan: () => void;
}) {
  const { data: treatments = [], isLoading } = useQuery({
    queryKey: ["patient-treatments-injectables", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatments")
        .select("id,title,status,start_date")
        .eq("patient_id", patientId!)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [selectedId, setSelectedId] = useState<string>("");
  useEffect(() => {
    if (!selectedId && treatments.length > 0) {
      const active = treatments.find((t: any) => t.status === "em_andamento") ?? treatments[0];
      setSelectedId(active.id);
    }
  }, [treatments, selectedId]);

  if (!patientId) {
    return <p className="text-sm text-muted-foreground">Paciente sem cadastro completo.</p>;
  }
  if (isLoading) {
    return <p className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">Carregando…</p>;
  }
  if (treatments.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <Syringe size={28} className="mx-auto text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground">
          As aplicações ficam ligadas a um plano de tratamento.
        </p>
        <p className="text-sm text-muted-foreground">
          Crie o plano do paciente e as aplicações poderão ser registradas aqui.
        </p>
        <button
          type="button"
          onClick={onCreatePlan}
          className="inline-flex h-10 cursor-pointer items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          Criar plano de tratamento
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-foreground">Plano</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 cursor-pointer rounded-lg border border-input bg-card px-2 text-sm text-foreground outline-none focus:border-primary"
          >
            {treatments.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.start_date ? ` — desde ${formatClinicalDate(t.start_date)}` : ""}
                {t.status && t.status !== "em_andamento" ? ` (${t.status.replace(/_/g, " ")})` : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedId && (
          <Link
            to="/acompanhamentos/$id"
            params={{ id: selectedId }}
            search={{ tab: "medicacoes" }}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            Abrir acompanhamento completo <ExternalLink size={13} />
          </Link>
        )}
      </div>
      {selectedId && <MedicationUsePanel key={selectedId} treatmentId={selectedId} />}
    </div>
  );
}
