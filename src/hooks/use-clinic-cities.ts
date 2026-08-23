import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const DEFAULT_CITIES: string[] = [];

const STORAGE_KEY = "clinic_cities";
const MIGRATION_KEY = "clinic_cities_migrated_v3";

const LEGACY_DEFAULT_CITIES = new Set([
  "são paulo",
  "sao paulo",
  "rio de janeiro",
  "campinas",
  "belo horizonte",
  "curitiba",
  "brasília",
  "brasilia",
  "porto alegre",
]);

export function getStoredCities(): string[] {
  if (typeof window === "undefined") return [];

  try {
    // Migration: One-time purge of the old hardcoded default list
    const isMigrated = localStorage.getItem(MIGRATION_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!isMigrated) {
      localStorage.setItem(MIGRATION_KEY, "true");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            // Remove legacy defaults
            const filtered = parsed.filter(
              (c) => typeof c === "string" && !LEGACY_DEFAULT_CITIES.has(c.trim().toLowerCase())
            );
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
            return filtered;
          }
        } catch {
          // ignore
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      return [];
    }

    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((c) => typeof c === "string" && c.trim().length > 0);
    }
  } catch {
    /* fallback */
  }

  return [];
}

export function saveStoredCities(cities: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MIGRATION_KEY, "true");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cities));
    window.dispatchEvent(new CustomEvent("clinic_cities_updated", { detail: cities }));
  } catch {
    /* noop */
  }
}

export function useClinicCities() {
  const qc = useQueryClient();

  const { data: cities = [] } = useQuery({
    queryKey: ["clinic_cities"],
    queryFn: () => getStoredCities(),
    staleTime: Infinity,
  });

  useEffect(() => {
    const handleUpdate = () => {
      qc.setQueryData(["clinic_cities"], getStoredCities());
    };
    window.addEventListener("clinic_cities_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("clinic_cities_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [qc]);

  const setCities = (newCities: string[]) => {
    saveStoredCities(newCities);
    qc.setQueryData(["clinic_cities"], newCities);
  };

  const addCity = (cityName: string): boolean => {
    const trimmed = cityName.trim();
    if (!trimmed) return false;
    const current = qc.getQueryData<string[]>(["clinic_cities"]) ?? getStoredCities();
    if (current.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`A cidade "${trimmed}" já está cadastrada na lista.`);
      return false;
    }
    const next = [...current, trimmed];
    setCities(next);
    return true;
  };

  const removeCity = (cityName: string) => {
    const current = qc.getQueryData<string[]>(["clinic_cities"]) ?? getStoredCities();
    const next = current.filter((c) => c !== cityName);
    setCities(next);
  };

  return {
    cities,
    addCity,
    removeCity,
    setCities,
  };
}
