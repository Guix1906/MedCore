/**
 * Local Patients Storage and Sync Helper
 * Ensures immediate persistence, high responsiveness, and seamless offline/fallback support.
 */

export interface LocalPatient {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  insurance?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  notes?: string | null;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

const STORAGE_KEY = "medcore_local_patients";

export function getStoredLocalPatients(): LocalPatient[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredLocalPatient(patient: LocalPatient): void {
  if (typeof window === "undefined" || !patient?.id) return;
  try {
    const current = getStoredLocalPatients();
    const exists = current.some((p) => p.id === patient.id);
    const updated = exists
      ? current.map((p) => (p.id === patient.id ? { ...p, ...patient } : p))
      : [patient, ...current];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("medcore_patients_updated", { detail: updated }));
  } catch (e) {
    console.error("Erro ao salvar paciente localmente:", e);
  }
}

export function deleteStoredLocalPatient(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const current = getStoredLocalPatients();
    const filtered = current.filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent("medcore_patients_updated", { detail: filtered }));
  } catch (e) {
    console.error("Erro ao excluir paciente local:", e);
  }
}

export function mergeWithLocalPatients<T extends { id: string }>(remotePatients: T[]): T[] {
  const local = getStoredLocalPatients() as unknown as T[];
  if (!local.length) return remotePatients;

  const map = new Map<string, T>();
  // 1. Adiciona lista remota
  remotePatients.forEach((p) => {
    if (p?.id) map.set(p.id, p);
  });
  // 2. Mescla/Sobrescreve com lista local mais recente
  local.forEach((p) => {
    if (p?.id) {
      const existing = map.get(p.id);
      map.set(p.id, existing ? { ...existing, ...p } : p);
    }
  });

  return Array.from(map.values());
}
