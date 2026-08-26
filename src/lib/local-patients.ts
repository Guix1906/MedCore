/**
 * Local Patients In-Memory Helper (LGPD / PHI Compliant)
 * Operates STRICTLY in-memory (volatile). NEVER writes sensitive PHI to plain localStorage.
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

// Memória volátil (purga ao fechar aba/navegador)
const inMemoryPatientsMap = new Map<string, LocalPatient>();

// Purgar quaisquer dados residuais inseguros de localStorage legado
if (typeof window !== "undefined") {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silencioso
  }
}

export function getStoredLocalPatients(): LocalPatient[] {
  return Array.from(inMemoryPatientsMap.values());
}

export function saveStoredLocalPatient(patient: LocalPatient): void {
  if (!patient?.id) return;
  inMemoryPatientsMap.set(patient.id, patient);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("medcore_patients_updated", {
        detail: Array.from(inMemoryPatientsMap.values()),
      }),
    );
  }
}

export function deleteStoredLocalPatient(id: string): void {
  if (!id) return;
  inMemoryPatientsMap.delete(id);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("medcore_patients_updated", {
        detail: Array.from(inMemoryPatientsMap.values()),
      }),
    );
  }
}

export function mergeWithLocalPatients<T extends { id: string }>(remotePatients: T[]): T[] {
  const local = Array.from(inMemoryPatientsMap.values()) as unknown as T[];
  if (!local.length) return remotePatients;

  const map = new Map<string, T>();
  remotePatients.forEach((p) => {
    if (p?.id) map.set(p.id, p);
  });
  local.forEach((p) => {
    if (p?.id) {
      const existing = map.get(p.id);
      map.set(p.id, existing ? { ...existing, ...p } : p);
    }
  });

  return Array.from(map.values());
}
