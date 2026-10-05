import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCompany } from "@/hooks/use-active-company";

export const DEFAULT_CITIES: string[] = [];

const QUERY_KEY = ["clinic_cities"] as const;
// Versões anteriores guardavam as cidades só no navegador.
const LEGACY_STORAGE_KEY = "clinic_cities";
const LEGACY_MIGRATION_KEY = "clinic_cities_migrated_v3";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;

function readLegacyCities(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function clearLegacyCities() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_MIGRATION_KEY);
  } catch {
    // Armazenamento indisponível: nada a limpar.
  }
}

async function saveCities(companyId: string, cities: string[]): Promise<string[]> {
  const { data, error } = await rpc("save_clinic_cities", {
    p_company_id: companyId,
    p_cities: cities,
  });
  if (error) throw new Error(error.message);
  return (data as string[] | null) ?? [];
}

export function useClinicCities() {
  const qc = useQueryClient();
  const { companyId } = useActiveCompany();

  const { data: cities = [] } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("get_clinic_cities");
      if (error) throw new Error(error.message);
      const remote = (data as string[] | null) ?? [];

      // Leva para o banco, uma única vez, as cidades que estavam só neste navegador.
      const legacy = readLegacyCities();
      if (legacy.length > 0 && companyId) {
        const known = new Set(remote.map((c) => c.toLowerCase()));
        const missing = legacy.filter((c) => !known.has(c.trim().toLowerCase()));
        if (missing.length === 0) {
          clearLegacyCities();
        } else {
          try {
            const saved = await saveCities(companyId, [...remote, ...missing]);
            clearLegacyCities();
            return saved;
          } catch {
            // Sem permissão para configurar: mantém a cópia antiga até alguém com permissão abrir.
          }
        }
      }
      return remote;
    },
  });

  const persist = async (next: string[]): Promise<boolean> => {
    if (!companyId) {
      toast.error("Clínica não identificada. Recarregue a página.");
      return false;
    }
    try {
      const saved = await saveCities(companyId, next);
      qc.setQueryData(QUERY_KEY, saved);
      return true;
    } catch (error) {
      toast.error("Não foi possível salvar as cidades.", {
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    }
  };

  const addCity = async (cityName: string): Promise<boolean> => {
    const trimmed = cityName.trim();
    if (!trimmed) return false;
    if (cities.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`A cidade "${trimmed}" já está cadastrada na lista.`);
      return false;
    }
    return persist([...cities, trimmed]);
  };

  const removeCity = (cityName: string) => persist(cities.filter((c) => c !== cityName));

  return {
    cities,
    addCity,
    removeCity,
    setCities: persist,
  };
}
