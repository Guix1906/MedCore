import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const DEFAULT_CITIES = [
  "São Paulo",
  "Rio de Janeiro",
  "Campinas",
  "Belo Horizonte",
  "Curitiba",
  "Brasília",
  "Porto Alegre",
];

export function getStoredCities(): string[] {
  try {
    const raw = localStorage.getItem("clinic_cities");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* fallback to defaults */
  }
  return DEFAULT_CITIES;
}

export function saveStoredCities(cities: string[]) {
  try {
    localStorage.setItem("clinic_cities", JSON.stringify(cities));
  } catch {
    /* noop */
  }
}

export function useClinicCities() {
  const qc = useQueryClient();

  const { data: cities = getStoredCities() } = useQuery({
    queryKey: ["clinic_cities"],
    queryFn: () => getStoredCities(),
  });

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
