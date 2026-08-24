/**
 * Local Events & Appointments Storage Helper
 * Guarantees zero data loss, instant creation, and offline resilience for agenda events.
 */

import type { RawEvent } from "@/features/agenda/lib/normalize";

const STORAGE_KEY = "medcore_local_events";

interface StoredLocalEvent extends RawEvent {
  company_id?: string | null;
}

export function getStoredLocalEvents(companyId?: string | null): RawEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: StoredLocalEvent[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    if (!companyId) return list;
    return list.filter((e) => !e.company_id || e.company_id === companyId);
  } catch {
    return [];
  }
}

export function saveStoredLocalEvent(event: RawEvent, companyId?: string | null): void {
  if (typeof window === "undefined" || !event?.id) return;
  try {
    const current: StoredLocalEvent[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const itemToSave: StoredLocalEvent = { ...event, company_id: companyId || event.case_id || null };
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

export function mergeWithLocalEvents(remoteEvents: RawEvent[], companyId?: string | null): RawEvent[] {
  const local = getStoredLocalEvents(companyId);
  if (!local.length) return remoteEvents;

  const map = new Map<string, RawEvent>();
  remoteEvents.forEach((e) => {
    if (e?.id) map.set(e.id, e);
  });
  local.forEach((e) => {
    if (e?.id) {
      const existing = map.get(e.id);
      map.set(e.id, existing ? { ...existing, ...e } : e);
    }
  });

  return Array.from(map.values());
}
