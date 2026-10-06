import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DbRow } from "@/lib/types";

/**
 * Usos registrados do plano (mais recente primeiro). Todas as telas de injetáveis
 * leem esta mesma chave; as opções do formulário de registro ficam numa chave filha
 * (..., "options") para os dois formatos não se sobrescreverem no cache.
 */
export function useTreatmentMedicationUses(treatmentId: string) {
  return useQuery({
    queryKey: ["treatment-medication-uses", treatmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_medication_uses")
        .select("*")
        .eq("treatment_id", treatmentId)
        .order("used_at", { ascending: false });
      if (error) throw error;
      return (data as DbRow[]) ?? [];
    },
  });
}
