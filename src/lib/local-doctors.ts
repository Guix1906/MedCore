/**
 * Local Doctors Storage and Sync Helper
 * Ensures instant persistence and offline resilience for doctor records.
 */

export interface LocalDoctor {
  id: string;
  name: string;
  email?: string | null;
  specialty?: string | null;
  crm?: string | null;
  phone?: string | null;
  role?: string | null;
  active?: boolean;
  avatar_url?: string | null;
}

const STORAGE_KEY = "medcore_local_doctors";

export function getStoredLocalDoctors(): LocalDoctor[] {
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

export function saveStoredLocalDoctor(doctor: LocalDoctor): void {
  if (typeof window === "undefined" || !doctor?.id) return;
  try {
    const current = getStoredLocalDoctors();
    const exists = current.some((d) => d.id === doctor.id);
    const updated = exists
      ? current.map((d) => (d.id === doctor.id ? { ...d, ...doctor } : d))
      : [doctor, ...current];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("medcore_doctors_updated", { detail: updated }));
  } catch (e) {
    console.error("Erro ao salvar médico localmente:", e);
  }
}

export function mergeWithLocalDoctors<T extends { id: string }>(remoteDoctors: T[]): T[] {
  const local = getStoredLocalDoctors() as unknown as T[];
  if (!local.length) return remoteDoctors;

  const map = new Map<string, T>();
  remoteDoctors.forEach((d) => {
    if (d?.id) map.set(d.id, d);
  });
  local.forEach((d) => {
    if (d?.id) {
      const existing = map.get(d.id);
      map.set(d.id, existing ? { ...existing, ...d } : d);
    }
  });

  return Array.from(map.values());
}
