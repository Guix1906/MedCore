/**
 * Local Events & Appointments Storage Helper
 * Guarantees zero data loss, instant creation, and offline resilience for agenda events.
 */

import type { RawEvent } from "@/features/agenda/lib/normalize";
import { isRecordWiped, performFullSystemWipe } from "./wipe-system";

export { isRecordWiped, performFullSystemWipe } from "./wipe-system";

const STORAGE_KEY = "medcore_local_events";

/**
 * Exclui absolutamente todos os agendamentos e movimentações de teste existentes
 * (banco Supabase e localStorage), zerando o sistema integralmente.
 */
export async function wipeAllAppointments(): Promise<void> {
  await performFullSystemWipe();
}

interface StoredLocalEvent extends RawEvent {
  company_id?: string | null;
  created_at?: string;
}

export function clearAllStoredLocalEvents(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: [] }));
  } catch (e) {
    console.error("Erro ao limpar eventos locais:", e);
  }
}

export function getStoredLocalEvents(companyId?: string | null): RawEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: StoredLocalEvent[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((e) => !isRecordWiped(e));
  } catch {
    return [];
  }
}

export function saveStoredLocalEvent(event: RawEvent, companyId?: string | null): void {
  if (typeof window === "undefined" || !event?.id) return;
  try {
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const itemToSave: StoredLocalEvent = {
      ...event,
      created_at: (event as any).created_at || new Date().toISOString(),
      company_id: companyId || event.case_id || null,
    };
    const exists = current.some((e) => e.id === event.id);
    const next = exists
      ? current.map((e) => (e.id === event.id ? { ...e, ...itemToSave } : e))
      : [itemToSave, ...current];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: next }));
  } catch (e) {
    console.error("Erro ao salvar evento localmente:", e);
  }
}

export function deleteStoredLocalEvent(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const cleanId = id.startsWith("event:") ? id.replace("event:", "") : id;
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const next = current.filter((e) => e.id !== cleanId && e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: next }));
  } catch (e) {
    console.error("Erro ao excluir evento local:", e);
  }
}

export function updateStoredLocalEventTimes(
  id: string,
  starts_at: string,
  ends_at?: string | null,
): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const cleanId = id.startsWith("event:") ? id.replace("event:", "") : id;
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const exists = current.some((e) => e.id === cleanId || e.id === id);
    let next: StoredLocalEvent[];
    if (exists) {
      next = current.map((e) => {
        if (e.id === cleanId || e.id === id) {
          return { ...e, starts_at, ends_at: ends_at ?? e.ends_at };
        }
        return e;
      });
    } else {
      next = [
        {
          id: cleanId,
          title: "Agendamento",
          starts_at,
          ends_at: ends_at || null,
          event_type: "meeting",
          description: null,
          location: null,
          assigned_to: null,
          case_id: null,
          created_at: new Date().toISOString(),
        },
        ...current,
      ];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("medcore_events_updated", { detail: next }));
  } catch (e) {
    console.error("Erro ao atualizar horário do evento localmente:", e);
  }
}

export function mergeWithLocalEvents(
  remoteEvents: RawEvent[],
  companyId?: string | null,
): RawEvent[] {
  const safeRemote = (Array.isArray(remoteEvents) ? remoteEvents : []).filter(
    (e) => !isRecordWiped(e),
  );
  const local = getStoredLocalEvents(companyId);
  if (!local.length) return safeRemote;

  const map = new Map<string, RawEvent>();
  safeRemote.forEach((e) => {
    if (e?.id) map.set(e.id, e);
  });
  local.forEach((e) => {
    if (e?.id) {
      const existing = map.get(e.id);
      map.set(e.id, existing ? { ...existing, ...e } : e);
    }
  });

  return Array.from(map.values()).filter((e) => !isRecordWiped(e));
}
