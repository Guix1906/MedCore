import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { patientsService, type Patient } from "@/services/api/patients.service";

export function usePatient(id: string | undefined, enabled = true) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["patient-profile", id],
    enabled: !!id && enabled,
    staleTime: 60_000,
    initialData: () =>
      queryClient.getQueryData<Patient[]>(["patients-list"])?.find((patient) => patient.id === id),
    queryFn: async (): Promise<Patient | null> => {
      if (!id) throw new Error("Selecione um paciente para abrir a ficha.");
      try {
        return await patientsService.getPatientById(id);
      } catch {
        const { data, error } = await supabase
          .from("patients")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data;
      }
    },
  });
}
